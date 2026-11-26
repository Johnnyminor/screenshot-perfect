CREATE TABLE public.matching_state (id int PRIMARY KEY CHECK(id=1), revision bigint NOT NULL DEFAULT 1);
INSERT INTO public.matching_state(id) VALUES(1);
ALTER TABLE public.matching_state ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.matching_state TO service_role;
ALTER TABLE public.items ADD COLUMN match_revision bigint NOT NULL DEFAULT 0, ADD COLUMN match_algorithm text NOT NULL DEFAULT '';
-- Editors flag opinion; matching metadata and story content are collector-owned.
REVOKE UPDATE ON public.items FROM authenticated;
GRANT UPDATE(is_opinion) ON public.items TO authenticated;
ALTER TABLE public.item_matches ADD COLUMN base_score numeric;
CREATE INDEX items_pending_match_idx ON public.items(match_revision,id) WHERE NOT is_seed;

CREATE FUNCTION public.invalidate_matching() RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v bigint;
BEGIN UPDATE matching_state SET revision=revision+1 WHERE id=1 RETURNING revision INTO v; RETURN v; END $$;
CREATE FUNCTION public.matching_rules_changed() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE keys text[];
BEGIN
  keys:=CASE TG_TABLE_NAME
    WHEN 'companies' THEN ARRAY['name','aliases','case_sensitive_aliases','exclude_terms','ambiguous_terms','context_terms','excluded_name_phrases','active']
    WHEN 'topics' THEN ARRAY['keywords','active']
    ELSE ARRAY['source_weight','company_id','kind','connector'] END;
  IF TG_OP='UPDATE' AND
    (SELECT jsonb_object_agg(key,value) FROM jsonb_each(to_jsonb(NEW)) WHERE key=ANY(keys)) =
    (SELECT jsonb_object_agg(key,value) FROM jsonb_each(to_jsonb(OLD)) WHERE key=ANY(keys)) THEN RETURN NULL; END IF;
  PERFORM invalidate_matching(); RETURN NULL;
END $$;
CREATE TRIGGER companies_matching_changed AFTER INSERT OR DELETE OR UPDATE OF name,aliases,case_sensitive_aliases,exclude_terms,ambiguous_terms,context_terms,excluded_name_phrases,active ON public.companies FOR EACH ROW EXECUTE FUNCTION public.matching_rules_changed();
CREATE TRIGGER topics_matching_changed AFTER INSERT OR DELETE OR UPDATE OF keywords,active ON public.topics FOR EACH ROW EXECUTE FUNCTION public.matching_rules_changed();
CREATE TRIGGER feeds_matching_changed AFTER INSERT OR DELETE OR UPDATE OF source_weight,company_id,kind,connector ON public.feeds FOR EACH ROW EXECUTE FUNCTION public.matching_rules_changed();
CREATE FUNCTION public.item_content_changed() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
  IF ROW(NEW.headline,NEW.summary,NEW.published_at,NEW.feed_id) IS DISTINCT FROM ROW(OLD.headline,OLD.summary,OLD.published_at,OLD.feed_id) THEN
    NEW.match_revision:=0; NEW.match_algorithm:='';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER items_content_changed BEFORE UPDATE ON public.items FOR EACH ROW EXECUTE FUNCTION public.item_content_changed();

-- One database snapshot supplies both rules and their revision.
CREATE FUNCTION public.matching_snapshot() RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT jsonb_build_object('revision',revision,
  'companies',(SELECT coalesce(jsonb_agg(to_jsonb(c)),'[]') FROM companies c WHERE active),
  'topics',(SELECT coalesce(jsonb_agg(to_jsonb(t)),'[]') FROM topics t WHERE active),
  'feeds',(SELECT coalesce(jsonb_agg(to_jsonb(f)),'[]') FROM feeds f)) FROM matching_state WHERE id=1
$$;
CREATE FUNCTION public.pending_match_items(p_revision bigint,p_algorithm text,p_limit int) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT coalesce(jsonb_agg(to_jsonb(i)),'[]') FROM (
  SELECT id,headline,summary,published_at,feed_id FROM items
  WHERE NOT is_seed AND (match_revision<>p_revision OR match_algorithm<>p_algorithm)
  ORDER BY id LIMIT least(greatest(p_limit,1),100)
 ) i
