ALTER TABLE public.currents_evaluation_requests ADD COLUMN provider_info jsonb NOT NULL DEFAULT '{}';
