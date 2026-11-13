# Plan: more competitors, reliable news, kept leads, user scheduling, 9 new sources, Page Builder

## 1. Competitors: 20 minimum, up to 40

- Detection asks for 20–40 real direct competitors; it stops when it runs out of genuine ones instead of padding.
- Results are checked: duplicates, the user's own company, and off-category giants are dropped.

## 2. Competitor News that works for big companies

- Keep the feed reader, then also read each competitor's `/blog`, `/articles`, `/newsroom`, `/news`, `/press`, `/changelog` pages.
- Pull posts from structured page data (article tags, JSON-LD) and from article links with dates on the page.
- The AI still picks the 5–7 important items with "Why it matters" and a sales move.

## 3. Leads never vanish

- Removing a competitor or re-running detection no longer deletes leads. Leads keep the competitor name; the link is just cleared.
- Dashboard and Insights numbers follow current competitors; the Leads page shows all saved leads.

## 4. Daily scheduling for every user

- Each user (not just admin) gets an on/off switch and start time for daily scraping of their own competitors.
- No platform choice for users: always all platforms. Manual scrape and platform picker stay admin-only.
- The 10-minute background job walks through all users' competitors in turn, with a per-day cap.

## 5. Nine new sources (48-hour date rule stays)

AlternativeTo, Discourse forums, Quora, YouTube comments, Sitejabber, TrustRadius, public feedback boards (Canny, Featurebase, Upvoty), BBB.org.

- Each reports ok / blocked / no match, so one blocked site never stops a run.
- Posts with no date or older than 48 hours are skipped. Quora/YouTube are best-effort (they may block servers).

## 6. Interactive Page Builder (admin only, separate from Blog)

- New admin page: block library (left), canvas with drag-and-drop + up/down (center), block settings (right), top bar with title, slug, SEO description, Save draft, Publish, Preview.
- Blocks: Hero, Rich text, Comparison table (rows/columns, check/cross/text cells), Review cards (real complaints pulled for a chosen competitor), Feature grid, FAQ accordion, Pricing table, Lead capture form, Image / YouTube, CTA banner.
- Public pages at `/p/<slug>` (e.g. `/p/mixpanel-vs-us`) with per-page title/description tags. Styled with the current Sora/Manrope, light/dark, flat look (not Calibri/glassmorphism, per your earlier design choice).
- Comparison table and review cards get the most polished design.

## Technical details

- Competitor deletion: change `leads.competitor_id` to nullable with `ON DELETE SET NULL`; onboarding stops cascade-deleting.
- Scheduling: new `user_scrape_settings` (user_id, enabled, run_hour, progress jsonb, pause_reason). Cron route iterates enabled users, one competitor per tick, using `scrapeCore(…, "all")`. Admin global settings stay.
- News: `pageCandidates(domain)` + pure `parseNewsHtml` (JSON-LD, `<article>`, dated links) in `pipeline.ts` with tests.
- Sources: new scraper functions in `scrapers.server.ts`; Quora/YouTube/TrustRadius found via existing web search, others via public pages/JSON.
- Page builder tables: `custom_pages` (id, title, slug unique, seo_description, status, created_at) and `page_blocks` (id, page_id FK cascade, block_type, content jsonb, order_index). Public read of published pages only; admin-only writes via `has_role`. Lead form submissions go to a new `page_submissions` table (public insert), since `leads` requires an owner and competitor.
- Review cards read through a public server function returning only complaint text, platform, score, first name.
- Routes: `_authenticated/page-builder.tsx`, `_authenticated/page-builder.$id.tsx`, `p.$slug.tsx`. Drag-and-drop with `@dnd-kit`.
