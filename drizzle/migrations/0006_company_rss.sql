-- Verified first-party RSS. Older feed entries remain subject to the collector's 30-day window.
-- Keep company/source identity in database rows, including feeds with unnamed research headlines.
INSERT INTO public.feeds
  (name,url,publisher,source_weight,kind,connector,company_id,poll_interval_minutes,active)
SELECT v.company_name || ' nyheder',v.url,v.company_name,0.9,'static','rss',c.id,60,true
FROM (VALUES
  ('Nordic Bioscience','https://www.nordicbioscience.com/feed/'),
  ('Union Therapeutics','https://uniontherapeutics.com/feed/'),
  ('BioPorto','https://bioporto.com/feed/'),
  ('Ferrosan Medical Devices','https://www.ferrosanmedicaldevices.com/feed/')
) AS v(company_name,url)
JOIN public.companies c ON c.name=v.company_name
WHERE NOT EXISTS (SELECT 1 FROM public.feeds f WHERE f.url=v.url);
