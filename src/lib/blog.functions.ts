import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import type { SupabaseClient } from "@supabase/supabase-js";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "@/integrations/supabase/constants";

export type BlogPost = {
  id: string;
  slug: string;
  title: string;
  excerpt: string | null;
  content: string;
  featured_image: string | null;
  featured_image_alt: string | null;
  category: string | null;
  tags: string[];
  meta_title: string | null;
  meta_description: string | null;
  author_name: string;
  author_id: string | null;
  status: string;
  published_at: string | null;
  read_minutes: number | null;
  content_format: string;
  created_at: string;
  updated_at: string;
};

function publicClient() {
  const url = SUPABASE_URL.trim().replace(/\/+$/, "");
  const key = SUPABASE_ANON_KEY.trim();
  return createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, storage: undefined },
    global: {
      fetch: (input, init) => {
        const h = new Headers(init?.headers);
        if (key.startsWith("sb_") && h.get("Authorization") === `Bearer ${key}`)
          h.delete("Authorization");
        h.set("apikey", key);
        return fetch(input, { ...init, headers: h });
      },
    },
  });
}

function readingMinutes(md: string): number {
  const words = md
    .replace(/<[^>]+>/g, " ")
    .replace(/[#>*_`\-[\]()!]/g, " ")
    .split(/\s+/)
    .filter(Boolean).length;
  return Math.max(1, Math.round(words / 220));
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 80);
}

async function assertAdmin(context: { userId: string; supabase: SupabaseClient<Database> }) {
  const { data } = await context.supabase.rpc("has_role", {
    _user_id: context.userId,
    _role: "admin",
  });
  if (!data) throw new Error("Forbidden");
}

// ---------------- PUBLIC READS ----------------

export const listPublishedPosts = createServerFn({ method: "GET" }).handler(async () => {
  const sb = publicClient();
  const { data, error } = await sb
    .from("blog_posts")
    .select(
      "id,slug,title,excerpt,featured_image,featured_image_alt,category,tags,author_name,published_at,read_minutes",
    )
    .eq("status", "published")
    .order("published_at", { ascending: false })
    .limit(200);
  if (error) throw new Error(error.message);
  return { posts: (data ?? []) as Partial<BlogPost>[] };
});

export const getPublishedPostBySlug = createServerFn({ method: "GET" })
  .inputValidator((d: { slug: string }) => d)
  .handler(async ({ data }) => {
    const sb = publicClient();
    const { data: post, error } = await sb
      .from("blog_posts")
      .select("*")
      .eq("slug", data.slug)
      .eq("status", "published")
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!post)
      return { post: null, related: [] as Partial<BlogPost>[], author: null as BlogAuthor | null };
    const { data: related } = await sb
      .from("blog_posts")
      .select("id,slug,title,excerpt,featured_image,category,published_at,read_minutes")
      .eq("status", "published")
      .neq("id", (post as { id: string }).id)
      .eq("category", (post as { category: string | null }).category ?? "")
      .order("published_at", { ascending: false })
      .limit(3);
    const rel = (related ?? []) as Partial<BlogPost>[];
    if (rel.length < 3) {
      const { data: latest } = await sb
        .from("blog_posts")
        .select("id,slug,title,excerpt,featured_image,category,published_at,read_minutes")
        .eq("status", "published")
        .neq("id", (post as { id: string }).id)
        .order("published_at", { ascending: false })
        .limit(6);
      for (const l of latest ?? [])
        if (rel.length < 3 && !rel.some((r) => r.id === l.id)) rel.push(l as Partial<BlogPost>);
    }
    const authorId = (post as { author_id: string | null }).author_id;
    const { data: author } = authorId
      ? await sb.from("blog_authors").select("*").eq("id", authorId).maybeSingle()
      : { data: null };
    return { post: post as BlogPost, related: rel, author: author as BlogAuthor | null };
  });

// ---------------- ADMIN OPS ----------------

export const adminListAllPosts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("blog_posts")
      .select("id,slug,title,status,category,published_at,updated_at,read_minutes")
      .order("updated_at", { ascending: false });
    if (error) throw new Error(error.message);
    return { posts: (data ?? []) as Partial<BlogPost>[] };
  });

export const adminGetPost = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => d)
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: post, error } = await supabaseAdmin
      .from("blog_posts")
      .select("*")
      .eq("id", data.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return { post: (post ?? null) as BlogPost | null };
  });

export type SavePostInput = {
  id?: string | undefined;
  slug: string;
  title: string;
  excerpt?: string | undefined;
  content: string;
  featured_image?: string | undefined;
  featured_image_alt?: string | undefined;
  category?: string | undefined;
  tags?: string[] | undefined;
  meta_title?: string | undefined;
  meta_description?: string | undefined;
  author_name?: string | undefined;
  author_id?: string | null | undefined;
  status: "draft" | "published";
  content_format?: string | undefined;
  published_at?: string | null | undefined;
};

