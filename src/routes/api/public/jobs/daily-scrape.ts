import { createFileRoute } from "@tanstack/react-router";
import { authenticateCronRequest } from "@/integrations/supabase/cron-auth";

// Triggered periodically by cron. Matches users whose exact UTC run_hour equals the current UTC hour
// and who haven't already run today (`last_run_date !== today`), then spawns a fire-and-forget
// background task to scrape ALL competitors for that user so the HTTP response returns immediately.
export const Route = createFileRoute("/api/public/jobs/daily-scrape")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const authFailure = await authenticateCronRequest(request);
        if (authFailure) return authFailure;

        const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
        const { runDailyCronTick } = await import("@/lib/scrape-jobs.server");
        const { ok, triggered } = await runDailyCronTick(db, new Date());

        return Response.json(
          {
            ok,
            triggered: triggered.map(({ user, started, skipped }) => ({ user, started, skipped })),
          },
          { status: 200 },
        );
      },
    },
  },
});
