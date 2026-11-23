-- Polling cadence and provider cooldowns survive worker restarts and cron runs.
ALTER TABLE public.feeds
  ADD COLUMN poll_interval_minutes int NOT NULL DEFAULT 15 CHECK (poll_interval_minutes BETWEEN 15 AND 10080),
  ADD COLUMN next_poll_at timestamptz;
UPDATE public.feeds SET poll_interval_minutes=180 WHERE kind='google_news';
UPDATE public.feeds SET poll_interval_minutes=60 WHERE connector IN ('pubmed','clinicaltrials');
ALTER TABLE public.ingest_runs ADD COLUMN feeds_deferred int NOT NULL DEFAULT 0;

CREATE TABLE public.provider_health (
  hostname text PRIMARY KEY,
  consecutive_failures int NOT NULL DEFAULT 0,
  blocked_until timestamptz,
  last_error text,
  last_status int,
  last_success_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.provider_health ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.provider_health TO authenticated;
GRANT ALL ON public.provider_health TO service_role;
CREATE POLICY "team read provider health" ON public.provider_health FOR SELECT TO authenticated
  USING (public.is_team_member());
CREATE INDEX feeds_next_poll_idx ON public.feeds(next_poll_at) WHERE active;

CREATE FUNCTION public.initialize_feed_cadence() RETURNS trigger
LANGUAGE plpgsql SET search_path=public AS $$ BEGIN
  IF NEW.poll_interval_minutes=15 THEN
    IF NEW.kind='google_news' THEN NEW.poll_interval_minutes:=180;
    ELSIF NEW.connector IN ('pubmed','clinicaltrials') THEN NEW.poll_interval_minutes:=60;
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER feeds_default_cadence BEFORE INSERT ON public.feeds
FOR EACH ROW EXECUTE FUNCTION public.initialize_feed_cadence();
