ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS pitch_message text;
CREATE TABLE public.scrape_settings (
  id int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  enabled boolean NOT NULL DEFAULT false,
  run_hour int NOT NULL DEFAULT 6 CHECK (run_hour BETWEEN 0 AND 23),
  last_run_at timestamptz,
  last_result jsonb,
  pause_reason text,
  lock_until timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, UPDATE, INSERT ON public.scrape_settings TO authenticated;
GRANT ALL ON public.scrape_settings TO service_role;
ALTER TABLE public.scrape_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins read settings" ON public.scrape_settings FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "admins update settings" ON public.scrape_settings FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "admins insert settings" ON public.scrape_settings FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin'));
INSERT INTO public.scrape_settings (id) VALUES (1) ON CONFLICT DO NOTHING;