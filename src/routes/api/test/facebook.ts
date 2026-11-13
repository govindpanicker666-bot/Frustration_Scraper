import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/test/facebook")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const query = url.searchParams.get("query")?.trim() ?? "mixpanel";
        const { testFacebookSearch } = await import("@/server/socialTest");
        const result = await testFacebookSearch(query);
        return Response.json(result);
      },
    },
  },
});