$$;
CREATE OR REPLACE FUNCTION public.replace_item_matches(p_item_id uuid,p_matches jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 DELETE FROM item_matches WHERE item_id=p_item_id;
 INSERT INTO item_matches(item_id,company_id,topic_id,matched_terms,relevance_score,base_score)
 SELECT p_item_id,x.company_id,x.topic_id,x.matched_terms,x.relevance_score,x.base_score
 FROM jsonb_to_recordset(p_matches) x(company_id uuid,topic_id uuid,matched_terms text[],relevance_score numeric,base_score numeric);
END $$;
CREATE FUNCTION public.replace_matches_batch(p_records jsonb,p_revision bigint,p_algorithm text) RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE r jsonb; v items%ROWTYPE; n int:=0;
BEGIN
 IF jsonb_array_length(p_records)>100 THEN RAISE EXCEPTION 'Batch too large'; END IF;
 PERFORM 1 FROM matching_state WHERE id=1 AND revision=p_revision FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Matching rules changed; retry'; END IF;
 FOR r IN SELECT value FROM jsonb_array_elements(p_records) ORDER BY value->>'id' LOOP
  SELECT * INTO v FROM items WHERE id=(r->>'id')::uuid AND NOT is_seed FOR UPDATE;
  IF NOT FOUND OR ROW(v.headline,v.summary,v.published_at,v.feed_id) IS DISTINCT FROM ROW(r->'input'->>0,r->'input'->>1,(r->'input'->>2)::timestamptz,(r->'input'->>3)::uuid) THEN CONTINUE; END IF;
  PERFORM replace_item_matches(v.id,r->'matches');
  UPDATE items SET match_revision=p_revision,match_algorithm=p_algorithm WHERE id=v.id;
  n:=n+1;
 END LOOP;
 RETURN n;
END $$;
CREATE FUNCTION public.effective_relevance(p_base numeric,p_legacy numeric,p_published timestamptz,p_now timestamptz DEFAULT now()) RETURNS numeric
LANGUAGE sql IMMUTABLE AS $$
 SELECT CASE WHEN p_base IS NULL THEN p_legacy ELSE round(p_base + CASE WHEN p_now-p_published<=interval '24 hours' THEN 0.10 WHEN p_now-p_published<=interval '72 hours' THEN 0.05 ELSE 0 END,2) END
$$;
REVOKE ALL ON FUNCTION public.invalidate_matching(),public.matching_rules_changed(),public.matching_snapshot(),public.pending_match_items(bigint,text,int),public.replace_matches_batch(jsonb,bigint,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.invalidate_matching(),public.matching_snapshot(),public.pending_match_items(bigint,text,int),public.replace_matches_batch(jsonb,bigint,text) TO service_role;

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
  -- Matching metadata is supplied only by the versioned batch API.
  IF p_item ? 'matching_revision' THEN
    IF (SELECT revision FROM matching_state WHERE id=1)<>(p_item->>'matching_revision')::bigint THEN
      RAISE EXCEPTION 'Matching rules changed; retry';
    END IF;
    IF EXISTS(SELECT 1 FROM items i WHERE i.id=v_id AND
      ROW(i.headline,i.summary,i.published_at,i.feed_id) IS NOT DISTINCT FROM ROW(p_item->'matching_input'->>0,p_item->'matching_input'->>1,(p_item->'matching_input'->>2)::timestamptz,(p_item->'matching_input'->>3)::uuid)) THEN
      IF EXISTS(SELECT 1 FROM items WHERE id=v_id AND (match_revision<>(p_item->>'matching_revision')::bigint OR match_algorithm<>p_item->>'matching_algorithm')) THEN
        PERFORM replace_item_matches(v_id,p_matches);
        UPDATE items SET match_revision=(p_item->>'matching_revision')::bigint,match_algorithm=p_item->>'matching_algorithm' WHERE id=v_id;
      END IF;
    ELSE
      UPDATE items SET match_revision=0 WHERE id=v_id;
    END IF;
  ELSE
    UPDATE items SET match_revision=0,match_algorithm='' WHERE id=v_id;
    PERFORM public.replace_item_matches(v_id,p_matches);
  END IF;
  RETURN jsonb_build_object('id',v_id,'created',v_created);
END $$;

CREATE FUNCTION public.store_collected_batch(p_records jsonb,p_revision bigint,p_algorithm text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE r jsonb; result jsonb; n int:=0;
BEGIN
 IF jsonb_array_length(p_records)>50 THEN RAISE EXCEPTION 'Batch too large'; END IF;
 PERFORM 1 FROM matching_state WHERE id=1 AND revision=p_revision FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Matching rules changed; retry'; END IF;
 FOR r IN SELECT value FROM jsonb_array_elements(p_records) ORDER BY value->'item'->>'canonical_url' LOOP
  result:=store_collected_item((r->'item') || jsonb_build_object('matching_revision',p_revision,'matching_algorithm',p_algorithm,'matching_input',r->'input'),
    (r->>'existing_id')::uuid,r->'matches',(r->>'feed_id')::uuid,(r->>'refresh')::boolean);
  IF (result->>'created')::boolean THEN n:=n+1; END IF;
 END LOOP;
 RETURN jsonb_build_object('created',n);
END $$;
REVOKE ALL ON FUNCTION public.store_collected_batch(jsonb,bigint,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.store_collected_batch(jsonb,bigint,text) TO service_role;
