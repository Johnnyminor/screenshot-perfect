-- Official public company news pages and their linked distribution service.
-- Enable only after publishing and validating the corresponding adapters.
INSERT INTO public.feeds
  (name,url,publisher,source_weight,kind,connector,company_id,poll_interval_minutes,active)
SELECT c.name || ' direkte meddelelser',v.url,c.name,0.95,'static','announcements',c.id,60,false
FROM (VALUES
  ('Novonesis','https://tools.eurolandir.com/tools/pressreleases/?companycode=dk-nzmb&v=r2024&lang=en-gb'),
  ('Ambu','https://www.ambu.com/corporate-info/investors/news-from-ambu'),
  ('ALK-Abelló','https://www.alk.net/press')
) AS v(company_name,url)
JOIN public.companies c ON c.name=v.company_name
WHERE NOT EXISTS (SELECT 1 FROM public.feeds f WHERE f.url=v.url);
