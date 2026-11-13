ALTER TABLE public.leads DROP CONSTRAINT IF EXISTS leads_competitor_id_fkey;
ALTER TABLE public.leads ALTER COLUMN competitor_id DROP NOT NULL;
ALTER TABLE public.leads ADD CONSTRAINT leads_competitor_id_fkey FOREIGN KEY (competitor_id) REFERENCES public.competitors(id) ON DELETE SET NULL;

CREATE TABLE public.user_scrape_settings (
  user_id uuid PRIMARY KEY,
  enabled boolean NOT NULL DEFAULT false,
  run_hour integer NOT NULL DEFAULT 6,
  progress jsonb,
  pause_reason text,
  last_run_at timestamptz,
  lock_until timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.user_scrape_settings TO authenticated;
GRANT ALL ON public.user_scrape_settings TO service_role;
ALTER TABLE public.user_scrape_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own schedule read" ON public.user_scrape_settings FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "own schedule insert" ON public.user_scrape_settings FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own schedule update" ON public.user_scrape_settings FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TABLE public.custom_pages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL DEFAULT 'Untitled page',
  slug text NOT NULL UNIQUE,
  seo_description text,
  status text NOT NULL DEFAULT 'draft',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.page_blocks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  page_id uuid NOT NULL REFERENCES public.custom_pages(id) ON DELETE CASCADE,
  block_type text NOT NULL,
  content jsonb NOT NULL DEFAULT '{}'::jsonb,
  order_index integer NOT NULL DEFAULT 0
);
CREATE INDEX page_blocks_page_idx ON public.page_blocks(page_id, order_index);
CREATE TABLE public.page_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  page_id uuid REFERENCES public.custom_pages(id) ON DELETE SET NULL,
  name text,
  email text NOT NULL,
  company text,
  message text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.custom_pages, public.page_blocks TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.custom_pages, public.page_blocks TO authenticated;
GRANT SELECT, DELETE ON public.page_submissions TO authenticated;
GRANT ALL ON public.custom_pages, public.page_blocks, public.page_submissions TO service_role;
ALTER TABLE public.custom_pages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.page_blocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.page_submissions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public reads published pages" ON public.custom_pages FOR SELECT TO anon, authenticated USING (status = 'published' OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "admins manage pages" ON public.custom_pages FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "public reads published blocks" ON public.page_blocks FOR SELECT TO anon, authenticated USING (EXISTS (SELECT 1 FROM public.custom_pages p WHERE p.id = page_id AND (p.status = 'published' OR public.has_role(auth.uid(), 'admin'))));
CREATE POLICY "admins manage blocks" ON public.page_blocks FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "admins read submissions" ON public.page_submissions FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "admins delete submissions" ON public.page_submissions FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'));