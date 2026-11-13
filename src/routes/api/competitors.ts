import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/competitors")({
  server: {
    handlers: {
      DELETE: async ({ request }) => {
        try {
          const { requireAdminApiRequest } = await import("@/lib/scrape-jobs.server");
          const auth = await requireAdminApiRequest(request);
          if (!auth.ok) return auth.response;

          const { data: comps, error: fetchErr } = await auth.supabase
            .from("competitors")
            .select("id");

          if (fetchErr) {
            return Response.json(
              { ok: false, error: `Failed to list competitors: ${fetchErr.message}` },
              { status: 500 },
            );
          }

          const compIds = (comps ?? []).map((c) => c.id);

          // Cascade delete associated leads explicitly because DB FK uses ON DELETE SET NULL.
          if (compIds.length > 0) {
            const { error: leadsErr } = await auth.supabase
              .from("leads")
              .delete()
              .in("competitor_id", compIds);

            if (leadsErr) {
              return Response.json(
                { ok: false, error: `Failed to delete associated leads: ${leadsErr.message}` },
                { status: 500 },
              );
            }
          }

          const { error: compErr } = await auth.supabase
            .from("competitors")
            .delete()
            .neq("id", "00000000-0000-0000-0000-000000000000");

          if (compErr) {
            return Response.json(
              { ok: false, error: `Failed to delete competitors: ${compErr.message}` },
              { status: 500 },
            );
          }

          return Response.json({ ok: true, deletedCompetitors: compIds.length });
        } catch (err) {
          console.error("ERROR in DELETE /api/competitors:", err);
          return Response.json(
            {
              ok: false,
              error: err instanceof Error ? err.message : "Failed to delete competitors",
            },
            { status: 500 },
          );
        }
      },
    },
  },
});
