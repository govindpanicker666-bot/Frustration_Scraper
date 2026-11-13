import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const idSchema = z.string().uuid();

export const Route = createFileRoute("/api/leads_/$id")({
  server: {
    handlers: {
      DELETE: async ({ request, params }) => {
        try {
          const { requireAdminApiRequest } = await import("@/lib/scrape-jobs.server");
          const auth = await requireAdminApiRequest(request);
          if (!auth.ok) return auth.response;

          const parsedId = idSchema.safeParse(params.id);
          if (!parsedId.success) {
            return Response.json({ ok: false, error: "Invalid lead ID" }, { status: 400 });
          }

          const { data, error } = await auth.supabase
            .from("leads")
            .delete()
            .eq("id", parsedId.data)
            .select("id");

          if (error) {
            return Response.json(
              { ok: false, error: `Failed to delete lead: ${error.message}` },
              { status: 500 },
            );
          }

          if (!data || data.length === 0) {
            return Response.json({ ok: false, error: "Lead not found" }, { status: 404 });
          }

          return Response.json({ ok: true, id: parsedId.data });
        } catch (err) {
          console.error("ERROR in DELETE /api/leads/:id:", err);
          return Response.json(
            { ok: false, error: err instanceof Error ? err.message : "Failed to delete lead" },
            { status: 500 },
          );
        }
      },
    },
  },
});
