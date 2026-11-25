-- Omitted metadata on status changes must never erase the editorial reference or note.
-- Also protects updates from browser tabs running the previous published client.
CREATE FUNCTION public.preserve_editorial_reference() RETURNS trigger
LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
  NEW.article_ref := coalesce(NEW.article_ref,OLD.article_ref);
  NEW.note := coalesce(NEW.note,OLD.note);
  RETURN NEW;
END $$;
CREATE TRIGGER preserve_editorial_reference BEFORE UPDATE ON public.item_actions
FOR EACH ROW EXECUTE FUNCTION public.preserve_editorial_reference();

-- New companies require explicit opt-in to the paused Google News integration.
-- Preserve all existing company flags and source settings.
ALTER TABLE public.companies ALTER COLUMN google_news_enabled SET DEFAULT false;
