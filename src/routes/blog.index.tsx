import { createFileRoute, Link } from "@tanstack/react-router";
import { queryOptions, useSuspenseQuery } from "@tanstack/react-query";
import { useState } from "react";
import { listPublishedPosts } from "@/lib/blog.functions";
import { BlogShell, fmtDate } from "@/components/blog/BlogShell";

const postsQuery = queryOptions({
  queryKey: ["blog", "list"],
  queryFn: () => listPublishedPosts(),
});

export const Route = createFileRoute("/blog/")({
  head: () => ({
    meta: [
      { title: "Blog — Churnhound" },
      {
        name: "description",
        content:
          "Playbooks on competitor churn, win-back campaigns and turning customer frustration into pipeline.",
      },
      { property: "og:title", content: "Churnhound Blog" },
      {
        property: "og:description",
        content:
          "Playbooks on competitor churn, win-back campaigns and turning customer frustration into pipeline.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  loader: ({ context }) => context.queryClient.ensureQueryData(postsQuery),
  component: BlogIndex,
});

function BlogIndex() {
  const { data } = useSuspenseQuery(postsQuery);
  const [cat, setCat] = useState<string | null>(null);
  const cats = [...new Set(data.posts.map((p) => p.category).filter(Boolean))] as string[];
  const posts = data.posts.filter((p) => !cat || p.category === cat);
  const [lead, ...rest] = posts;
  return (
    <BlogShell>
      <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">Blog</h1>
      <p className="mt-2 text-muted-foreground">
        Field notes on winning customers your competitors are losing.
      </p>
      {cats.length > 1 && (
        <div className="mt-6 flex flex-wrap gap-2">
          {[null, ...cats].map((c) => (
            <button
              key={c ?? "all"}
              onClick={() => setCat(c)}
              className={`rounded-full border px-3 py-1 text-sm ${cat === c ? "border-primary bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
            >
              {c ?? "All"}
            </button>
          ))}
        </div>
      )}
      {!lead ? (
        <p className="mt-12 text-muted-foreground">No posts published yet.</p>
      ) : (
        <>
          <Link
            to="/blog/$slug"
            params={{ slug: lead.slug! }}
            className="group mt-8 grid gap-6 md:grid-cols-2"
          >
            {lead.featured_image ? (
              <img
                src={lead.featured_image}
                alt={lead.featured_image_alt ?? lead.title}
                className="aspect-[16/9] w-full rounded-lg border object-cover"
              />
            ) : (
              <div className="aspect-[16/9] rounded-lg border bg-secondary" />
            )}
            <div className="flex flex-col justify-center">
              <div className="text-xs font-medium uppercase tracking-wider text-primary">
                {lead.category}
              </div>
              <h2 className="mt-2 text-2xl font-semibold leading-snug group-hover:underline">
                {lead.title}
              </h2>
              <p className="mt-3 text-muted-foreground">{lead.excerpt}</p>
              <div className="mt-4 text-xs text-muted-foreground">
                {lead.author_name} · {fmtDate(lead.published_at)} · {lead.read_minutes} min read
              </div>
            </div>
          </Link>
          <div className="mt-12 grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
            {rest.map((p) => (
              <Link key={p.id} to="/blog/$slug" params={{ slug: p.slug! }} className="group">
                {p.featured_image ? (
                  <img
                    src={p.featured_image}
                    alt={p.featured_image_alt ?? p.title}
                    loading="lazy"
                    className="aspect-[16/9] w-full rounded-lg border object-cover"
                  />
                ) : (
                  <div className="aspect-[16/9] rounded-lg border bg-secondary" />
                )}
                <div className="mt-3 text-xs font-medium uppercase tracking-wider text-primary">
                  {p.category}
                </div>
                <h3 className="mt-1 font-semibold leading-snug group-hover:underline">{p.title}</h3>
                <div className="mt-2 text-xs text-muted-foreground">
                  {fmtDate(p.published_at)} · {p.read_minutes} min read
                </div>
              </Link>
            ))}
          </div>
        </>
      )}
    </BlogShell>
  );
}
