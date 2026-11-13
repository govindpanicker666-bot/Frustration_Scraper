import { createFileRoute, Link } from "@tanstack/react-router";
import { queryOptions, useSuspenseQuery } from "@tanstack/react-query";
import { getPublishedPage } from "@/lib/pages.functions";
import { BlockView } from "@/components/pages/blocks";
import { ThemeToggle } from "@/components/ThemeToggle";

const pageQuery = (slug: string) =>
  queryOptions({
    queryKey: ["public-page", slug],
    queryFn: () => getPublishedPage({ data: { slug } }),
  });

export const Route = createFileRoute("/p/$slug")({
  loader: ({ params, context }) => context.queryClient.ensureQueryData(pageQuery(params.slug)),
  head: ({ loaderData }) => {
    const title = loaderData
      ? `${loaderData.page.title} — Churnhound`
      : "Page unavailable — Churnhound";
    const desc =
      loaderData?.page.seo_description ?? "Compare tools and see what real customers say.";
    return {
      meta: [
        { title },
        { name: "description", content: desc },
        { property: "og:title", content: title },
        { property: "og:description", content: desc },
        { property: "og:type", content: "website" },
        { name: "twitter:card", content: "summary_large_image" },
        ...(loaderData ? [] : [{ name: "robots", content: "noindex" }]),
      ],
    };
  },
  notFoundComponent: () => (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 p-6 text-center">
      <h1 className="text-2xl font-semibold">Page not found</h1>
      <Link to="/" className="text-primary underline">
        Go home
      </Link>
    </div>
  ),
  component: PublicPage,
});

function PublicPage() {
  const { slug } = Route.useParams();
  const { data } = useSuspenseQuery(pageQuery(slug));
  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-30 border-b bg-background/90 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-5 py-3">
          <Link to="/" className="font-display text-lg font-semibold tracking-tight">
            Churnhound
          </Link>
          <ThemeToggle />
        </div>
      </header>
      <main>
        {data.blocks.map((b) => (
          <BlockView key={b.id} type={b.block_type} c={b.content} pageId={data.page.id} />
        ))}
      </main>
      <footer className="border-t py-8 text-center text-xs text-muted-foreground">
        © {new Date().getFullYear()} Churnhound
      </footer>
    </div>
  );
}
