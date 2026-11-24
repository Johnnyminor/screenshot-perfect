-- Authorized, temporary evaluation allowance. Normal daily pilot limit resumes afterward.
ALTER TABLE public.currents_daily_usage DROP CONSTRAINT currents_daily_usage_requests_check;
ALTER TABLE public.currents_daily_usage ADD CONSTRAINT currents_daily_usage_requests_check CHECK (requests BETWEEN 0 AND 200);
CREATE FUNCTION public.currents_request_limit() RETURNS int LANGUAGE sql STABLE
SET search_path=public AS $$ SELECT CASE WHEN (now() AT TIME ZONE 'UTC')::date=DATE '2026-11-24' THEN 200 ELSE 40 END $$;
CREATE OR REPLACE FUNCTION public.claim_currents_request() RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_count int;
BEGIN
 INSERT INTO currents_daily_usage(day,requests) VALUES ((now() AT TIME ZONE 'UTC')::date,1)
 ON CONFLICT(day) DO UPDATE SET requests=currents_daily_usage.requests+1
 WHERE currents_daily_usage.requests<public.currents_request_limit()
 RETURNING requests INTO v_count;
 RETURN v_count IS NOT NULL;
END $$;

CREATE TABLE public.currents_evaluation_requests (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), study_id uuid NOT NULL,
 phase text NOT NULL CHECK(phase IN ('base','refinement','publisher','pagination','repeat')),
 ordinal int NOT NULL, company_id uuid REFERENCES companies(id),
 params jsonb NOT NULL, status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','running','completed','failed')),
 created_at timestamptz NOT NULL DEFAULT now(), started_at timestamptz, finished_at timestamptz,
 http_status int, duration_ms int, articles jsonb NOT NULL DEFAULT '[]', error text,
 CHECK(ordinal BETWEEN 1 AND CASE phase WHEN 'base' THEN 144 WHEN 'refinement' THEN 16 ELSE 10 END),
 UNIQUE(study_id,phase,ordinal)
);
CREATE INDEX currents_evaluation_study_idx ON public.currents_evaluation_requests(study_id,status);
ALTER TABLE public.currents_evaluation_requests ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.currents_evaluation_requests TO authenticated;
GRANT ALL ON public.currents_evaluation_requests TO service_role;
CREATE POLICY "team read evaluation" ON public.currents_evaluation_requests FOR SELECT TO authenticated USING(is_team_member());

CREATE TABLE public.currents_evaluation_publishers(domain text PRIMARY KEY,label text NOT NULL);
INSERT INTO public.currents_evaluation_publishers VALUES
 ('medwatch.dk','MedWatch'),('dagensmedicin.dk','Dagens Medicin'),('borsen.dk','Børsen'),
 ('fiercepharma.com','FiercePharma'),('globenewswire.com','GlobeNewswire');
ALTER TABLE public.currents_evaluation_publishers ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.currents_evaluation_publishers TO authenticated;
GRANT ALL ON public.currents_evaluation_publishers TO service_role;
CREATE POLICY "team read evaluation publishers" ON public.currents_evaluation_publishers FOR SELECT TO authenticated USING(is_team_member());

-- Claims the row and the daily request allowance in one transaction. No uncertain request is replayed.
CREATE FUNCTION public.claim_currents_evaluation(p_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_row currents_evaluation_requests%ROWTYPE;
BEGIN
 SELECT * INTO v_row FROM currents_evaluation_requests WHERE id=p_id FOR UPDATE;
 IF NOT FOUND OR v_row.status<>'pending' THEN RETURN jsonb_build_object('outcome','done'); END IF;
 IF NOT claim_currents_request() THEN RETURN jsonb_build_object('outcome','quota'); END IF;
 UPDATE currents_evaluation_requests SET status='running',started_at=now() WHERE id=p_id RETURNING * INTO v_row;
 RETURN jsonb_build_object('outcome','claimed','request',to_jsonb(v_row));
END $$;
REVOKE ALL ON FUNCTION public.claim_currents_evaluation(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_currents_evaluation(uuid) TO service_role;
