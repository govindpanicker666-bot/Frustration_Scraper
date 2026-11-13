import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { queryOptions, useSuspenseQuery } from "@tanstack/react-query";
import { getPublishedPostBySlug } from "@/lib/blog.functions";
import { getRequestOrigin } from "@/lib/origin.functions";
import { RichContentView, buildFaqSchema } from "@/components/blog/RichContentView";
import { BlogShell, fmtDate } from "@/components/blog/BlogShell";

const postQuery = (slug: string) =>
  queryOptions({
    queryKey: ["blog", "post", slug],
    queryFn: () => getPublishedPostBySlug({ data: { slug } }),
  });

export const Route = createFileRoute("/blog/$slug")({
  loader: async ({ params, context }) => {
    const [res, origin] = await Promise.all([
      context.queryClient.ensureQueryData(postQuery(params.slug)),
      getRequestOrigin(),
    ]);
    if (!res.post) throw notFound();
    return { post: res.post, origin };
  },
  head: ({ loaderData, params }) => {
    if (!loaderData)
      return {
        meta: [{ title: "Post not found — Churnhound" }, { name: "robots", content: "noindex" }],
      };
    const { post, origin } = loaderData;
    const title = post.meta_title || post.title;
    const desc = post.meta_description || post.excerpt || "";
    const url = `${origin}/blog/${params.slug}`;
    const img = post.featured_image
      ? post.featured_image.startsWith("http")
        ? post.featured_image
        : `${origin}${post.featured_image}`
      : null;
    const faq = buildFaqSchema(post.content, post.content_format);
    return {
      meta: [
        { title: `${title} — Churnhound` },
        { name: "description", content: desc },
        ...(post.tags.length ? [{ name: "keywords", content: post.tags.join(", ") }] : []),
        { name: "author", content: post.author_name },
        { property: "og:title", content: title },
        { property: "og:description", content: desc },
        { property: "og:type", content: "article" },
        { property: "og:url", content: url },
        { name: "twitter:card", content: "summary_large_image" },
        ...(img
          ? [
              { property: "og:image", content: img },
              { name: "twitter:image", content: img },
            ]
          : []),
        ...(post.published_at
          ? [{ property: "article:published_time", content: post.published_at }]
          : []),
      ],
      links: [{ rel: "canonical", href: url }],
      scripts: [
        {
          type: "application/ld+json",
          children: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "BlogPosting",
            headline: post.title,
            description: desc,
            datePublished: post.published_at,
            dateModified: post.updated_at,
            author: { "@type": "Person", name: post.author_name },
            image: img ?? undefined,
            mainEntityOfPage: url,
          }),
        },
        ...(faq ? [{ type: "application/ld+json", children: JSON.stringify(faq) }] : []),
      ],
    };
  },
  notFoundComponent: () => (
    <BlogShell>
      <h1 className="text-2xl font-semibold">Post not found</h1>
      <Link to="/blog" className="mt-4 inline-block text-primary underline">
        Back to blog
      </Link>
    </BlogShell>
  ),
  component: PostPage,
});

function PostPage() {
  const { slug } = Route.useParams();
  const { data } = useSuspenseQuery(postQuery(slug));
  const post = data.post!;
  const author = data.author;
  return (
    <BlogShell>
      <article className="mx-auto max-w-3xl">
        <Link to="/blog" className="text-sm text-muted-foreground hover:text-foreground">
          ← All posts
        </Link>
        {post.category && (
          <div className="mt-6 text-xs font-medium uppercase tracking-wider text-primary">
            {post.category}
          </div>
        )}
        <h1 className="mt-2 text-3xl font-semibold leading-tight tracking-tight md:text-5xl">
          {post.title}
        </h1>
        {post.excerpt && <p className="mt-4 text-lg text-muted-foreground">{post.excerpt}</p>}
        <div className="mt-6 flex items-center gap-3 text-sm text-muted-foreground">
          {author?.avatar_url && (
            <img
              src={author.avatar_url}
              alt={author.name}
              className="h-9 w-9 rounded-full object-cover"
            />
          )}
          <span className="font-medium text-foreground">{post.author_name}</span>
          <span>·</span>
          <span>{fmtDate(post.published_at)}</span>
          <span>·</span>
          <span>{post.read_minutes} min read</span>
        </div>
        {post.featured_image && (
          <img
            src={post.featured_image}
            alt={post.featured_image_alt ?? post.title}
            className="mt-8 aspect-[16/9] w-full rounded-lg border object-cover"
          />
        )}
        <div className="mt-10">
          <RichContentView
            content={post.content}
            format={post.content_format}
            related={data.related}
          />
        </div>
        {post.tags.length > 0 && (
          <div className="mt-10 flex flex-wrap gap-2">
            {post.tags.map((t) => (
              <span key={t} className="rounded-full border px-3 py-1 text-xs text-muted-foreground">
                {t}
              </span>
            ))}
          </div>
        )}
        {author && (
          <div className="mt-12 flex gap-4 rounded-lg border p-5">
            {author.avatar_url ? (
              <img
                src={author.avatar_url}
                alt={author.name}
                className="h-16 w-16 shrink-0 rounded-full object-cover"
              />
            ) : (
              <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-secondary text-xl font-semibold">
                {author.name[0]}
              </div>
            )}
            <div>
              <div className="text-xs uppercase tracking-wider text-muted-foreground">
                Written by
              </div>
              <div className="font-display text-lg font-semibold">{author.name}</div>
              {author.role && <div className="text-sm text-muted-foreground">{author.role}</div>}
              {author.bio && <p className="mt-2 text-sm">{author.bio}</p>}
              <div className="mt-2 flex gap-3 text-sm">
                {author.website_url && (
                  <a
                    className="text-primary underline"
                    href={author.website_url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Website
                  </a>
                )}
                {author.linkedin_url && (
                  <a
                    className="text-primary underline"
                    href={author.linkedin_url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    LinkedIn
                  </a>
                )}
              </div>
            </div>
          </div>
        )}
      </article>
      {data.related.length > 0 && (
        <section className="mx-auto mt-16 max-w-5xl border-t pt-10">
          <h2 className="text-xl font-semibold">Keep reading</h2>
          <div className="mt-6 grid gap-8 sm:grid-cols-3">
            {data.related.map((p) => (
              <Link key={p.id} to="/blog/$slug" params={{ slug: p.slug! }} className="group">
                {p.featured_image ? (
                  <img
                    src={p.featured_image}
                    alt={p.title}
                    loading="lazy"
                    className="aspect-[16/9] w-full rounded-lg border object-cover"
                  />
                ) : (
                  <div className="aspect-[16/9] rounded-lg border bg-secondary" />
                )}
                <h3 className="mt-3 font-semibold leading-snug group-hover:underline">{p.title}</h3>
                <div className="mt-1 text-xs text-muted-foreground">{fmtDate(p.published_at)}</div>
              </Link>
            ))}
          </div>
        </section>
      )}
    </BlogShell>
  );
}
