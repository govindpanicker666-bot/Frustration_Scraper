import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const idSchema = z.string().uuid();

export const Route = createFileRoute("/api/leads_/$id_/find-contact")({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        try {
          const { requireAdminApiRequest } = await import("@/lib/scrape-jobs.server");
          const auth = await requireAdminApiRequest(request);
          if (!auth.ok) return auth.response;

          const parsedId = idSchema.safeParse(params.id);
          if (!parsedId.success) {
            return Response.json({ ok: false, error: "Invalid lead ID" }, { status: 400 });
          }

          const body = await request.json().catch(() => ({})) as { action?: string };
          if (body.action === "email") {
            const { runEmailEnrichmentForLead } = await import("@/lib/lead-discovery.server");
            const result = await runEmailEnrichmentForLead(auth.supabase, parsedId.data);
            return Response.json({ ok: true, ...result });
          }
          if (body.action === "profile") {
            const { runMaigretProfileSearchForLead } = await import("@/lib/lead-discovery.server");
            const result = await runMaigretProfileSearchForLead(auth.supabase, parsedId.data);
            return Response.json({ ok: true, ...result });
          }
          const { runOsintDiscoveryForLead } = await import("@/lib/osint.server");
          const result = await runOsintDiscoveryForLead(auth.supabase, auth.userId, parsedId.data);
          return Response.json({ ok: true, ...result });
        } catch (err) {
          const msg = err instanceof Error ? err.message : "OSINT search failed";
          if (msg === "LEAD_NOT_FOUND") {
            return Response.json({ ok: false, error: "Lead not found" }, { status: 404 });
          }
          console.error("ERROR in POST /api/leads/:id/find-contact:", err);
          return Response.json({ ok: false, error: msg }, { status: 500 });
        }
      },
    },
  },
});
