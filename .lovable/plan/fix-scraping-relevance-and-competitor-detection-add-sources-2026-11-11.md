# Fix scraping, relevance and competitor detection; add sources and a 5-step enrichment flow

## Why things are broken today

- **G2 and App Store** fail or return little. Their sites block cloud servers or need the exact product page.
- **Wrong posts (Omnia -> Omnisphere):** searches use the bare name, and nothing checks the post is actually about that product.
- **Wrong competitors:** the AI only sees your company name and website address, so it guesses.

## What gets built

**1. Better competitor detection**

- Read your homepage before asking Gemini.
- Use Gemini with Google Search so suggestions are real, current products.
- Save each competitor with its website, a short description and keywords.
- Add a "Re-detect competitors" button.

**2. Relevance filter (fixes Omnia/Omnisphere)**

- Searches use the exact quoted name plus the competitor's website or category words.
- Gemini checks each post is really about that competitor. Anything else is thrown away.
- Admin shows found / relevant / scored / saved counts.

**3. Sources (all free)**

| Source       | Method                                                                                           | Reliability        |
| ------------ | ------------------------------------------------------------------------------------------------ | ------------------ |
| Hacker News  | Algolia API + relevance filter                                                                   | High               |
| Product Hunt | Official API using your key and secret                                                           | High               |
| Trustpilot   | Public review page for the competitor's website                                                  | Medium             |
| Capterra     | Public review page                                                                               | Low–medium         |
| G2           | Public review page                                                                               | Low (often blocks) |
| App Store    | Found through the developer's website, so it picks the right app                                 | High               |
| Google Play  | Public web review page                                                                           | Medium             |
| Bluesky      | Public search, no key                                                                            | High               |
| Mastodon     | Public search                                                                                    | Medium             |
| Forums       | Discourse community forums, Lobsters, Stack Exchange, Dev.to: public and free, no key or captcha | Medium–high        |

Reddit is left out for now. X, LinkedIn posts, Instagram and Facebook have no free way to read posts, so they're skipped. If a source is blocked, Admin shows "blocked" for it and the others keep running.

**4. Enrichment (your 5-step flow)**

1. **Screen reviews first:** review sites need a real first and last name and a post from the last 48 hours. "Verified User" and "Anonymous" are skipped before any lookup runs.
2. **Find their company:** Gemini pulls out the name, job title and any company mentioned. If none is mentioned, search DuckDuckGo with `"Name" "Job Title" site:linkedin.com/in/`. The top result gives the LinkedIn link and its snippet gives the current company.
3. **Find the email:** get the employer's website (not the competitor's), try common patterns (first.last@, first@, flast@...), and check that the website accepts email.
4. **Fallback:** with no email, the LinkedIn profile is the lead. Posts from forums and social sites skip the email step. They save the thread link, tagged **Social Signal**.
5. **Final filter:** a lead is saved only if it has an email, a LinkedIn link, or a thread link. Anything else is quietly dropped.

The Leads table gets Email, LinkedIn, Company, Job title and a Social Signal tag.

## Keys

- I'll store your Product Hunt key and secret securely when building. No other keys are needed.

## Honest limits

- **Email checking:** Prospector, OpenLeads and ColdReach run on your own computer. To confirm a single inbox, they contact the email server directly, and this hosting can't do that. Instead, I'll run the checks that work here: common patterns, confirming the website accepts email, and flagging websites that accept any address. Emails are labelled "likely", not "verified". A real inbox check would need an outside checker.
- DuckDuckGo may slow down searches if there are too many, so they're spaced out.
- G2 and Capterra may still block.

## Technical details

- Migration: `competitors` gets `domain`, `description`, `keywords text[]`. `leads` gets `email`, `email_status`, `job_title`, `company`, `company_domain`, `linkedin_url`, `lead_type` (email|linkedin|social_signal), plus `platform` as text so new sources can be added.
- `src/lib/scrapers/*.server.ts`: one file per source behind a shared interface, each returning `{status, reviews}`.
- `ai.server.ts`: `geminiGrounded()` (google_search tool) and a batched `filterRelevant()`.
- `enrich.server.ts`: Gemini extracts {name, title, company}, DDG LinkedIn search with snippet parsing, company→domain lookup, email permutations, DNS-over-HTTPS MX and catch-all checks. Product Hunt uses an OAuth client-credentials token from PRODUCTHUNT_API_KEY/SECRET.
- Pure helpers in `pipeline.ts` (gatekeeping, query building, email permutations, final save filter) with unit tests.
