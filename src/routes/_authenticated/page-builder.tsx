import { createFileRoute, Link, Outlet, useMatchRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ExternalLink, Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { createPage, deletePage, listPages, listPageSubmissions } from "@/lib/pages.functions";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_authenticated/page-builder")({
  head: () => ({
    meta: [
      { title: "Page Builder — Churnhound" },
      { name: "description", content: "Build comparison and alternative landing pages." },
      { property: "og:title", content: "Page Builder — Churnhound" },
      { property: "og:description", content: "Build comparison and alternative landing pages." },
    ],
  }),
  component: PageBuilderLayout,
});

function PageBuilderLayout() {
  const match = useMatchRoute();
  if (match({ to: "/page-builder/$id" })) return <Outlet />;
  return <PageList />;
}

function PageList() {
  const list = useServerFn(listPages);
  const create = useServerFn(createPage);
  const del = useServerFn(deletePage);
  const subs = useServerFn(listPageSubmissions);
  const qc = useQueryClient();
  const navigate = useNavigate();
  const q = useQuery({ queryKey: ["custom-pages"], queryFn: () => list() });
  const s = useQuery({ queryKey: ["page-submissions"], queryFn: () => subs() });
  async function add() {
    try {
      const p = await create();
      navigate({ to: "/page-builder/$id", params: { id: p.id } });
    } catch {
      toast.error("Admins only");
    }
  }
  async function remove(id: string) {
    if (!confirm("Delete this page?")) return;
    await del({ data: { id } });
    qc.invalidateQueries({ queryKey: ["custom-pages"] });
  }
  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Page Builder</h1>
          <p className="text-muted-foreground">
            "X vs us", "Alternatives to X" and review pages, built from blocks.
          </p>
        </div>
        <Button onClick={add}>
          <Plus />
          New page
        </Button>
      </div>
      <div className="glass overflow-hidden">
        {q.isLoading ? (
          <div className="p-6">
            <Loader2 className="animate-spin" />
          </div>
        ) : !q.data?.length ? (
          <p className="p-6 text-sm text-muted-foreground">No pages yet. Create your first one.</p>
        ) : (
          <ul className="divide-y">
            {q.data.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center gap-3 p-4">
                <Link to="/page-builder/$id" params={{ id: p.id }} className="min-w-0 flex-1">
                  <div className="truncate font-medium">{p.title}</div>
                  <div className="truncate text-xs text-muted-foreground">/p/{p.slug}</div>
                </Link>
                <span
                  className={
                    p.status === "published"
                      ? "rounded-full bg-primary/15 px-2 py-0.5 text-xs text-primary"
                      : "rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground"
                  }
                >
                  {p.status}
                </span>
                {p.status === "published" && (
                  <Button asChild variant="ghost" size="icon" aria-label="Open page">
                    <a href={`/p/${p.slug}`} target="_blank" rel="noreferrer">
                      <ExternalLink />
                    </a>
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Delete page"
                  onClick={() => remove(p.id)}
                >
                  <Trash2 />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="glass p-5">
        <h2 className="mb-3 font-semibold">Form submissions</h2>
        {!s.data?.length ? (
          <p className="text-sm text-muted-foreground">None yet.</p>
        ) : (
          <ul className="divide-y text-sm">
            {s.data.map((r) => (
              <li key={r.id} className="py-2">
                <b>{r.email}</b>
                {r.name && ` · ${r.name}`}
                {r.company && ` · ${r.company}`}
                <span className="text-muted-foreground">
                  {" "}
                  · {new Date(r.created_at).toLocaleString()}
                </span>
                {r.message && <div className="text-muted-foreground">{r.message}</div>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
