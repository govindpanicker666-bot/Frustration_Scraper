import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/admin/scrape-cancel")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const { requireAdminApiRequest, cancelManualScrapeJob } =
            await import("@/lib/scrape-jobs.server");
          const auth = await requireAdminApiRequest(request);
          if (!auth.ok) return auth.response;

          const status = await cancelManualScrapeJob(auth.userId, auth.supabase);
          return Response.json({ ok: true, status });
        } catch (err) {
          console.error("ERROR in /api/admin/scrape-cancel:", err);
          return Response.json(
            {
              ok: false,
              error: err instanceof Error ? err.message : "Failed to cancel scrape job",
            },
            { status: 500 },
          );
        }
      },
    },
  },
});
