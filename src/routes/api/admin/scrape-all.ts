import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { PLATFORMS, type Platform } from "@/lib/pipeline";

const platformIds = PLATFORMS.map((p) => p.id) as [Platform, ...Platform[]];
const requestSchema = z.object({
  competitor_ids: z.array(z.string().uuid()).min(1),
  platform: z.union([z.enum(platformIds), z.literal("all")]),
});

export const Route = createFileRoute("/api/admin/scrape-all")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        console.log("HIT /api/admin/scrape-all ENDPOINT", {
          method: request.method,
          url: request.url,
          hasAuth: request.headers.has("authorization"),
        });
        try {
          const { requireAdminApiRequest, startManualScrapeJob } =
            await import("@/lib/scrape-jobs.server");
          const auth = await requireAdminApiRequest(request);
          if (!auth.ok) return auth.response;

          let body: unknown;
          try {
            body = await request.json();
          } catch {
            return Response.json({ error: "Invalid JSON body" }, { status: 400 });
          }

          const parsed = requestSchema.safeParse(body);
          if (!parsed.success) {
            return Response.json(
              { error: "Invalid request payload", details: parsed.error.flatten() },
              { status: 400 },
            );
          }

          const result = await startManualScrapeJob(
            auth.userId,
            parsed.data.competitor_ids,
            parsed.data.platform,
            auth.supabase,
          );
          return Response.json({ ok: true, ...result }, { status: 202 });
        } catch (err) {
          console.error("ERROR in /api/admin/scrape-all:", err);
          return Response.json(
            {
              ok: false,
              error: err instanceof Error ? err.message : "Failed to start scrape job",
            },
            { status: 500 },
          );
        }
      },
    },
  },
});
