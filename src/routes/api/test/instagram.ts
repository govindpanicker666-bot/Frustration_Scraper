import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/test/instagram")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const query = url.searchParams.get("query")?.trim() ?? "mixpanel";
        const { testInstagramSearch } = await import("@/server/socialTest");
        const result = await testInstagramSearch(query);
        return Response.json(result);
      },
    },
  },
});
