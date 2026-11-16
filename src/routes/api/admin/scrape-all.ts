import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { PLATFORMS, type Platform } from "@/lib/pipeline";

const platformIds = PLATFORMS.map((p) => p.id) as [Platform, ...Platform[]];
const requestSchema = z
  .object({
    competitor_ids: z.array(z.string().uuid()).min(1),
    platform: z.union([z.enum(platformIds), z.literal("all")]).optional(),
    platforms: z.array(z.enum(platformIds)).min(1).optional(),
  })
  .refine((d) => Boolean(d.platform) || Boolean(d.platforms?.length), {
    message: "Either platform or platforms is required",
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

          const resolvedPlatforms: Platform[] | undefined =
            parsed.data.platforms ??
            (parsed.data.platform === "all"
              ? PLATFORMS.map((p) => p.id)
              : parsed.data.platform
                ? [parsed.data.platform]
                : undefined);
          const resolvedPlatform: Platform | "all" =
            parsed.data.platform ??
            (resolvedPlatforms && resolvedPlatforms.length === 1 ? resolvedPlatforms[0]! : "all");

          console.log("[/api/admin/scrape-all] Parsed payload:", {
            competitorCount: parsed.data.competitor_ids.length,
            platform: resolvedPlatform,
            platforms: resolvedPlatforms,
          });

          const result = await startManualScrapeJob(
            auth.userId,
            parsed.data.competitor_ids,
            resolvedPlatform,
            auth.supabase,
            resolvedPlatforms,
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
