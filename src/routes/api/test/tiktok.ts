import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/test/tiktok")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const keyword = url.searchParams.get("keyword")?.trim() ?? "mixpanel";
        const { testTikTokComments } = await import("@/server/socialTest");
        const result = await testTikTokComments(keyword);
        if (!("keyword" in result)) {
          return Response.json(result, { status: 400 });
        }
        return Response.json(result);
      },
    },
  },
});
