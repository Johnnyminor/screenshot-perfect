-- Aggregate the real archive under the caller's existing membership RLS.
CREATE FUNCTION public.company_coverage() RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public AS $$
  SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.name),'[]'::jsonb)
  FROM (
    SELECT c.id,c.name,
      count(DISTINCT i.id) FILTER (WHERE i.published_at >= now()-interval '7 days') AS stories_7d,
      count(DISTINCT i.id) FILTER (WHERE i.published_at >= now()-interval '30 days') AS stories_30d,
      max(i.published_at) AS last_published_at
    FROM public.companies c
    LEFT JOIN public.item_matches m ON m.company_id=c.id
    LEFT JOIN public.items i ON i.id=m.item_id AND NOT i.is_seed
      AND NOT i.published_at_estimated AND i.published_at<=now()
    WHERE c.active
    GROUP BY c.id,c.name
  ) r
$$;
REVOKE ALL ON FUNCTION public.company_coverage() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.company_coverage() TO authenticated;
