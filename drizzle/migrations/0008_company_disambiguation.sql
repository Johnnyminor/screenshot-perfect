-- Data-driven company identity rules. Existing editorial whole-story exclusions remain separate.
ALTER TABLE public.companies
  ADD COLUMN ambiguous_terms text[] NOT NULL DEFAULT '{}',
  ADD COLUMN context_terms text[] NOT NULL DEFAULT '{}',
  ADD COLUMN excluded_name_phrases text[] NOT NULL DEFAULT '{}';

WITH rules(name,ambiguous,other_names,strong_context) AS (VALUES
 ('Bayer',ARRAY['Bayer'],ARRAY['Bayer Leverkusen','Bayer 04 Leverkusen'],ARRAY['Bayer AG','Bayer A/S','Roundup','Monsanto','agrochemical*','herbicide*']),
 ('Abbott',ARRAY['Abbott'],ARRAY['Greg Abbott','governor Abbott','guvernør Abbott','guvernör Abbott'],ARRAY['Abbott Laboratories','Amplatzer','FreeStyle','Alinity']),
 ('B. Braun',ARRAY['B. Braun'],ARRAY['B. Braun Sheffield Sharks','B Braun Sheffield Sharks'],ARRAY['B. Braun Medical','B. Braun Melsungen','Aesculap']),
 ('Evotec',ARRAY['Evotec'],ARRAY['Evotec AS','Evotec Marine','Evotec Fish'],ARRAY['Evotec SE','Evotec AG','Just-Evotec','drug discovery']),
 ('Baxter International',ARRAY['Baxter'],ARRAY['Jim Baxter','Stuart Baxter'],ARRAY['Baxter International','Baxter A/S','Hillrom','Sendoxan']),
 ('Gilead Sciences',ARRAY['Gilead'],ARRAY['Republic of Gilead','Republikken Gilead'],ARRAY['Gilead Sciences','Tybost','Truvada','Biktarvy','Trodelvy','Leger Uten Grenser','Læger uden Grænser','Doctors Without Borders','Médecins Sans Frontières'])
), shared(context) AS (VALUES (ARRAY[
 'pharma*','biotech*','biopharma*','medical','medicine*','medicin*','medtech','healthcare',
 'drug*','therapeutic*','clinical','clinic*','trial*','diagnostic*','hospital*','patient*',
 'vaccine*','vaksin*','laborator*','legemiddel*','lægemiddel*','farmaceut*','sundhed*',
 'cancer','oncolog*','FDA','EMA','diabetes','immunotherap*','radiofarma*'
]))
UPDATE public.companies c SET
 ambiguous_terms=ARRAY(SELECT DISTINCT unnest(c.ambiguous_terms || r.ambiguous)),
 context_terms=ARRAY(SELECT DISTINCT unnest(c.context_terms || r.strong_context || s.context)),
 excluded_name_phrases=ARRAY(SELECT DISTINCT unnest(c.excluded_name_phrases || r.other_names))
FROM rules r CROSS JOIN shared s WHERE c.name=r.name;
