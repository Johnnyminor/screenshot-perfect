-- Activate only after the announcement adapter has been published.
ALTER TABLE public.feeds DROP CONSTRAINT feeds_connector_check;
ALTER TABLE public.feeds ADD CONSTRAINT feeds_connector_check
  CHECK (connector IN ('rss','clinicaltrials','pubmed','currents','announcements'));
INSERT INTO public.feeds
  (name,url,publisher,source_weight,kind,connector,company_id,poll_interval_minutes,active)
SELECT 'Bavarian Nordic direkte meddelelser',
  'https://www.bavarian-nordic.com/investor/news/news.aspx',
  c.name,0.95,'static','announcements',c.id,60,false
FROM public.companies c WHERE c.name='Bavarian Nordic'
  AND NOT EXISTS (SELECT 1 FROM public.feeds f WHERE f.url='https://www.bavarian-nordic.com/investor/news/news.aspx');
