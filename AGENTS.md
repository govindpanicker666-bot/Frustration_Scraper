<!-- LOVABLE:BEGIN -->

> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.

## What Lovable manages

Rules outside this block are the project's own. Change the pieces below in
Lovable, not by hand. With the [Lovable MCP](https://mcp.lovable.dev)
connected, `send_message` asks Lovable to do it; otherwise ask the user to
use the editor.

- **Database.** Do not add or edit `supabase/migrations/` or `drizzle/`.
  Ask Lovable to change the schema.
- **Generated files.** Do not edit a file whose header says it is automatically
  generated.
- **AI gateway.** Keep model calls on Lovable's gateway, and keep
  `LOVABLE_API_KEY` out of browser code.
- **Connectors.** Lovable provides native connectors. `list_connectors` shows
  which are enabled; `add_connector` only returns the dashboard link. When a
  connector is enabled, calls go through the connector gateway and need
  `LOVABLE_API_KEY`. When Lovable does not provide one, users can bring their
  own key and store it in Secrets.
- **Secrets.** Lovable manages them. Do not put secret values in the repo.

<!-- LOVABLE:END -->

## Project rules

- Scraping/AI pipeline lives in `src/lib/*.server.ts` and is exposed only via admin-checked server functions in `src/lib/leads.functions.ts`; pure filters/rules live in `src/lib/pipeline.ts` with tests, so business rules stay testable without network.
- Roles live only in `user_roles` and are checked with `has_role()`; the signup trigger makes the first user admin.
- Each review source in `scrapers.server.ts` returns a status (ok/blocked/no_match/no_key) instead of throwing, so one blocked site never stops a scrape.
- Enrichment (`enrich.server.ts`) tries free DuckDuckGo first, falls back to Gemini grounding; emails come from site scrape -> GitHub commits -> detected company pattern -> Gravatar -> guess (no SMTP: hosting blocks port 25).
- Competitor news reads each competitor's public RSS/Atom feed (homepage <link> first, then common paths) via `src/lib/insights.functions.ts`; feed parsing is pure in `pipeline.ts` so it's testable.
- AI calls rotate GEMINI_API_KEY -> GEMINI_API_KEY_2 on quota errors, falling back to a second model on 404, so one exhausted key doesn't stop runs.
- Scrape/analyze core lives in `src/lib/run.server.ts` (takes a Supabase client) so admin server functions and the daily cron route `/api/public/jobs/daily-scrape` share it; the cron does one competitor per 10-minute tick, tracked in `scrape_settings`, so runs stay short and resumable.
- Web search lives only in `src/lib/search.server.ts` (DuckDuckGo HTML, Bing RSS fallback, parsers in `pipeline.ts`); no AI search grounding, so search never consumes Gemini quota.
- Contact finding for every lead goes through `findContact()` in `enrich.server.ts` (platform profile API first, then LinkedIn/company/email steps), shared by scraping and "Re-find contacts".
- Blog: posts/authors in `blog_posts`/`blog_authors`, media in private `blog-media` bucket served via `/api/public/blog-media/$`; admin writes are checked with `has_role` in `blog.functions.ts`.
- Strategic recommendations are cached in `insight_cache` and regenerated only when the user's lead count changes, to save AI calls.
- Analysis requires negative sentiment and a verbatim complaint quote before saving; deduplication uses scoped contact/profile identity or exact substantial cross-post text, never display-name similarity, to prevent false leads and aliases.
- Daily scraping is per user (`user_scrape_settings`, always all platforms); the cron route walks enabled users one competitor per tick, so every account gets automation without manual controls.
- Leads reference competitors with ON DELETE SET NULL, so removing/re-detecting competitors never deletes leads; dashboards filter to current competitors.
- Competitor news falls back from RSS/Atom to HTML blog/news pages parsed by pure `parseNewsHtml` in `pipeline.ts`.
- Page Builder (admin): `custom_pages` + ordered `page_blocks` (jsonb content), block registry/renderer in `src/components/pages/blocks.tsx`, public pages at `/p/$slug`; kept separate from the blog.
