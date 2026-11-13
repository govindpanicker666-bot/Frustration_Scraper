import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/admin/scrape-status")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        console.log("HIT /api/admin/scrape-status ENDPOINT", {
          hasAuth: request.headers.has("authorization"),
        });
        try {
          const { requireAdminApiRequest, getManualScrapeStatus } =
            await import("@/lib/scrape-jobs.server");
          const auth = await requireAdminApiRequest(request);
          if (!auth.ok) return auth.response;

          const status = await getManualScrapeStatus(auth.userId, auth.supabase);
          return Response.json({ ok: true, status });
        } catch (err) {
          console.error("ERROR in /api/admin/scrape-status:", err);
          return Response.json(
            { ok: false, error: err instanceof Error ? err.message : "Failed to fetch status" },
            { status: 500 },
          );
        }
      },
    },
  },
});
