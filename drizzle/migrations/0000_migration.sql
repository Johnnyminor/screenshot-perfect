
-- Profiles
CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "profiles readable by team" ON public.profiles FOR SELECT TO authenticated USING (true);
CREATE POLICY "own profile insert" ON public.profiles FOR INSERT TO authenticated WITH CHECK (auth.uid() = id);
CREATE POLICY "own profile update" ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = id);

CREATE OR REPLACE FUNCTION public.handle_new_user() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name) VALUES (NEW.id, split_part(NEW.email, '@', 1))
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END $$;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Companies
CREATE TABLE public.companies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  aliases text[] NOT NULL DEFAULT '{}',
  exclude_terms text[] NOT NULL DEFAULT '{}',
  case_sensitive_aliases text[] NOT NULL DEFAULT '{}',
  ticker text,
  cvr text,
  country text,
  sector text NOT NULL DEFAULT 'pharma' CHECK (sector IN ('medtech','pharma','other')),
  is_danish boolean NOT NULL DEFAULT false,
  notes text,
  google_news_enabled boolean NOT NULL DEFAULT true,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.companies TO authenticated;
GRANT ALL ON public.companies TO service_role;
ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;
CREATE POLICY "team all companies" ON public.companies FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Topics
CREATE TABLE public.topics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  keywords text[] NOT NULL DEFAULT '{}',
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.topics TO authenticated;
GRANT ALL ON public.topics TO service_role;
ALTER TABLE public.topics ENABLE ROW LEVEL SECURITY;
CREATE POLICY "team all topics" ON public.topics FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Feeds
CREATE TABLE public.feeds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  url text NOT NULL UNIQUE,
  publisher text NOT NULL,
  kind text NOT NULL DEFAULT 'static' CHECK (kind IN ('static','google_news')),
  company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE,
  source_weight numeric NOT NULL DEFAULT 0.5,
  active boolean NOT NULL DEFAULT true,
  last_polled_at timestamptz,
  last_success_at timestamptz,
  last_error text,
  consecutive_failures int NOT NULL DEFAULT 0,
  etag text,
  last_modified text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.feeds TO authenticated;
GRANT ALL ON public.feeds TO service_role;
ALTER TABLE public.feeds ENABLE ROW LEVEL SECURITY;
CREATE POLICY "team all feeds" ON public.feeds FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Items
CREATE TABLE public.items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  headline text NOT NULL,
  summary text,
  canonical_url text NOT NULL UNIQUE,
  publisher text NOT NULL,
  feed_id uuid REFERENCES public.feeds(id) ON DELETE SET NULL,
  published_at timestamptz NOT NULL,
  published_at_estimated boolean NOT NULL DEFAULT false,
  ingested_at timestamptz NOT NULL DEFAULT now(),
  headline_norm text,
  is_opinion boolean NOT NULL DEFAULT false,
  is_seed boolean NOT NULL DEFAULT false
);
CREATE INDEX items_published_idx ON public.items (published_at DESC);
CREATE INDEX items_headline_norm_idx ON public.items (headline_norm);
GRANT SELECT, UPDATE ON public.items TO authenticated;
GRANT ALL ON public.items TO service_role;
ALTER TABLE public.items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "team read items" ON public.items FOR SELECT TO authenticated USING (true);
CREATE POLICY "team flag items" ON public.items FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE TABLE public.item_sources (
  item_id uuid NOT NULL REFERENCES public.items(id) ON DELETE CASCADE,
  feed_id uuid NOT NULL REFERENCES public.feeds(id) ON DELETE CASCADE,
  seen_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (item_id, feed_id)
);
GRANT SELECT ON public.item_sources TO authenticated;
GRANT ALL ON public.item_sources TO service_role;
ALTER TABLE public.item_sources ENABLE ROW LEVEL SECURITY;
CREATE POLICY "team read sources" ON public.item_sources FOR SELECT TO authenticated USING (true);

CREATE TABLE public.item_matches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id uuid NOT NULL REFERENCES public.items(id) ON DELETE CASCADE,
  company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE,
  topic_id uuid REFERENCES public.topics(id) ON DELETE CASCADE,
  matched_terms text[] NOT NULL DEFAULT '{}',
  relevance_score numeric NOT NULL DEFAULT 0,
  CHECK (company_id IS NOT NULL OR topic_id IS NOT NULL)
);
CREATE UNIQUE INDEX item_matches_company_uq ON public.item_matches (item_id, company_id) WHERE company_id IS NOT NULL;
CREATE UNIQUE INDEX item_matches_topic_uq ON public.item_matches (item_id, topic_id) WHERE topic_id IS NOT NULL;
GRANT SELECT ON public.item_matches TO authenticated;
GRANT ALL ON public.item_matches TO service_role;
ALTER TABLE public.item_matches ENABLE ROW LEVEL SECURITY;
CREATE POLICY "team read matches" ON public.item_matches FOR SELECT TO authenticated USING (true);

