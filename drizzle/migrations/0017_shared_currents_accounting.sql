-- All application consumers share one atomic UTC-day allowance.
CREATE TABLE public.currents_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purpose text NOT NULL CHECK (purpose IN ('preview','ingest','evaluation')),
  day date NOT NULL DEFAULT (now() AT TIME ZONE 'UTC')::date,
  status text NOT NULL DEFAULT 'reserved' CHECK(status IN ('reserved','started','response','uncertain')),
  created_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  http_status int,
  provider_limit int,
  provider_remaining int
);
CREATE INDEX currents_requests_day_idx ON public.currents_requests(day,created_at DESC);
ALTER TABLE public.currents_requests ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.currents_requests TO service_role;
GRANT SELECT ON public.currents_requests TO authenticated;
CREATE POLICY "team read request accounting" ON public.currents_requests FOR SELECT TO authenticated USING(public.is_team_member());

CREATE FUNCTION public.reserve_currents_request(p_purpose text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_id uuid;
BEGIN
  IF p_purpose NOT IN ('preview','ingest','evaluation') THEN RAISE EXCEPTION 'Invalid purpose'; END IF;
  IF EXISTS(SELECT 1 FROM provider_health WHERE hostname='api.currentsapi.services' AND blocked_until>now()) THEN
    RAISE EXCEPTION 'Currents holder pause. Prøv igen senere.';
  END IF;
  IF NOT claim_currents_request() THEN RETURN NULL; END IF;
  INSERT INTO currents_requests(purpose) VALUES(p_purpose) RETURNING id INTO v_id;
  RETURN v_id;
END $$;

CREATE FUNCTION public.start_currents_request(p_id uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  UPDATE currents_requests SET status='started' WHERE id=p_id AND status='reserved';
  RETURN FOUND;
END $$;

CREATE OR REPLACE FUNCTION public.claim_currents_evaluation(p_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_row currents_evaluation_requests%ROWTYPE; v_attempt uuid;
BEGIN
  SELECT * INTO v_row FROM currents_evaluation_requests WHERE id=p_id FOR UPDATE;
  IF NOT FOUND OR v_row.status<>'pending' THEN RETURN jsonb_build_object('outcome','done'); END IF;
  v_attempt := reserve_currents_request('evaluation');
  IF v_attempt IS NULL THEN RETURN jsonb_build_object('outcome','quota'); END IF;
  UPDATE currents_evaluation_requests SET status='running',started_at=now() WHERE id=p_id RETURNING * INTO v_row;
  RETURN jsonb_build_object('outcome','claimed','request',to_jsonb(v_row),'attempt_id',v_attempt);
END $$;
REVOKE ALL ON FUNCTION public.reserve_currents_request(text), public.start_currents_request(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_currents_request(text), public.start_currents_request(uuid) TO service_role;
