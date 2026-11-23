-- Collection telemetry and connector configuration. Existing feeds remain RSS/Atom.
ALTER TABLE public.feeds
  ADD COLUMN connector text NOT NULL DEFAULT 'rss' CHECK (connector IN ('rss','clinicaltrials','pubmed')),
  ADD COLUMN last_items_seen int NOT NULL DEFAULT 0,
  ADD COLUMN last_items_new int NOT NULL DEFAULT 0;
ALTER TABLE public.feeds ADD CONSTRAINT feeds_weight_range CHECK (source_weight BETWEEN 0 AND 1);
UPDATE public.feeds SET url='https://laegemiddelstyrelsen.dk/da/Feeds/rss-feed'
WHERE url='http://laegemiddelstyrelsen.dk/da/Feeds/rss-feed';
ALTER TABLE public.ingest_runs
  ADD COLUMN status text NOT NULL DEFAULT 'running' CHECK (status IN ('running','completed','partial','failed','abandoned')),
  ADD COLUMN mode text NOT NULL DEFAULT 'ingest' CHECK (mode IN ('ingest','rematch')),
  ADD COLUMN trigger_type text NOT NULL DEFAULT 'manual' CHECK (trigger_type IN ('manual','schedule'));
UPDATE public.ingest_runs SET status = CASE WHEN feeds_failed > 0 THEN 'partial' ELSE 'completed' END WHERE finished_at IS NOT NULL;
CREATE INDEX items_ingested_idx ON public.items (ingested_at DESC) WHERE NOT is_seed;

-- A transaction lock makes the check-and-create operation atomic across workers.
CREATE FUNCTION public.begin_collection(p_mode text, p_trigger text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid;
BEGIN
  PERFORM pg_advisory_xact_lock(74128391);
  UPDATE public.ingest_runs SET status='abandoned', finished_at=now(),
    log=log || '[{"status":"error","error":"Collection lease expired"}]'::jsonb
    WHERE status='running' AND started_at < now() - interval '20 minutes';
  IF EXISTS (SELECT 1 FROM public.ingest_runs WHERE status='running') THEN
    RAISE EXCEPTION 'En indsamling eller genberegning kører allerede. Prøv igen senere.';
  END IF;
  INSERT INTO public.ingest_runs (mode, trigger_type) VALUES (p_mode, p_trigger) RETURNING id INTO v_id;
  RETURN v_id;
END $$;

-- Story, provenance and matches commit together. Failed matching never leaves a
-- successfully checkpointed story without its company/topic associations.
CREATE FUNCTION public.store_collected_item(p_item jsonb, p_existing_id uuid, p_matches jsonb, p_feed_id uuid, p_refresh boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid; v_created boolean := false;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_item->>'canonical_url',1));
  PERFORM pg_advisory_xact_lock(hashtextextended(p_item->>'headline_norm',0));
  v_id := p_existing_id;
  IF v_id IS NULL THEN
    SELECT id INTO v_id FROM public.items WHERE canonical_url=p_item->>'canonical_url'
      OR (NOT p_refresh AND NOT is_seed AND headline_norm=p_item->>'headline_norm' AND published_at>=now()-interval '48 hours')
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

