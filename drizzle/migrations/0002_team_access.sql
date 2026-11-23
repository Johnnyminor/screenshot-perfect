-- Membership is provisioned by a trusted operator, never by self-registration.
-- IMPORTANT: populate app_members with your approved editors before publishing.
CREATE TABLE public.app_members (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.app_members ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.app_members TO authenticated;
GRANT ALL ON public.app_members TO service_role;
CREATE POLICY "own membership" ON public.app_members FOR SELECT TO authenticated USING (user_id=auth.uid());
CREATE FUNCTION public.is_team_member() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.app_members WHERE user_id=auth.uid())
$$;
REVOKE ALL ON FUNCTION public.is_team_member() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_team_member() TO authenticated, service_role;
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['profiles','companies','topics','feeds','items','item_sources','item_matches','editor_columns','item_actions','ingest_runs'] LOOP
    EXECUTE format('CREATE POLICY "approved team only" ON public.%I AS RESTRICTIVE FOR ALL TO authenticated USING (public.is_team_member()) WITH CHECK (public.is_team_member())',t);
  END LOOP;
END $$;
