# Churnhound: DuckDuckGo everywhere, pro UI, contacts, blog system

## 1. Stop using Google search grounding

- All grounded searches (LinkedIn, X, indexed reviews, ComplaintsBoard, enrichment fallback) switch to DuckDuckGo HTML search (`site:linkedin.com/posts`, `site:x.com`, etc.).
- X posts resolved via free oEmbed; LinkedIn author from post URL slug.
- Public RSS fallbacks (Nitter/RSSHub-style mirrors when reachable, Google News RSS) for X/LinkedIn mentions.
- Gemini is used only for scoring/writing, never for search.

## 2. Contact details for every lead (the earlier flow)

- Remove the "review sites only" gate: any author with a real name gets enriched, including social posts.
- Flow per lead: platform profile (GitHub API, Bluesky profile + handle domain, HN bio, Mastodon profile links) -> DuckDuckGo LinkedIn lookup -> company domain via DuckDuckGo -> site scrape -> GitHub commits -> company pattern -> Gravatar -> likely guess (MX checked).
- "Re-find contacts" button on a lead and an admin "Re-enrich all leads" action for existing leads.

## 3. Leads page fixes

- "View source thread" and "Original post" were the same link: keep one "Original post"; the contact button shows only a real profile (LinkedIn / platform profile) or a clearly labelled "Reply on <platform>".
- Always-visible "How to contact" box in the drawer.

## 4. Strategic recommendations caching

- Saved in the database; the Insights page reads the saved version. Regenerated only when new leads arrived since last generation (or manual "Refresh").

## 5. Better content ideas

- Prompt includes OUR company (name, site, description, category from onboarding) and the competitor, plus several real complaint quotes, so ideas are specific (e.g. for a music AI company: "Why musicians abandon <competitor>'s clunky mixer and what pros use instead"), not generic "how to improve interface".
- Returns blog titles + LinkedIn hooks with a one-line angle each.

## 6. Interface overhaul

- Fonts: Sora (headings, numbers) + Manrope (body); replaces Calibri.
- Dark / light mode toggle in the header, remembered per browser.
- Less "AI-looking": drop glow/gradient glass and emoji, use flat surfaces, thin borders, restrained single accent, tighter spacing, consistent table/card styling, plain-language headings.
- Mobile: collapsible nav menu, leads shown as cards under 768px, stacked filters and admin cards, full-width drawer.

## 7. Blog system (admin) — based on the uploaded files

- Admin pages: post list (drafts/published, search, delete) and full editor.
- Editor (Tiptap): H1-H5, bold, italic, underline, strike, sub/superscript, colors, highlight, alignment, links, lists, tables, code blocks, YouTube, inline images (upload), slash commands, drag handle.
- Custom boxes: Did you know, Quote/pull quote, TL;DR, FAQ, CTA, table of contents, file attachment, Also Read (auto-shows our latest/related published posts).
- Post settings: slug, cover image + alt, excerpt, category, tags, meta title, meta description, meta tags/keywords, read time auto-calculated, draft/publish/schedule.
- Authors: name, profile photo, bio, link/social; pick an author per post.
- Public pages: `/blog` (list, category filter) and `/blog/<slug>` (rendered post, author box, related posts) with full SEO tags. Brand "Churnhound"; canonical domain uses the site's own address until a custom domain exists.

## Technical details

- Install the Tiptap packages listed by the user.
- Migrations: `blog_posts` (user's schema + `meta_keywords text[]`, `author_id`, `featured_image` path), `blog_authors` (name, slug, bio, avatar, links), `insight_cache` (recommendations json + generated_at + lead_count). Grants + RLS: public reads published posts/authors; admin-only writes via `has_role`.
- Storage bucket `blog-media` created with the storage tool (public read for images so posts render), admin-only upload policies.
- Port uploaded files: `nodes.ts`, `slash-command.ts`, `RichEditor.tsx`, `RichContentView.tsx`, `MarkdownView.tsx`, `blog.functions.ts` (admin guard -> `has_role`), `blog-media.functions.ts`, `$.ts` media route, `blog-admin.tsx`, `blog-editor.$id.tsx`; add `.prose-blog` / `.tiptap-surface` styles using theme tokens. Write new `blog.index.tsx` and `blog.$slug.tsx`.
- New `src/lib/search.server.ts` (DuckDuckGo HTML parse) used by scrapers and enrichment; `geminiGrounded` removed.
- Pure helpers (DDG result parsing, insight staleness rule) get tests in `pipeline.test.ts`.