CREATE FUNCTION public.replace_item_matches(p_item_id uuid, p_matches jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  DELETE FROM public.item_matches WHERE item_id=p_item_id;
  INSERT INTO public.item_matches (item_id,company_id,topic_id,matched_terms,relevance_score)
  SELECT p_item_id, x.company_id, x.topic_id, x.matched_terms, x.relevance_score
  FROM jsonb_to_recordset(p_matches) AS x(company_id uuid,topic_id uuid,matched_terms text[],relevance_score numeric);
END $$;
REVOKE ALL ON FUNCTION public.begin_collection(text,text), public.store_collected_item(jsonb,uuid,jsonb,uuid,boolean), public.replace_item_matches(uuid,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.begin_collection(text,text), public.store_collected_item(jsonb,uuid,jsonb,uuid,boolean), public.replace_item_matches(uuid,jsonb) TO service_role;

-- Encode every UTF-8 byte, including ampersands, quotes and non-ASCII names.
CREATE FUNCTION public.encode_search_term(value text) RETURNS text
LANGUAGE sql IMMUTABLE STRICT SET search_path = public AS $$
  SELECT string_agg('%' || lpad(to_hex(get_byte(convert_to(value,'UTF8'),i)),2,'0'),'')
  FROM generate_series(0,octet_length(convert_to(value,'UTF8'))-1) AS i
$$;
CREATE OR REPLACE FUNCTION public.sync_google_news_feed() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_url text; v_terms text;
BEGIN
  SELECT string_agg('"' || replace(term,'"','') || '"',' OR ' ORDER BY term) INTO v_terms
  FROM (SELECT DISTINCT unnest(ARRAY[NEW.name] || NEW.aliases) AS term) t WHERE length(trim(term))>0;
  v_url := 'https://news.google.com/rss/search?q=' || public.encode_search_term(v_terms) || '&hl=da&gl=DK&ceid=DK:da';
  UPDATE public.feeds SET name='Google News: ' || NEW.name,
    active=NEW.active AND NEW.google_news_enabled,
    etag=CASE WHEN url<>v_url THEN NULL ELSE etag END,
    last_modified=CASE WHEN url<>v_url THEN NULL ELSE last_modified END,
    url=v_url WHERE company_id=NEW.id AND kind='google_news';
  IF NOT FOUND AND NEW.active AND NEW.google_news_enabled THEN
    INSERT INTO public.feeds (name,url,publisher,kind,company_id,source_weight)
    VALUES ('Google News: ' || NEW.name,v_url,'Google News','google_news',NEW.id,0.4);
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER companies_sync_gn ON public.companies;
CREATE TRIGGER companies_sync_gn AFTER INSERT OR UPDATE OF name,aliases,google_news_enabled,active ON public.companies
FOR EACH ROW EXECUTE FUNCTION public.sync_google_news_feed();
UPDATE public.companies SET google_news_enabled=google_news_enabled;

-- Verified public primary sources. No publisher credentials or scraping required.
INSERT INTO public.feeds (name,url,publisher,source_weight,connector) VALUES
('PubMed: danske virksomheders forskning','https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?term=Genmab%5BAffiliation%5D%20OR%20%22Novo%20Nordisk%22%5BAffiliation%5D%20OR%20%22Zealand%20Pharma%22%5BAffiliation%5D','PubMed',0.9,'pubmed')
ON CONFLICT (url) DO NOTHING;
INSERT INTO public.feeds (name,url,publisher,source_weight) VALUES
('FDA tilbagekaldelser og sikkerhedsmeddelelser','https://www.fda.gov/about-fda/contact-fda/stay-informed/rss-feeds/recalls/rss.xml','U.S. Food and Drug Administration',0.95)
ON CONFLICT (url) DO NOTHING;
-- Keep this blocked primary-source candidate visible in the inventory but paused.
INSERT INTO public.feeds (name,url,publisher,source_weight,active,last_error) VALUES
('Genmab selskabsmeddelelser','https://ir.genmab.com/rss/news-releases.xml','Genmab',0.95,false,'Adgang skal bekræftes: HTTP 403 ved kontrol med applikationens User-Agent.')
ON CONFLICT (url) DO NOTHING;
INSERT INTO public.feeds (name,url,publisher,source_weight,connector) VALUES
('ClinicalTrials.gov: danske sponsorer','https://clinicaltrials.gov/api/v2/studies?query.spons=%22Novo%20Nordisk%22%20OR%20%22Genmab%22%20OR%20%22Zealand%20Pharma%22&sort=LastUpdatePostDate:desc&pageSize=100&format=json','ClinicalTrials.gov',0.9,'clinicaltrials')
ON CONFLICT (url) DO NOTHING;
