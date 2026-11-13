import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/leads")({
  server: {
    handlers: {
      DELETE: async ({ request }) => {
        try {
          const { requireAdminApiRequest } = await import("@/lib/scrape-jobs.server");
          const auth = await requireAdminApiRequest(request);
          if (!auth.ok) return auth.response;

          // Delete all leads visible/owned in the database.
          const { error } = await auth.supabase
            .from("leads")
            .delete()
            .neq("id", "00000000-0000-0000-0000-000000000000");

          if (error) {
            return Response.json(
              { ok: false, error: `Failed to delete leads: ${error.message}` },
              { status: 500 },
            );
          }

          return Response.json({ ok: true, deleted: "all" });
        } catch (err) {
          console.error("ERROR in DELETE /api/leads:", err);
          return Response.json(
            { ok: false, error: err instanceof Error ? err.message : "Failed to delete leads" },
            { status: 500 },
          );
        }
      },
    },
  },
});
