import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/test/linkedin")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const name = url.searchParams.get("name")?.trim() ?? "John Doe";
        const { testLinkedInSearch } = await import("@/server/socialTest");
        const result = await testLinkedInSearch(name);
        return Response.json(result);
      },
    },
  },
});
