-- Different announcement identifiers must remain distinct even with identical recurring headlines.
CREATE OR REPLACE FUNCTION public.store_collected_item(p_item jsonb, p_existing_id uuid, p_matches jsonb, p_feed_id uuid, p_refresh boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid; v_created boolean := false;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_item->>'canonical_url',1));
  PERFORM pg_advisory_xact_lock(hashtextextended(p_item->>'headline_norm',0));
  v_id := p_existing_id;
  IF v_id IS NULL THEN
    SELECT id INTO v_id FROM public.items WHERE canonical_url=p_item->>'canonical_url'
      OR (NOT p_refresh AND EXISTS (SELECT 1 FROM public.feeds f WHERE f.id=p_feed_id AND f.connector<>'announcements') AND NOT is_seed AND headline_norm=p_item->>'headline_norm' AND published_at>=now()-interval '48 hours')
      ORDER BY (canonical_url=p_item->>'canonical_url') DESC LIMIT 1;
  END IF;
  IF v_id IS NULL THEN
    v_created := true;
    INSERT INTO public.items (headline,summary,canonical_url,publisher,feed_id,published_at,published_at_estimated,headline_norm)
    VALUES (p_item->>'headline',p_item->>'summary',p_item->>'canonical_url',p_item->>'publisher',p_feed_id,
      (p_item->>'published_at')::timestamptz,(p_item->>'published_at_estimated')::boolean,p_item->>'headline_norm')
    RETURNING id INTO v_id;
  ELSIF p_refresh THEN
    UPDATE public.items SET headline=p_item->>'headline', summary=p_item->>'summary',
      published_at=(p_item->>'published_at')::timestamptz,
      published_at_estimated=(p_item->>'published_at_estimated')::boolean,
      headline_norm=p_item->>'headline_norm' WHERE id=v_id AND NOT is_seed;
  END IF;
  INSERT INTO public.item_sources (item_id,feed_id) VALUES (v_id,p_feed_id)
    ON CONFLICT (item_id,feed_id) DO UPDATE SET seen_at=now();
  PERFORM public.replace_item_matches(v_id,p_matches);
  RETURN jsonb_build_object('id',v_id,'created',v_created);
END $$;
