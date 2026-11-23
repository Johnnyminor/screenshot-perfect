-- Keep membership checks explicit in permissive policies as well as in the
-- restrictive team gate. This removes legacy unconditional-allow expressions
-- and makes the access model clear to database security scanners and operators.
ALTER POLICY "profiles readable by team" ON public.profiles
  USING (public.is_team_member());
ALTER POLICY "team all companies" ON public.companies
  USING (public.is_team_member()) WITH CHECK (public.is_team_member());
ALTER POLICY "team all topics" ON public.topics
  USING (public.is_team_member()) WITH CHECK (public.is_team_member());
ALTER POLICY "team all feeds" ON public.feeds
  USING (public.is_team_member()) WITH CHECK (public.is_team_member());
ALTER POLICY "team read items" ON public.items
  USING (public.is_team_member());
ALTER POLICY "team flag items" ON public.items
  USING (public.is_team_member()) WITH CHECK (public.is_team_member());
ALTER POLICY "team read sources" ON public.item_sources
  USING (public.is_team_member());
ALTER POLICY "team read matches" ON public.item_matches
  USING (public.is_team_member());
ALTER POLICY "team read runs" ON public.ingest_runs
  USING (public.is_team_member());
