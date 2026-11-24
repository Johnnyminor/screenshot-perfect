-- Manual pilot only. The existing scheduled collector excludes Currents rows.
ALTER TABLE public.feeds DROP CONSTRAINT feeds_connector_check;
ALTER TABLE public.feeds ADD CONSTRAINT feeds_connector_check
  CHECK (connector IN ('rss','clinicaltrials','pubmed','currents'));

CREATE TABLE public.currents_daily_usage (
  day date PRIMARY KEY,
  requests int NOT NULL CHECK (requests BETWEEN 0 AND 40)
);
ALTER TABLE public.currents_daily_usage ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.currents_daily_usage TO authenticated;
GRANT ALL ON public.currents_daily_usage TO service_role;
CREATE POLICY "team read currents usage" ON public.currents_daily_usage
  FOR SELECT TO authenticated USING (public.is_team_member());

CREATE FUNCTION public.claim_currents_request() RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_count int;
BEGIN
  INSERT INTO public.currents_daily_usage(day,requests)
  VALUES ((now() AT TIME ZONE 'UTC')::date,1)
  ON CONFLICT(day) DO UPDATE SET requests=currents_daily_usage.requests+1
    WHERE currents_daily_usage.requests<40
  RETURNING requests INTO v_count;
  RETURN v_count IS NOT NULL;
END $$;
REVOKE ALL ON FUNCTION public.claim_currents_request() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_currents_request() TO service_role;

INSERT INTO public.feeds(name,url,publisher,source_weight,kind,connector,company_id,poll_interval_minutes,active)
SELECT 'Currents: ' || c.name || ' (' || lang.code || ')',
  'https://api.currentsapi.services/v1/search?query=' || public.encode_search_term('"' || c.name || '"') || '&language=' || lang.code,
  'Currents',0.6,'static','currents',c.id,480,false
FROM public.companies c CROSS JOIN (VALUES ('da'),('en')) AS lang(code)
WHERE c.ticker IN ('ALK','AMBU-B','BAVA','COLO-B','DEMANT')
  AND NOT EXISTS(SELECT 1 FROM public.feeds f WHERE f.connector='currents'
    AND f.company_id=c.id AND f.url LIKE '%language=' || lang.code);
