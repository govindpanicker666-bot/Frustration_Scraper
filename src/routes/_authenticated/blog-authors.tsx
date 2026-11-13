import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { Loader2, Plus, Trash2, Upload } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  adminDeleteAuthor,
  adminSaveAuthor,
  listAuthors,
  type BlogAuthor,
} from "@/lib/blog.functions";
import { uploadBlogMedia } from "@/lib/blog-media.functions";
import { useCurrentUser } from "@/hooks/use-auth";

export const Route = createFileRoute("/_authenticated/blog-authors")({
  head: () => ({
    meta: [
      { title: "Blog authors — Churnhound" },
      { name: "description", content: "Manage blog author profiles." },
      { property: "og:title", content: "Blog authors — Churnhound" },
      { property: "og:description", content: "Manage blog author profiles." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AuthorsPage,
});

const empty = { name: "", role: "", bio: "", avatar_url: "", website_url: "", linkedin_url: "" };

function AuthorsPage() {
  const { data: me } = useCurrentUser();
  const listFn = useServerFn(listAuthors);
  const saveFn = useServerFn(adminSaveAuthor);
  const delFn = useServerFn(adminDeleteAuthor);
  const uploadFn = useServerFn(uploadBlogMedia);
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["blog-authors"], queryFn: () => listFn() });
  const [form, setForm] = useState<typeof empty & { id?: string }>(empty);
  const [busy, setBusy] = useState(false);
  const file = useRef<HTMLInputElement>(null);

  if (me && !me.isAdmin) return <p className="text-sm text-muted-foreground">Admins only.</p>;

  async function save() {
    if (!form.name.trim()) {
      toast.error("Name is required");
      return;
    }
    setBusy(true);
    try {
      await saveFn({ data: form });
      toast.success("Author saved");
      setForm(empty);
      qc.invalidateQueries({ queryKey: ["blog-authors"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save");
    } finally {
      setBusy(false);
    }
  }
  async function upload(f: File) {
    const buf = new Uint8Array(await f.arrayBuffer());
    let bin = "";
    for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]!);
    try {
      const r = await uploadFn({
        data: { fileName: f.name, contentType: f.type, dataBase64: btoa(bin) },
      });
      setForm((x) => ({ ...x, avatar_url: r.url }));
    } catch {
      toast.error("Upload failed");
    }
  }
  const set = (k: keyof typeof empty) => (e: { target: { value: string } }) =>
    setForm((x) => ({ ...x, [k]: e.target.value }));

  return (
    <div>
      <PageHeader
        title="Blog authors"
        description="Name, photo and bio shown on each post."
        actions={
          <Button asChild variant="outline">
            <Link to="/blog-admin">Back to posts</Link>
          </Button>
        }
      />
      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <div className="space-y-3">
          {q.data?.authors.length === 0 && (
            <p className="glass p-6 text-sm text-muted-foreground">
              No authors yet. Add one on the right.
            </p>
          )}
          {q.data?.authors.map((a: BlogAuthor) => (
            <div key={a.id} className="glass flex items-start gap-4 p-4">
              {a.avatar_url ? (
                <img
                  src={a.avatar_url}
                  alt={a.name}
                  className="h-12 w-12 rounded-full object-cover"
                />
              ) : (
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-secondary font-semibold">
                  {a.name[0]}
                </div>
              )}
              <div className="min-w-0 flex-1">
                <div className="font-semibold">{a.name}</div>
                <div className="text-xs text-muted-foreground">{a.role}</div>
                <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{a.bio}</p>
              </div>
              <div className="flex gap-1">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    setForm({
                      id: a.id,
                      name: a.name,
                      role: a.role ?? "",
                      bio: a.bio ?? "",
                      avatar_url: a.avatar_url ?? "",
                      website_url: a.website_url ?? "",
                      linkedin_url: a.linkedin_url ?? "",
                    })
                  }
                >
                  Edit
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label="Delete author"
                  onClick={async () => {
                    if (!confirm(`Delete ${a.name}?`)) return;
                    await delFn({ data: { id: a.id } });
                    qc.invalidateQueries({ queryKey: ["blog-authors"] });
                  }}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ))}
        </div>
        <div className="glass space-y-3 p-4">
          <div className="font-semibold">{form.id ? "Edit author" : "New author"}</div>
          <div className="flex items-center gap-3">
            {form.avatar_url ? (
              <img src={form.avatar_url} alt="" className="h-14 w-14 rounded-full object-cover" />
            ) : (
              <div className="h-14 w-14 rounded-full bg-secondary" />
            )}
            <Button size="sm" variant="outline" onClick={() => file.current?.click()}>
              <Upload />
              Photo
            </Button>
            <input
              ref={file}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])}
            />
          </div>
          <div>
            <Label className="text-xs">Name</Label>
            <Input value={form.name} onChange={set("name")} className="mt-1" />
          </div>
          <div>
            <Label className="text-xs">Role / title</Label>
            <Input
              value={form.role}
              onChange={set("role")}
              className="mt-1"
              placeholder="Head of Growth"
            />
          </div>
          <div>
            <Label className="text-xs">Bio</Label>
            <Textarea rows={4} value={form.bio} onChange={set("bio")} className="mt-1" />
          </div>
          <div>
            <Label className="text-xs">Website</Label>
            <Input value={form.website_url} onChange={set("website_url")} className="mt-1" />
          </div>
          <div>
            <Label className="text-xs">LinkedIn</Label>
            <Input value={form.linkedin_url} onChange={set("linkedin_url")} className="mt-1" />
          </div>
          <div className="flex gap-2">
            <Button onClick={save} disabled={busy}>
              {busy ? <Loader2 className="animate-spin" /> : <Plus />}
              {form.id ? "Save changes" : "Add author"}
            </Button>
            {form.id && (
              <Button variant="ghost" onClick={() => setForm(empty)}>
                Cancel
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
