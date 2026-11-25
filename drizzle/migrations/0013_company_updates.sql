-- One RLS-protected summary request for the company picker, matching the story filters.
CREATE FUNCTION public.dashboard_company_updates(
  p_since timestamptz, p_feed_id uuid, p_hide_opinion boolean
) RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public AS $$
  SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.company_id),'[]'::jsonb)
  FROM (
    SELECT c.id AS company_id,count(DISTINCT i.id) AS stories,max(i.published_at) AS latest
    FROM public.companies c
    LEFT JOIN public.item_matches m ON m.company_id=c.id
    LEFT JOIN public.items i ON i.id=m.item_id
      AND NOT i.is_seed
      AND (p_since IS NULL OR i.published_at>=p_since)
      AND (NOT p_hide_opinion OR NOT i.is_opinion)
      AND (p_feed_id IS NULL OR EXISTS (
        SELECT 1 FROM public.item_sources s WHERE s.item_id=i.id AND s.feed_id=p_feed_id
      ))
      AND NOT EXISTS (
        SELECT 1 FROM public.item_actions a
        WHERE a.item_id=i.id AND a.user_id=auth.uid() AND a.status='dismissed'
      )
    GROUP BY c.id
  ) r
$$;
REVOKE ALL ON FUNCTION public.dashboard_company_updates(timestamptz,uuid,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.dashboard_company_updates(timestamptz,uuid,boolean) TO authenticated;