-- Editor columns
CREATE TABLE public.editor_columns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE,
  topic_id uuid REFERENCES public.topics(id) ON DELETE CASCADE,
  position int NOT NULL DEFAULT 0,
  sort text NOT NULL DEFAULT 'time' CHECK (sort IN ('time','relevance')),
  hide_opinion boolean NOT NULL DEFAULT true,
  min_score numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (company_id IS NOT NULL OR topic_id IS NOT NULL)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.editor_columns TO authenticated;
GRANT ALL ON public.editor_columns TO service_role;
ALTER TABLE public.editor_columns ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own columns" ON public.editor_columns FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Item actions
CREATE TABLE public.item_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id uuid NOT NULL REFERENCES public.items(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'new' CHECK (status IN ('new','read','used','dismissed')),
  note text,
  article_ref text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (item_id, user_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.item_actions TO authenticated;
GRANT ALL ON public.item_actions TO service_role;
ALTER TABLE public.item_actions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own actions" ON public.item_actions FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Ingest runs
CREATE TABLE public.ingest_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  feeds_ok int NOT NULL DEFAULT 0,
  feeds_failed int NOT NULL DEFAULT 0,
  items_new int NOT NULL DEFAULT 0,
  log jsonb NOT NULL DEFAULT '[]'
);
GRANT SELECT ON public.ingest_runs TO authenticated;
GRANT ALL ON public.ingest_runs TO service_role;
ALTER TABLE public.ingest_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "team read runs" ON public.ingest_runs FOR SELECT TO authenticated USING (true);

-- Google News feed sync per company
CREATE OR REPLACE FUNCTION public.sync_google_news_feed() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_url text;
BEGIN
  DELETE FROM public.feeds WHERE company_id = NEW.id AND kind = 'google_news';
  IF NEW.google_news_enabled AND NEW.active THEN
    v_url := 'https://news.google.com/rss/search?q=%22' || replace(NEW.name, ' ', '+') || '%22&hl=da&gl=DK&ceid=DK:da';
    INSERT INTO public.feeds (name, url, publisher, kind, company_id, source_weight)
    VALUES ('Google News: ' || NEW.name, v_url, 'Google News', 'google_news', NEW.id, 0.4)
    ON CONFLICT (url) DO NOTHING;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER companies_sync_gn AFTER INSERT OR UPDATE OF name, google_news_enabled, active ON public.companies
FOR EACH ROW EXECUTE FUNCTION public.sync_google_news_feed();

-- Seed static feeds
INSERT INTO public.feeds (name, url, publisher, source_weight) VALUES
('EMA nyheder','https://www.ema.europa.eu/en/news.xml','European Medicines Agency',0.9),
('Lægemiddelstyrelsen','http://laegemiddelstyrelsen.dk/da/Feeds/rss-feed','Lægemiddelstyrelsen',0.9),
('FDA pressemeddelelser','https://www.fda.gov/about-fda/contact-fda/stay-informed/rss-feeds/press-releases/rss.xml','U.S. Food and Drug Administration',0.85),
('FiercePharma','https://www.fiercepharma.com/rss/xml','FiercePharma',0.7),
('GlobeNewswire pressemeddelelser','https://www.globenewswire.com/RssFeed/subjectcode/17-Press%20Releases','GlobeNewswire',0.5);

-- Seed companies (Danish)
INSERT INTO public.companies (name, aliases, case_sensitive_aliases, ticker, country, sector, is_danish, notes) VALUES
('Novo Nordisk','{"Novo Holdings","Novo Nordisk Fonden","Novo Nordisk Foundation"}','{}','NOVO-B','DK','pharma',true,'Kerne'),
('Genmab','{}','{}','GMAB','DK','pharma',true,null),
('Zealand Pharma','{}','{}','ZEAL','DK','pharma',true,null),
('H. Lundbeck','{"Lundbeck"}','{}','LUN','DK','pharma',true,null),
('ALK-Abelló','{"ALK-Abello"}','{"ALK"}','ALK','DK','pharma',true,'Allergi'),
('Bavarian Nordic','{}','{}','BAVA','DK','pharma',true,null),
('Ascendis Pharma','{"Ascendis"}','{}','ASND','DK','pharma',true,'Dansk HQ, US-noteret'),
('BioPorto','{}','{}','BOPORTO','DK','medtech',true,'Diagnostik'),
('LEO Pharma','{}','{}',null,'DK','pharma',true,'Privat'),
('Xellia Pharmaceuticals','{"Xellia"}','{}',null,'DK','pharma',true,'Privat, Novo Holdings-ejet'),
('Union Therapeutics','{}','{}',null,'DK','pharma',true,'Privat'),
('Ferring Pharmaceuticals','{"Ferring"}','{}',null,'CH','pharma',true,'Schweizisk HQ, dansk-grundlagt'),
('Novonesis','{"Novozymes","Chr. Hansen"}','{}','NZYM-B','DK','other',true,'Tilstødende'),
('Evotec','{}','{}','EVT','DE','pharma',true,'Tilstødende'),
('Coloplast','{}','{}','COLO-B','DK','medtech',true,'Kerne'),
('Ambu','{}','{}','AMBU-B','DK','medtech',true,'Kerne'),
('Demant','{"Oticon"}','{}','DEMANT','DK','medtech',true,'Høreapparater'),
('GN Store Nord','{"GN Hearing","Jabra"}','{"GN"}','GN','DK','medtech',true,null),
('Radiometer','{}','{}',null,'DK','medtech',true,'Danaher-ejet'),
('3Shape','{}','{}',null,'DK','medtech',true,'Privat'),
('Ferrosan Medical Devices','{"Ferrosan"}','{}',null,'DK','medtech',true,'Privat'),
('Nordic Bioscience','{}','{}',null,'DK','medtech',true,'Privat');

-- Seed companies (global)
INSERT INTO public.companies (name, aliases, case_sensitive_aliases, ticker, country, sector) VALUES
('Johnson & Johnson','{"J&J"}','{}','JNJ','US','pharma'),
('Eli Lilly','{"Lilly"}','{}','LLY','US','pharma'),
('Roche','{}','{}','ROG','CH','pharma'),
('Merck & Co','{"MSD"}','{}','MRK','US','pharma'),
('Pfizer','{}','{}','PFE','US','pharma'),
('Novartis','{}','{}','NOVN','CH','pharma'),
('AbbVie','{}','{}','ABBV','US','pharma'),
('AstraZeneca','{}','{}','AZN','UK','pharma'),
('Sanofi','{}','{}','SAN','FR','pharma'),
('GSK','{"GlaxoSmithKline"}','{"GSK"}','GSK','UK','pharma'),
('Bristol Myers Squibb','{"Bristol-Myers Squibb"}','{"BMS"}','BMY','US','pharma'),
('Amgen','{}','{}','AMGN','US','pharma'),
('Gilead Sciences','{"Gilead"}','{}','GILD','US','pharma'),
('Vertex Pharmaceuticals','{}','{}','VRTX','US','pharma'),
('Regeneron','{}','{}','REGN','US','pharma'),
('Biogen','{}','{}','BIIB','US','pharma'),
('Moderna','{}','{}','MRNA','US','pharma'),
('Takeda','{}','{}','4502','JP','pharma'),
('Bayer','{}','{}','BAYN','DE','pharma'),
('Boehringer Ingelheim','{"Boehringer"}','{}',null,'DE','pharma'),
('Daiichi Sankyo','{}','{}','4568','JP','pharma'),
('Astellas','{}','{}','4503','JP','pharma'),
('Otsuka','{}','{}','4578','JP','pharma'),
('Eisai','{}','{}','4523','JP','pharma'),
('CSL','{}','{"CSL"}','CSL','AU','pharma'),
('UCB','{}','{"UCB"}','UCB','BE','pharma'),
('Organon','{}','{}','OGN','US','pharma'),
('Viatris','{}','{}','VTRS','US','pharma'),
('Haleon','{}','{}','HLN','UK','pharma'),
('Medtronic','{}','{}','MDT','IE','medtech'),
('Abbott','{"Abbott Laboratories"}','{}','ABT','US','medtech'),
('Stryker','{}','{}','SYK','US','medtech'),
('Becton Dickinson','{"BD"}','{}','BDX','US','medtech'),
('Siemens Healthineers','{}','{}','SHL','DE','medtech'),
('GE HealthCare','{"GE Healthcare"}','{}','GEHC','US','medtech'),
('Philips','{"Royal Philips"}','{}','PHG','NL','medtech'),
('Boston Scientific','{}','{}','BSX','US','medtech'),
('Intuitive Surgical','{}','{}','ISRG','US','medtech'),
('Danaher','{}','{}','DHR','US','medtech'),
('Thermo Fisher Scientific','{"Thermo Fisher"}','{}','TMO','US','medtech'),
('Alcon','{}','{}','ALC','CH','medtech'),
('Zimmer Biomet','{}','{}','ZBH','US','medtech'),
('Baxter International','{"Baxter"}','{}','BAX','US','medtech'),
('Olympus','{}','{}','7733','JP','medtech'),
('EssilorLuxottica','{}','{}','EL','FR','medtech'),
('Fresenius','{}','{}','FRE','DE','medtech'),
('B. Braun','{}','{}',null,'DE','medtech'),
('Mindray','{}','{}','300760','CN','medtech'),
('Solventum','{}','{}','SOLV','US','medtech'),
('Straumann','{}','{}','STMN','CH','medtech');

-- Fix: BD alias is acronym
UPDATE public.companies SET aliases = '{}', case_sensitive_aliases = '{"BD"}' WHERE name = 'Becton Dickinson';

-- Topics
INSERT INTO public.topics (name, keywords) VALUES
('Godkendelser (EMA/FDA)', '{"approval","approved","godkendelse","godkendt","CHMP","marketing authorisation"}'),
('Opkøb og fusioner', '{"acquisition","acquire","merger","opkøb","fusion","køber"}');

-- Seed test items (is_seed = true)
WITH c AS (
  SELECT id, name, row_number() OVER (ORDER BY is_danish DESC, name) AS rn FROM public.companies WHERE is_danish
),
f AS (SELECT id, publisher, source_weight, row_number() OVER (ORDER BY name) AS rn FROM public.feeds WHERE kind='static'),
g AS (SELECT gs AS n FROM generate_series(1,66) gs),
templ AS (SELECT * FROM (VALUES
 (1,'%s får positiv CHMP-udtalelse for nyt lægemiddel'),
 (2,'%s reports third-quarter results above expectations'),
 (3,'%s announces acquisition of US biotech'),
 (4,'%s udvider produktion i Danmark'),
 (5,'Analyse: Er %s overvurderet?'),
 (6,'FDA approves %s device for new indication')
) t(k, tpl))
INSERT INTO public.items (headline, summary, canonical_url, publisher, feed_id, published_at, headline_norm, is_opinion, is_seed)
SELECT format(templ.tpl, c.name),
       'Testdata – ikke en rigtig nyhed.',
       'https://testdata.lex.local/item/' || g.n,
       f.publisher, f.id,
       now() - (g.n * interval '97 minutes'),
       lower(format(templ.tpl, c.name)),
       templ.k = 5, true
FROM g
JOIN c ON c.rn = ((g.n - 1) % 22) + 1
JOIN f ON f.rn = ((g.n - 1) % 5) + 1
JOIN templ ON templ.k = ((g.n - 1) % 6) + 1;

INSERT INTO public.item_matches (item_id, company_id, matched_terms, relevance_score)
SELECT i.id, c.id, ARRAY[c.name],
  round((COALESCE(fd.source_weight,0.5) * 0.5 + 0.4 + 0.1 * random())::numeric, 2)
FROM public.items i
JOIN public.companies c ON i.headline ILIKE '%' || c.name || '%'
LEFT JOIN public.feeds fd ON fd.id = i.feed_id
WHERE i.is_seed;

INSERT INTO public.item_matches (item_id, topic_id, matched_terms, relevance_score)
SELECT i.id, t.id, ARRAY['seed'], 0.6
FROM public.items i, public.topics t
WHERE i.is_seed AND (
  (t.name LIKE 'Godkendelser%' AND (i.headline ILIKE '%CHMP%' OR i.headline ILIKE '%approves%')) OR
  (t.name LIKE 'Opkøb%' AND i.headline ILIKE '%acquisition%'));

-- 4 unmatched seed items for the archive
INSERT INTO public.items (headline, summary, canonical_url, publisher, published_at, headline_norm, is_seed) VALUES
('Ukendt firma Fluxome Bio rejser kapital','Testdata','https://testdata.lex.local/unmatched/1','GlobeNewswire', now() - interval '3 hours','ukendt firma fluxome bio rejser kapital',true),
('Fluxome Bio indgår partnerskab','Testdata','https://testdata.lex.local/unmatched/2','GlobeNewswire', now() - interval '9 hours','fluxome bio indgår partnerskab',true),
('EU-regler for medicinsk udstyr revideres','Testdata','https://testdata.lex.local/unmatched/3','European Medicines Agency', now() - interval '20 hours','eu-regler for medicinsk udstyr revideres',true);
