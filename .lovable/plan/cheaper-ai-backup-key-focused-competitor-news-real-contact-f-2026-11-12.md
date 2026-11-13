# Cheaper AI, backup key, focused Competitor News, real contact finding

## 1. Cheaper model everywhere + backup key

- Every AI call switches to `gemini-3.5-flash-lite` (today it's `gemini-2.5-flash`; no 3.8 was used).
- If Google says that model name doesn't exist on your key, the app falls back to `gemini-2.5-flash-lite` automatically.
- Your second key is saved securely as a backup. When the first key hits its limit (429 / quota), the same request is retried on the backup key with the same model.
- Short retry with backoff on temporary limit errors, so one hiccup doesn't drop a whole competitor.

## 2. Fewer AI calls per scrape

- Relevance check + scoring + name/job/company extraction merged into one batched call per competitor (up to ~25 posts per call).
- ComplaintsBoard / Google-indexed reviews only use AI if the free direct lookup fails.
- Raw posts are kept when AI fails, so a rerun doesn't re-scrape.

## 3. Competitor News: insights, not a link dump

- Collect recent feed posts for all competitors, then one AI pass picks only the 5-7 most important items across all competitors (funding, pricing changes, launches, outages, layoffs). Routine blog posts are dropped.
- Each item shows: what happened (1 line), why it matters to you, and a concrete sales move. Link moves to a small "source" footnote.
- Old saved news is replaced on each refresh so the page always shows the current top 5-7.

## 4. Contact finding that actually returns contacts

Your 5 steps stay (name + 48h gate, company pivot, email, LinkedIn fallback, final filter). The weak part is step 3: the tools you listed (Prospector, OpenLeads, ColdReach) need SMTP port 25 access, which this hosting blocks, so they can't run here. Free replacement that works within these limits, in order:

1. **Company website scrape**: fetch the employer's homepage, /contact, /about, /team pages and pull any published emails; if the person's own email appears, use it (status "found").
2. **Pattern detection**: from emails found on the site, learn the company format (first.last, flast, first) and build the person's email in that format (status "pattern-matched").
3. **Public footprint**: check GitHub (public commit emails for that name) and Gravatar (checks whether a guessed email has a real account) — both free, no key.
4. **MX check**: domain must accept mail; otherwise the email is discarded.
5. If still nothing: LinkedIn URL is the lead; social posts keep the thread link as Social Signal.

- Admin results show a breakdown: found / pattern-matched / guessed / LinkedIn only / social.
- Optional later: if you ever want truly verified inboxes, a free-tier verifier key (e.g. Hunter free 25/month, or a self-hosted Reacher on your own server) can plug into step 4.

## Technical details

- `ai.server.ts`: model constant + fallback model; key list `[GEMINI_API_KEY, GEMINI_API_KEY_2]`; rotate on 429/403 quota; backoff.
- New secret `GEMINI_API_KEY_2` via set_secret.
- `leads.functions.ts`: single batched classify+extract call; enrichment pipeline extended.
- `enrich.server.ts`: `scrapeSiteEmails(domain)`, `detectPattern(emails, name)`, `githubEmail(name, company)`, `gravatarExists(email)`; pure pattern helpers in `pipeline.ts` with tests.
- `insights.functions.ts` `refreshCompetitorNews`: gather candidates, one AI ranking call returning 5-7 items with `why_it_matters` + `tactical_advice`; delete prior rows for user then insert. Migration adds `why_it_matters` column.
- `news.tsx`: insight-first card layout.
