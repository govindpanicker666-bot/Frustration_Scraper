# Frustration-Led Growth SaaS — Build Plan

Find people publicly complaining about your competitors, score their frustration with AI, and hand your sales team ready-to-send pitches.

## What gets built

**1. Accounts and roles**

- Email/password sign-up and sign-in, with a password reset page.
- Each user has a profile (email, company name, company URL). Roles (admin/user) live in a separate secure table. The first user to sign up becomes admin.
- Users see Dashboard, Leads, Insights. Admins also see the Admin panel.

**2. Onboarding**

- Enter company name and URL, then AI suggests 20 direct competitors.
- They appear in a grid of glass cards with checkboxes. You can untick any and add your own.
- Selected competitors are saved to your account.

**3. Leads dashboard**

- Table columns: Reviewer, Competitor, Platform, Frustration Score (colored badge), Complaint, Status.
- Filter by platform, status, and score.
- Contact button: "View LinkedIn" for LinkedIn profiles, "View Source Thread" for Reddit or Hacker News links.
- Clicking a row opens a side panel with the full review, AI pitch, a "Copy Pitch" button, and a status change (New / Contacted / Archived).

**4. Insights**

- "Top 5 Complaints Today" with mention counts.
- Bar chart of leads by platform, plus summary cards (total leads, average score, new today).

**5. Admin panel**

- Pick a competitor and platform (G2, Reddit, Hacker News, App Store, or All), then click "Trigger Scrape".
- Shows a step-by-step loading state (fetching, analyzing, enriching) and a result summary: found, scored, saved.

**Design:** Calibri everywhere (falls back to Carlito, a free look-alike), dark slate background, frosted glass cards, emerald and indigo accents, smooth motion.

## Changes from the brief

- **AI:** uses Google Gemini models. Ask Gemini API when needed.
- **Backend:** Lovable Cloud database and built-in server functions instead of separate edge functions. Same three pipelines.
- **Play Store:** the `google-play-scraper` package can't run on this hosting, so app reviews come from Apple's public App Store reviews feed instead. Try to find an alternative way to get access to play stre reviews for free.
- **Reliability risks:** G2 often blocks automated access, and DuckDuckGo LinkedIn lookups can be rate-limited. Both fail quietly: the lead is still saved, just with the source link instead of a LinkedIn profile. Reddit and Hacker News are reliable.

## Technical details

- Tables: `profiles`, `user_roles` (with `app_role` enum + `has_role()` security definer function), `competitors` (user_id FK), `leads` (competitor_id FK, user_id for RLS, status enum, unique on competitor+source URL to dedupe). Grants and RLS: users only see their own rows; admins see all of them.
- Signup trigger creates the profile and gives the first user the admin role.
- Server functions (`createServerFn` + `requireSupabaseAuth`):
  - `detectCompetitors`: AI gateway structured output → exactly 20 `{name,url,category}`.
  - `scrapeReviews`: G2 RSS parsed with `fast-xml-parser` (skip anonymous), Reddit `search.json` with `FrustrationBot/1.0` UA, HN Algolia `search_by_date` comments, iTunes search → `customerreviews` RSS JSON. Keeps only the last 48 hours and items with a real name.
  - `analyzeAndEnrich`: batched Gemini scoring (score, complaint under 5 words, 1-sentence pitch), DuckDuckGo HTML lookup with a regex for `linkedin.com/in/` URLs on named reviewers, upserts leads with score ≥ 8. Admin role checked on the server.
- Routes: `/auth`, `/reset-password`, `_authenticated` layout with sidebar → `/dashboard`, `/leads`, `/insights`, `/onboarding`, `/admin` (role-gated).
- Libraries: framer-motion, recharts, lucide-react, fast-xml-parser.
- Unit tests for the 48-hour filter, anonymous-name filter, score ≥ 8 threshold, and the contact-button choice.