export const adminSavePost = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: SavePostInput) => d)
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const slug = slugify(data.slug || data.title);
    if (!slug) throw new Error("Slug required");
    const payload = {
      slug,
      title: data.title,
      excerpt: data.excerpt ?? null,
      content: data.content,
      featured_image: data.featured_image ?? null,
      featured_image_alt: data.featured_image_alt ?? null,
      category: data.category ?? null,
      tags: data.tags ?? [],
      meta_title: data.meta_title ?? null,
      meta_description: data.meta_description ?? null,
      author_name: data.author_name || "Churnhound Team",
      author_id: data.author_id ?? null,
      status: data.status,
      read_minutes: readingMinutes(data.content),
      content_format: data.content_format || "html",
      published_at: data.published_at
        ? new Date(data.published_at).toISOString()
        : data.status === "published"
          ? new Date().toISOString()
          : null,
      created_by: context.userId,
    };
    if (data.id) {
      // Preserve original published_at if already published
      const { data: existing } = await supabaseAdmin
        .from("blog_posts")
        .select("published_at,status")
        .eq("id", data.id)
        .maybeSingle();
      const ex = existing as { published_at: string | null; status: string } | null;
      if (
        !data.published_at &&
        ex?.status === "published" &&
        ex.published_at &&
        data.status === "published"
      ) {
        payload.published_at = ex.published_at;
      }
      const { data: row, error } = await supabaseAdmin
        .from("blog_posts")
        .update(payload)
        .eq("id", data.id)
        .select()
        .single();
      if (error) throw new Error(error.message);
      return { post: row as BlogPost };
    }
    const { data: row, error } = await supabaseAdmin
      .from("blog_posts")
      .insert(payload)
      .select()
      .single();
    if (error) throw new Error(error.message);
    return { post: row as BlogPost };
  });

export const adminDeletePost = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => d)
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("blog_posts").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ---------------- AI DRAFT ----------------

function jsonExtract(text: string): unknown | null {
  const m = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = (m ? (m[1] ?? "") : text).trim();
  try {
    return JSON.parse(raw);
  } catch {
    /* noop */
  }
  const s = raw.search(/[[{]/);
  const end = Math.max(raw.lastIndexOf("}"), raw.lastIndexOf("]"));
  if (s < 0 || end < s) return null;
  try {
    return JSON.parse(raw.slice(s, end + 1));
  } catch {
    return null;
  }
}

export const adminAiDraftFromSource = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { source: string; hint?: string | undefined }) => d)
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const src = (data.source || "").slice(0, 60000);
    if (src.trim().length < 40) throw new Error("Source text too short");

    const system = `You are a senior B2B content editor writing for Churnhound, a tool that finds frustrated customers of competitors and turns them into leads.
Write clearly and warmly, like explaining to a smart friend. Vary sentence length. Avoid AI-marketing filler and buzzwords.
HARD RULE: Never use double em dashes ("--"). Use commas, periods, or parentheses instead.
Use Markdown. Use H2 (##) and H3 (###) headings. Add short pull-quote lines starting with "> " where a takeaway is naturally quotable.
Structure a self-contained answer under at least one question-style H2 so answer engines can extract it cleanly.`;

    const prompt = `Transform the following source material into a publish-ready blog post for Churnhound.
${data.hint ? `Editor hint: ${data.hint}\n` : ""}
Return ONLY strict JSON matching this shape (no prose, no code fences):
{
  "title": "string (compelling, keyword-relevant, under 70 chars)",
  "slug": "string (kebab-case, no stopwords, under 60 chars)",
  "excerpt": "string (1-2 sentences, under 200 chars)",
  "meta_title": "string (under 60 chars)",
  "meta_description": "string (under 160 chars)",
  "category": "one of: Competitive Intelligence | Sales Playbooks | Customer Churn | Growth Marketing | Product Updates",
  "tags": ["3-6 short tags"],
  "content_markdown": "the full blog post in Markdown, 800-1400 words, with H2/H3, short paragraphs, and at least one '> ' pull-quote"
}

SOURCE:
"""
${src}
"""`;

    const { callGeminiText } = await import("./ai.server");
    const text = await callGeminiText(system, prompt);
    const parsed = jsonExtract(text) as Record<string, unknown> | null;
    if (!parsed || typeof parsed !== "object") throw new Error("AI returned unparseable output");
    const { marked } = await import("marked");
    const md = String(parsed["content_markdown"] || "").replace(/--/g, ",");
    const out = {
      title: String(parsed["title"] || "Untitled draft"),
      slug: slugify(String(parsed["slug"] || parsed["title"] || "untitled")),
      excerpt: String(parsed["excerpt"] || ""),
      meta_title: String(parsed["meta_title"] || parsed["title"] || ""),
      meta_description: String(parsed["meta_description"] || parsed["excerpt"] || ""),
      category: String(parsed["category"] || "Competitive Intelligence"),
      tags: Array.isArray(parsed["tags"])
        ? (parsed["tags"] as unknown[]).map(String).slice(0, 8)
        : [],
      content: marked.parse(md, { gfm: true, async: false }) as string,
    };
    void context;
    return { draft: out };
  });
// ---------------- AUTHORS ----------------
export type BlogAuthor = {
  id: string;
  name: string;
  role: string | null;
  bio: string | null;
  avatar_url: string | null;
  website_url: string | null;
  linkedin_url: string | null;
};

export const listAuthors = createServerFn({ method: "GET" }).handler(async () => {
  const { data, error } = await publicClient().from("blog_authors").select("*").order("name");
  if (error) throw new Error(error.message);
  return { authors: (data ?? []) as BlogAuthor[] };
});

export const adminSaveAuthor = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: Partial<BlogAuthor> & { name: string }) => d)
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const row = {
      name: data.name.trim().slice(0, 120),
      role: data.role ?? null,
      bio: data.bio ?? null,
      avatar_url: data.avatar_url ?? null,
      website_url: data.website_url ?? null,
      linkedin_url: data.linkedin_url ?? null,
    };
    if (!row.name) throw new Error("Name required");
    const q = data.id
      ? context.supabase.from("blog_authors").update(row).eq("id", data.id)
      : context.supabase.from("blog_authors").insert(row);
    const { data: saved, error } = await q.select().single();
    if (error) throw new Error(error.message);
    return { author: saved as BlogAuthor };
  });

export const adminDeleteAuthor = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => d)
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { error } = await context.supabase.from("blog_authors").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
