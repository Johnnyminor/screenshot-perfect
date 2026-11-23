-- Invoker security preserves the browser user's RLS and membership restrictions.
-- Filter and rank in Postgres before pagination, rather than sorting 150 rows in JS.
CREATE FUNCTION public.dashboard_items(
  p_company_id uuid, p_topic_id uuid, p_sort text, p_min_score numeric,
  p_hide_opinion boolean, p_since timestamptz, p_feed_id uuid, p_offset int, p_limit int
) RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  SELECT coalesce(jsonb_agg(to_jsonb(result)), '[]'::jsonb) FROM (
    SELECT i.*, jsonb_build_array(jsonb_build_object('relevance_score',m.relevance_score,'matched_terms',m.matched_terms)) AS item_matches
    FROM public.items i JOIN public.item_matches m ON m.item_id=i.id
    WHERE NOT i.is_seed
      AND ((p_company_id IS NOT NULL AND p_topic_id IS NULL AND m.company_id=p_company_id)
        OR (p_topic_id IS NOT NULL AND p_company_id IS NULL AND m.topic_id=p_topic_id))
      AND m.relevance_score>=p_min_score
      AND (NOT p_hide_opinion OR NOT i.is_opinion)
      AND (p_since IS NULL OR i.published_at>=p_since)
      AND (p_feed_id IS NULL OR EXISTS (SELECT 1 FROM public.item_sources s WHERE s.item_id=i.id AND s.feed_id=p_feed_id))
      AND NOT EXISTS (SELECT 1 FROM public.item_actions a WHERE a.item_id=i.id AND a.user_id=auth.uid() AND a.status='dismissed')
    ORDER BY CASE WHEN p_sort='relevance' THEN m.relevance_score END DESC, i.published_at DESC, i.id
    LIMIT least(greatest(p_limit,1),100) OFFSET greatest(p_offset,0)
  ) result
$$;
REVOKE ALL ON FUNCTION public.dashboard_items(uuid,uuid,text,numeric,boolean,timestamptz,uuid,int,int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dashboard_items(uuid,uuid,text,numeric,boolean,timestamptz,uuid,int,int) TO authenticated;
