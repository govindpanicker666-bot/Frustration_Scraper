CREATE TABLE public.competitor_news (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  competitor_id uuid,
  competitor_name text NOT NULL,
  title text NOT NULL,
  summary text,
  url text NOT NULL,
  published_date timestamptz,
  tactical_advice text,
  news_type text NOT NULL DEFAULT 'other',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, url)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.competitor_news TO authenticated;
GRANT ALL ON public.competitor_news TO service_role;
ALTER TABLE public.competitor_news ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own news select" ON public.competitor_news FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "own news insert" ON public.competitor_news FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own news update" ON public.competitor_news FOR UPDATE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "own news delete" ON public.competitor_news FOR DELETE TO authenticated USING (auth.uid() = user_id);