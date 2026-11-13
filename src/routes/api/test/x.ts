import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/test/x")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const query = url.searchParams.get("query")?.trim() ?? "mixpanel";
        const { testXSearch } = await import("@/server/socialTest");
        const result = await testXSearch(query);
        return Response.json(result);
      },
    },
  },
});
