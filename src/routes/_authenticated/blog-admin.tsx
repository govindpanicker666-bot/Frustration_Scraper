import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { adminListAllPosts, adminDeletePost } from "@/lib/blog.functions";
import { useCurrentUser } from "@/hooks/use-auth";

import { Plus, Pencil, Trash2, ExternalLink } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/blog-admin")({
  head: () => ({
    meta: [
      { title: "Blog posts — Churnhound" },
      { name: "description", content: "Write and publish Churnhound blog posts." },
      { property: "og:title", content: "Blog posts — Churnhound" },
      { property: "og:description", content: "Write and publish Churnhound blog posts." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: BlogAdminPage,
});

function BlogAdminPage() {
  const { data: ent } = useCurrentUser();
  const isAdmin = !!ent?.isAdmin;
  const listFn = useServerFn(adminListAllPosts);
  const delFn = useServerFn(adminDeletePost);
  const qc = useQueryClient();
  const navigate = useNavigate();

  const q = useQuery({
    queryKey: ["blog-admin-list"],
    queryFn: () => listFn(),
    enabled: isAdmin,
  });

  const delM = useMutation({
    mutationFn: (id: string) => delFn({ data: { id } }),
    onSuccess: () => {
      toast.success("Deleted");
      void qc.invalidateQueries({ queryKey: ["blog-admin-list"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (ent && !isAdmin) {
    return (
      <div>
        <PageHeader title="Blog Admin" description="Access restricted" />
        <div className="p-6 text-sm text-muted-foreground">Not authorized.</div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Blog Admin"
        description="Draft, edit, and publish articles"
        actions={
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => navigate({ to: "/blog-authors" })}>
              Authors
            </Button>
            <Button onClick={() => navigate({ to: "/blog-editor/$id", params: { id: "new" } })}>
              <Plus className="w-4 h-4 mr-1" /> New post
            </Button>
          </div>
        }
      />
      <div>
        <div className="rounded-lg border border-border bg-card overflow-x-auto">
          {q.isLoading ? (
            <div className="p-6 text-sm text-muted-foreground">Loading…</div>
          ) : !q.data?.posts?.length ? (
            <div className="p-8 text-sm text-muted-foreground text-center">
              No posts yet. Click &quot;New post&quot; to draft your first article.
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="text-left px-4 py-2">Title</th>
                  <th className="text-left px-4 py-2">Status</th>
                  <th className="hidden sm:table-cell text-left px-4 py-2">Category</th>
                  <th className="text-left px-4 py-2">Updated</th>
                  <th className="text-right px-4 py-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {q.data.posts.map((p) => (
                  <tr key={p.id} className="border-t border-border">
                    <td className="px-4 py-3">
                      <div className="font-medium text-foreground">{p.title}</div>
                      <div className="text-xs text-muted-foreground">/{p.slug}</div>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={
                          p.status === "published"
                            ? "text-xs px-2 py-0.5 rounded-full bg-primary text-primary-foreground"
                            : "text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground"
                        }
                      >
                        {p.status}
                      </span>
                    </td>
                    <td className="hidden sm:table-cell px-4 py-3 text-muted-foreground">
                      {p.category ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {p.updated_at ? new Date(p.updated_at).toLocaleDateString() : "—"}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2 justify-end">
                        {p.status === "published" && p.slug ? (
                          <Link
                            to="/blog/$slug"
                            params={{ slug: p.slug }}
                            target="_blank"
                            className="text-muted-foreground hover:text-foreground"
                            title="View"
                          >
                            <ExternalLink className="w-4 h-4" />
                          </Link>
                        ) : null}
                        <Link
                          to="/blog-editor/$id"
                          params={{ id: p.id! }}
                          className="text-muted-foreground hover:text-foreground"
                          title="Edit"
                        >
                          <Pencil className="w-4 h-4" />
                        </Link>
                        <button
                          onClick={() => {
                            if (confirm(`Delete "${p.title}"?`)) delM.mutate(p.id!);
                          }}
                          className="text-muted-foreground hover:text-destructive"
                          title="Delete"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
