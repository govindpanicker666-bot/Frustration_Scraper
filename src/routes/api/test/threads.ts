import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/test/threads")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const keyword = url.searchParams.get("keyword")?.trim() ?? "mixpanel";
        const { testThreadsScraper } = await import("@/server/socialTest");
        const result = await testThreadsScraper(keyword);
        return Response.json(result, { status: result.ok ? 200 : 500 });
      },
    },
  },
});
