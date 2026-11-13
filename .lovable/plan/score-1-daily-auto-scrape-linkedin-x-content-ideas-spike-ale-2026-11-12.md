# Score 1+, daily auto-scrape, LinkedIn/X, content ideas, spike alerts, pitch messages

## 1. Save every negative post (score 1+)

- Minimum frustration score drops from 5 to 1, so even mildly negative customer posts become leads.
- The Leads page score filter starts at "All scores (1+)".
- The relevance check still runs. News, outage notices and marketing posts are still dropped, because they aren't customer complaints.

## 2. Recency window: keep 48 hours

You're right that a wider window is a problem for daily runs. A 7-day window would re-read 6 days of posts the app has already seen every day.

- With a daily run, a 48-hour window covers each day with a 1-day overlap, so nothing is missed.
- Posts the app has already saved are skipped automatically, so the overlap never creates duplicates.

## 3. Daily auto-scrape with an on/off switch

- A new "Automatic daily scrape" card on the Admin page has an on/off toggle and a choice of run time. It shows the last run's time, result (posts found, leads saved) and any pause reason.
- When the toggle is on, all competitors are scraped once a day.
- The manual "Trigger Scrape" button stays for admins.
- Safety rules:
  - Only one run happens at a time.
  - Each run has a cap on how many competitors it handles.
  - If Gemini runs out of quota on both keys, the run pauses with a visible reason instead of burning failed calls. It resumes the next day.

## 4. LinkedIn and X posts

- Python scrapers such as linkedin-spider can't run on this hosting, and they need a logged-in LinkedIn account, which gets banned. Instead, the app searches Google's index for public posts. This is free.
- **LinkedIn:** searches for public posts and articles that mention the competitor and sound like complaints. The author's profile link comes from the post address, so every LinkedIn post is a lead with a direct profile.
- **X:** finds public tweets the same way, then reads each tweet's author, handle and full text from X's free public tweet-embed service, which needs no key.
- Both appear as new sources in Admin, with counts or "blocked".
- These searches use Gemini, so they count against your Gemini quota: about 2 extra calls per competitor.

## 5. Content Ideas (Insights page)

- A "Generate SEO/Content Ideas" button sits next to the top complaints.
- It sends the top complaint to Gemini and shows 3 catchy blog titles and LinkedIn hooks, each with a copy button.

## 6. Spike Alerts (Dashboard)

- The app compares each competitor's leads from today against its average over the previous 7 days, grouped by complaint.
- An alert fires when today has at least 3 leads for the same complaint and that is at least 3 times the usual daily level.
- When it fires, a prominent red banner shows: "🚨 Frustration Spike Detected for [Competitor]! Strike while the iron is hot." It also names the complaint and links to those leads.

## 7. Personalised pitch messages (Leads)

- Each lead's detail panel gets a "Generate message" button.
- Gemini writes a short message that references the person's actual complaint and fits the channel: an email, a LinkedIn connection note (under 300 characters) or a social reply.
- The message is saved on the lead, with copy and regenerate buttons.

## Technical details

- Rule changes in `pipeline.ts`: `MIN_LEAD_SCORE = 1` and a pure `detectSpikes()` helper, each covered by tests.
- New platforms `linkedin` and `x` in `scrapers.server.ts`:
  - Both use Gemini grounded search with `site:linkedin.com/posts|pulse` and `site:x.com`.
  - X tweets are resolved through `publish.twitter.com/oembed`.
  - Both use the existing status pattern (ok/blocked/no_match/no_key).
- Database:
  - Table `scrape_settings`: enabled, run hour, last run, last result, pause reason, lock expiry.
  - Leads get a `pitch_message` column.
  - RLS allows admin-only writes.
- Automatic runs:
  - Route `/api/public/jobs/daily-scrape` uses `authenticateCronRequest`. It checks the enabled flag and lock, processes competitors sequentially and pauses on quota errors.
  - The route is scheduled hourly with `create_http_schedule` and runs only at the configured hour.
- New server functions in `insights.functions.ts`, `leads.functions.ts` and settings: `generateContentIdeas`, `generatePitchMessage`, `getScrapeSettings` and `updateScrapeSettings` (admin-checked).
- Memory: update the score threshold to 1.
