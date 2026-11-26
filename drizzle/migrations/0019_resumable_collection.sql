-- Durable per-source work, drained by the existing authenticated HTTP schedule.
CREATE TABLE public.collection_jobs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), feed_id uuid NOT NULL REFERENCES feeds(id) ON DELETE CASCADE,
 run_id uuid REFERENCES ingest_runs(id), status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','running','completed','failed')),
 attempts int NOT NULL DEFAULT 0, lease_token uuid, lease_until timestamptz,
 cursor jsonb NOT NULL DEFAULT '{}', config jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), last_error text
);
CREATE UNIQUE INDEX collection_jobs_one_open ON public.collection_jobs(feed_id) WHERE status IN ('pending','running');
CREATE INDEX collection_jobs_pending ON public.collection_jobs(status,updated_at);
ALTER TABLE public.collection_jobs ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.collection_jobs TO service_role;
GRANT SELECT ON public.collection_jobs TO authenticated;
CREATE POLICY "team read jobs" ON public.collection_jobs FOR SELECT TO authenticated USING(is_team_member());

CREATE OR REPLACE FUNCTION public.begin_collection(p_mode text,p_trigger text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_id uuid;
BEGIN
 PERFORM pg_advisory_xact_lock(74128391);
 UPDATE ingest_runs SET status='abandoned',finished_at=now(),log=log||'[{"status":"error","error":"Dispatcher lease expired; source jobs retained"}]'::jsonb
 WHERE status='running' AND started_at<now()-interval '6 minutes';
 IF EXISTS(SELECT 1 FROM ingest_runs WHERE status='running') THEN RAISE EXCEPTION 'En indsamling kører allerede. Prøv igen senere.'; END IF;
 INSERT INTO ingest_runs(mode,trigger_type) VALUES(p_mode,p_trigger) RETURNING id INTO v_id;
 RETURN v_id;
END $$;

CREATE FUNCTION public.claim_source_job(p_feed_id uuid,p_run_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE j collection_jobs%ROWTYPE; is_currents boolean; v_config jsonb;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(p_feed_id::text,27));
 SELECT connector='currents',jsonb_build_object('url',url,'connector',connector) INTO is_currents,v_config FROM feeds WHERE id=p_feed_id AND active;
 IF NOT FOUND THEN RETURN NULL; END IF;
 -- An uncertain paid request is never replayed automatically.
 UPDATE collection_jobs SET status=CASE WHEN is_currents OR attempts>=3 THEN 'failed' ELSE 'pending' END,
  lease_token=NULL,lease_until=NULL,updated_at=now(),last_error='Previous worker stopped; replay from committed cursor'
 WHERE feed_id=p_feed_id AND status='running' AND lease_until<now();
 IF is_currents AND FOUND THEN RETURN NULL; END IF;
 SELECT * INTO j FROM collection_jobs WHERE feed_id=p_feed_id AND status IN ('pending','running') FOR UPDATE;
 IF FOUND AND j.status='running' THEN RETURN NULL; END IF;
 IF NOT FOUND THEN INSERT INTO collection_jobs(feed_id,config) VALUES(p_feed_id,v_config) RETURNING * INTO j; END IF;
 IF j.config<>v_config THEN
   UPDATE collection_jobs SET config=v_config,cursor='{}',attempts=0,created_at=now() WHERE id=j.id;
 END IF;
 UPDATE collection_jobs SET status='running',run_id=p_run_id,attempts=attempts+1,lease_token=gen_random_uuid(),
  lease_until=now()+interval '6 minutes',updated_at=now() WHERE id=j.id RETURNING * INTO j;
 RETURN to_jsonb(j);
END $$;

-- Fence commits against a resumed worker whose old lease has expired.
CREATE FUNCTION public.store_job_batch(p_job_id uuid,p_token uuid,p_records jsonb,p_revision bigint,p_algorithm text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 PERFORM 1 FROM collection_jobs WHERE id=p_job_id AND lease_token=p_token AND status='running' AND lease_until>now() FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Source job lease expired'; END IF;
 RETURN store_collected_batch(p_records,p_revision,p_algorithm);
END $$;
CREATE FUNCTION public.commit_source_success(p_job_id uuid,p_token uuid,p_patch jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_feed uuid;
BEGIN
 SELECT feed_id INTO v_feed FROM collection_jobs WHERE id=p_job_id AND lease_token=p_token AND status='running' AND lease_until>now() FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Source job lease expired'; END IF;
 UPDATE feeds SET last_polled_at=now(),last_success_at=now(),last_error=NULL,consecutive_failures=0,
  last_items_new=(p_patch->>'last_items_new')::int,
  last_items_seen=coalesce((p_patch->>'last_items_seen')::int,last_items_seen),
  etag=CASE WHEN p_patch ? 'etag' THEN p_patch->>'etag' ELSE etag END,
  last_modified=CASE WHEN p_patch ? 'last_modified' THEN p_patch->>'last_modified' ELSE last_modified END,
  next_poll_at=(p_patch->>'next_poll_at')::timestamptz WHERE id=v_feed;
END $$;
CREATE FUNCTION public.checkpoint_source_job(p_id uuid,p_token uuid,p_cursor jsonb) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 UPDATE collection_jobs SET cursor=p_cursor,updated_at=now()
 WHERE id=p_id AND status='running' AND lease_token=p_token AND lease_until>now();
 RETURN FOUND;
END $$;
CREATE FUNCTION public.finish_source_job(p_id uuid,p_token uuid,p_status text,p_error text DEFAULT NULL) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF p_status NOT IN ('completed','pending','failed') THEN RAISE EXCEPTION 'Invalid job status'; END IF;
 UPDATE collection_jobs SET status=CASE WHEN p_status='pending' AND attempts>=3 THEN 'failed' ELSE p_status END,
  last_error=left(p_error,500),updated_at=now(),lease_token=NULL,lease_until=NULL
 WHERE id=p_id AND status='running' AND lease_token=p_token AND lease_until>now();
 RETURN FOUND;
END $$;

-- A read-only endpoint can be checked by an independent uptime monitor, including
-- when ingestion is entirely absent. It returns no publisher errors or credentials.
CREATE FUNCTION public.collection_health() RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT jsonb_build_object(
  'schedule_missing',NOT EXISTS(SELECT 1 FROM ingest_runs WHERE trigger_type='schedule' AND started_at>now()-interval '45 minutes'),
  'source_failures',(SELECT count(*) FROM feeds WHERE active AND connector<>'currents' AND consecutive_failures>=3),
  'sources_stale',(SELECT count(*) FROM feeds WHERE active AND connector<>'currents' AND (last_success_at IS NULL OR last_success_at<now()-make_interval(mins=>poll_interval_minutes*2+15))),
  'jobs_overdue',(SELECT count(*) FROM collection_jobs j JOIN feeds f ON f.id=j.feed_id WHERE f.active AND f.connector<>'currents' AND j.status IN ('pending','running') AND j.updated_at<now()-interval '45 minutes'),
  'run_failed',coalesce((SELECT status IN ('failed','partial','abandoned') OR (status='running' AND started_at<now()-interval '6 minutes') FROM ingest_runs WHERE trigger_type='schedule' ORDER BY started_at DESC LIMIT 1),false)
 )
$$;
REVOKE ALL ON FUNCTION public.claim_source_job(uuid,uuid),public.checkpoint_source_job(uuid,uuid,jsonb),public.finish_source_job(uuid,uuid,text,text),public.collection_health(),public.store_job_batch(uuid,uuid,jsonb,bigint,text),public.commit_source_success(uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_source_job(uuid,uuid),public.checkpoint_source_job(uuid,uuid,jsonb),public.finish_source_job(uuid,uuid,text,text),public.collection_health(),public.store_job_batch(uuid,uuid,jsonb,bigint,text),public.commit_source_success(uuid,uuid,jsonb) TO service_role;
