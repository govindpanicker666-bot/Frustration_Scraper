# Lower lead threshold, add 7 sources, smarter Insights, Competitor News

## 1. Frustration threshold 8 -> 5

- Leads with a frustration score of 5 or more are saved (was 8).
- Leads page score filter, score badges and Admin text updated to match ("5+").
- Saved preference and tests updated.

## 2. New sources (all free, no keys)

| Source                 | How                                                                                | Note                                                                                                               |
| ---------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Reddit                 | Public search JSON (`reddit.com/search.json?q=...&sort=new`)                       | Endpoint is real; Reddit often blocks cloud servers, so it may show "blocked". Lifts the earlier "no Reddit" rule. |
| ComplaintsBoard        | Public complaint pages, parsed from HTML                                           | Text, date, author, rating                                                                                         |
| Discourse forums       | Improved: also probe `forum.`, `community.`, `discuss.` domains via `/search.json` | Already partly built                                                                                               |
| GitHub                 | Public issues/discussions search API                                               | 60 searches/hour without a token                                                                                   |
| Lemmy                  | Public search API on lemmy.world                                                   |                                                                                                                    |
| Substack / Medium      | Medium tag RSS + Substack search                                                   |                                                                                                                    |
| Google-indexed reviews | Gemini with Google Search finds recent Trustpilot/G2/Capterra reviews              | Only used when direct scraping is blocked; must include a date within the window, otherwise dropped                |

All new sources are Social Signal leads except ComplaintsBoard and Google-indexed reviews, which follow the full-name review rules. Each reports ok / blocked / not found in Admin.

## 3. Insights: Strategic Recommendations

- New section under the charts with a glowing emerald card, subtitle "Target these pain points".
- Sends the Top 5 complaints to Gemini with your exact prompt; shows 3 recommendations.
- Loading skeleton while it generates; "Regenerate" button; message if there are no complaints yet.

## 4. Competitor News & PR

- New "Competitor News" page in the sidebar.
- "Refresh news" tries each competitor's feed (`/feed`, `/rss`, `/blog/rss`, `/blog/feed`, `/rss.xml`, `/feed.xml`, plus any feed link on the homepage) and takes the latest 3 posts.
- Gemini writes a short summary, picks a type (Funding, PR, Pricing, Product, Other) and one sentence of Tactical Advice.
- Feed shows icon by type (Rocket funding, Megaphone PR, Tag pricing, Sparkles product, Newspaper other), title, date, link, and Tactical Advice in a highlighted box.
- Competitors without a feed are listed as "no feed found".

## Technical details

- `pipeline.ts`: `MIN_LEAD_SCORE = 5`; tests updated. Memory index updated (threshold, Reddit allowed).
- Scrapers added to `scrapers.server.ts` behind existing `{status, reviews}` interface; new platform ids in `PLATFORMS`.
- Migration: `competitor_news` (id, user_id, competitor_id, competitor_name, title, summary, url, published_date, tactical_advice, news_type, created_at), unique (user_id, url), grants + owner-only RLS.
- Server fns (auth): `generateRecommendations`, `refreshCompetitorNews`, `listCompetitorNews`; all Gemini calls via the user's key.
- New route `src/routes/_authenticated/news.tsx` with head metadata; sidebar link.
