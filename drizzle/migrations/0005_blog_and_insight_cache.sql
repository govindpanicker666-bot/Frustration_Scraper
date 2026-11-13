CREATE TABLE public.blog_authors (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  role TEXT,
  bio TEXT,
  avatar_url TEXT,
  website_url TEXT,
  linkedin_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.blog_authors TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.blog_authors TO authenticated;
GRANT ALL ON public.blog_authors TO service_role;
ALTER TABLE public.blog_authors ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read authors" ON public.blog_authors FOR SELECT USING (true);
CREATE POLICY "Admins manage authors" ON public.blog_authors FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TABLE public.blog_posts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  excerpt TEXT,
  content TEXT NOT NULL DEFAULT '',
  content_format TEXT NOT NULL DEFAULT 'html',
  featured_image TEXT,
  featured_image_alt TEXT,
  category TEXT,
  tags TEXT[] NOT NULL DEFAULT '{}',
  meta_title TEXT,
  meta_description TEXT,
  author_name TEXT NOT NULL DEFAULT 'Churnhound Team',
  author_id UUID REFERENCES public.blog_authors(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  published_at TIMESTAMPTZ,
  read_minutes INT,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX blog_posts_status_pub_idx ON public.blog_posts (status, published_at DESC);
CREATE INDEX blog_posts_category_idx ON public.blog_posts (category);
GRANT SELECT ON public.blog_posts TO anon, authenticated;
GRANT ALL ON public.blog_posts TO service_role;
ALTER TABLE public.blog_posts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read published blog posts" ON public.blog_posts FOR SELECT
  USING (status = 'published' AND (published_at IS NULL OR published_at <= now()));

CREATE TABLE public.insight_cache (
  user_id UUID NOT NULL PRIMARY KEY,
  recommendations JSONB NOT NULL DEFAULT '[]',
  lead_count INT NOT NULL DEFAULT 0,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.insight_cache TO authenticated;
GRANT ALL ON public.insight_cache TO service_role;
ALTER TABLE public.insight_cache ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Own insight cache" ON public.insight_cache FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);