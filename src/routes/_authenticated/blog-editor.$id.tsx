import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useCurrentUser } from "@/hooks/use-auth";

import {
  listAuthors,
  adminGetPost,
  adminSavePost,
  adminAiDraftFromSource,
  adminDeletePost,
} from "@/lib/blog.functions";
import { uploadBlogMedia } from "@/lib/blog-media.functions";
import { RichEditor } from "@/components/blog/editor/RichEditor";
import { toast } from "sonner";
import { Sparkles, Save, Upload, Settings2, Check, Loader2, Trash2 } from "lucide-react";

export const Route = createFileRoute("/_authenticated/blog-editor/$id")({
  head: () => ({
    meta: [
      { title: "Blog editor — Churnhound" },
      { name: "description", content: "Edit a Churnhound blog post." },
      { property: "og:title", content: "Blog editor — Churnhound" },
      { property: "og:description", content: "Edit a Churnhound blog post." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: BlogEditor,
});

const CATEGORIES = [
  "Competitive Intelligence",
  "Sales Playbooks",
  "Customer Churn",
  "Growth Marketing",
  "Product Updates",
];

function slugify(s: string) {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 80);
}

function toLocalInput(iso: string | null | undefined) {
  if (!iso) return "";
  const d = new Date(iso);
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 16);
}

function BlogEditor() {
  const { id } = Route.useParams();
  const isNew = id === "new";
  const { data: ent } = useCurrentUser();
  const isAdmin = !!ent?.isAdmin;
  const navigate = useNavigate();

  const getFn = useServerFn(adminGetPost);
  const saveFn = useServerFn(adminSavePost);
  const draftFn = useServerFn(adminAiDraftFromSource);
  const deleteFn = useServerFn(adminDeletePost);
  const uploadFn = useServerFn(uploadBlogMedia);

  const q = useQuery({
    queryKey: ["blog-post", id],
    queryFn: () => getFn({ data: { id } }),
    enabled: !isNew && isAdmin,
  });

  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [excerpt, setExcerpt] = useState("");
  const [content, setContent] = useState("");
  const [featuredImage, setFeaturedImage] = useState("");
  const [featuredImageAlt, setFeaturedImageAlt] = useState("");
  const [category, setCategory] = useState<string>(CATEGORIES[0]!);
  const [tags, setTags] = useState("");
  const [metaTitle, setMetaTitle] = useState("");
  const [metaDescription, setMetaDescription] = useState("");
  const [authorName, setAuthorName] = useState("Churnhound Team");
  const [authorId, setAuthorId] = useState<string>("");
  const authorsFn = useServerFn(listAuthors);
  const authorsQ = useQuery({ queryKey: ["blog-authors"], queryFn: () => authorsFn() });
  const [status, setStatus] = useState<"draft" | "published">("draft");
  const [publishAt, setPublishAt] = useState("");
  const [panelOpen, setPanelOpen] = useState(false);

  const [aiSource, setAiSource] = useState("");
  const [aiHint, setAiHint] = useState("");
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");

  const postIdRef = useRef<string | null>(isNew ? null : id);
  const dirtyRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const featuredInput = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (q.data?.post) {
      const p = q.data.post;
      postIdRef.current = p.id;
      setTitle(p.title);
      setSlug(p.slug);
      setSlugTouched(true);
      setExcerpt(p.excerpt ?? "");
      setContent(p.content);
      setFeaturedImage(p.featured_image ?? "");
      setFeaturedImageAlt(p.featured_image_alt ?? "");
      setCategory(p.category ?? CATEGORIES[0]!);
      setTags((p.tags ?? []).join(", "));
      setMetaTitle(p.meta_title ?? "");
      setMetaDescription(p.meta_description ?? "");
      setAuthorName(p.author_name ?? "Churnhound Team");
      setAuthorId(p.author_id ?? "");
      setStatus(p.status === "published" ? "published" : "draft");
      setPublishAt(toLocalInput(p.published_at));
      dirtyRef.current = false;
    }
  }, [q.data]);

  useEffect(() => {
    if (!slugTouched) setSlug(slugify(title));
  }, [title, slugTouched]);

  const buildPayload = useCallback(
    (asStatus: "draft" | "published") => ({
      id: postIdRef.current ?? undefined,
      title: title.trim() || "Untitled draft",
      slug: slug || slugify(title) || `untitled-draft-${Date.now().toString(36)}`,
      excerpt,
      content,
      content_format: "html",
      featured_image: featuredImage || undefined,
      featured_image_alt: featuredImageAlt || undefined,
      category,
      tags: tags
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean),
      meta_title: metaTitle || undefined,
      meta_description: metaDescription || undefined,
      author_name: authorName,
      author_id: authorId || null,
      status: asStatus,
      published_at: publishAt ? new Date(publishAt).toISOString() : null,
    }),
    [
      title,
      slug,
      excerpt,
      content,
      featuredImage,
      featuredImageAlt,
      category,
      tags,
      metaTitle,
      metaDescription,
      authorName,
      authorId,
      publishAt,
    ],
  );

  const persist = useCallback(
    async (asStatus: "draft" | "published") => {
      setSaveState("saving");
      const res = await saveFn({ data: buildPayload(asStatus) });
      dirtyRef.current = false;
      setSaveState("saved");
      if (res.post?.id && !postIdRef.current) {
        postIdRef.current = res.post.id;
        void navigate({ to: "/blog-editor/$id", params: { id: res.post.id }, replace: true });
      }
      return res;
    },
    [saveFn, buildPayload, navigate],
  );

  // Mark dirty on any change
  useEffect(() => {
    dirtyRef.current = true;
  }, [
    title,
    slug,
    excerpt,
    content,
    featuredImage,
    featuredImageAlt,
    category,
    tags,
    metaTitle,
    metaDescription,
    authorName,
    authorId,
    publishAt,
  ]);

  // Autosave every 30 seconds when there is anything to save
  const persistRef = useRef(persist);
  persistRef.current = persist;
  const statusRef = useRef(status);
  statusRef.current = status;
  const hasContentRef = useRef(false);
  hasContentRef.current =
    !!title.trim() || content.replace(/<[^>]*>/g, "").trim().length > 0 || !!excerpt.trim();

  useEffect(() => {
    if (!isAdmin) return;
    const iv = setInterval(() => {
      if (!dirtyRef.current || !hasContentRef.current) return;
      persistRef.current(statusRef.current).catch((e: Error) => {
        setSaveState("idle");
        toast.error(`Autosave failed: ${e.message}`);
      });
    }, 30000);
    timerRef.current = null;
    return () => clearInterval(iv);
  }, [isAdmin]);

  // Never lose a draft on tab close
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!dirtyRef.current) return;
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, []);

  const saveM = useMutation({
    mutationFn: (asStatus: "draft" | "published") => persist(asStatus),
    onSuccess: (_res, asStatus) => {
      setStatus(asStatus);
      toast.success(asStatus === "published" ? "Published" : "Draft saved");
    },
    onError: (e: Error) => {
      setSaveState("idle");
      toast.error(e.message);
    },
  });

  const draftM = useMutation({
    mutationFn: () => draftFn({ data: { source: aiSource, hint: aiHint || undefined } }),
    onSuccess: (res) => {
      const d = res.draft;
      setTitle(d.title);
      setSlug(d.slug);
      setSlugTouched(true);
      setExcerpt(d.excerpt);
      setMetaTitle(d.meta_title);
      setMetaDescription(d.meta_description);
      setCategory(d.category);
      setTags(d.tags.join(", "));
      setContent(d.content);
      toast.success("Draft generated. Review and edit before publishing.");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteM = useMutation({
    mutationFn: async () => {
      const pid = postIdRef.current;
      if (!pid) return { ok: true };
      return deleteFn({ data: { id: pid } });
    },
    onSuccess: () => {
      dirtyRef.current = false;
      toast.success("Draft deleted");
      void navigate({ to: "/blog-admin" });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const onSourceFile = async (f: File | null) => {
    if (!f) return;
    if (f.size > 2_000_000) {
      toast.error("Please keep source files under 2MB");
      return;
    }
    try {
      setAiSource(await f.text());
      toast.success(`Loaded ${f.name}`);
    } catch {
      toast.error("Could not read file. Use .txt or .md.");
    }
  };

  const onFeaturedFile = async (f: File | null) => {
    if (!f) return;
    try {
      const dataBase64 = await new Promise<string>((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result).split(",")[1] ?? "");
        r.onerror = () => reject(new Error("Could not read file"));
        r.readAsDataURL(f);
      });
      const res = await uploadFn({ data: { fileName: f.name, contentType: f.type, dataBase64 } });
      setFeaturedImage(res.url);
      toast.success("Featured image uploaded");
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  if (ent && !isAdmin) {
    return (
      <div>
        <PageHeader title="Blog Editor" description="Access restricted" />
        <div className="p-6 text-sm text-muted-foreground">Not authorized.</div>
      </div>
    );
  }

  const saveBadge =
    saveState === "saving" ? (
      <span className="text-xs text-muted-foreground inline-flex items-center gap-1">
        <Loader2 className="w-3 h-3 animate-spin" /> Saving…
      </span>
    ) : saveState === "saved" ? (
      <span className="text-xs text-muted-foreground inline-flex items-center gap-1">
        <Check className="w-3 h-3" /> Saved
      </span>
    ) : null;

  return (
    <div>
      <PageHeader
        title={isNew && !postIdRef.current ? "New blog post" : title || "Edit post"}
        description="Write with a full rich-text editor. Changes autosave."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {saveBadge}
            <Button
              variant="outline"
              size="sm"
              className="lg:hidden"
              onClick={() => setPanelOpen((v) => !v)}
            >
              <Settings2 className="w-4 h-4 mr-1" /> Settings
            </Button>
            <Button variant="outline" size="sm" onClick={() => navigate({ to: "/blog-admin" })}>
              Back
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                if (confirm("Delete this draft? This cannot be undone.")) deleteM.mutate();
              }}
              disabled={deleteM.isPending}
            >
              <Trash2 className="w-4 h-4 mr-1" /> Delete draft
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => saveM.mutate("draft")}
              disabled={saveM.isPending}
            >
              <Save className="w-4 h-4 mr-1" /> Save draft
            </Button>
            <Button size="sm" onClick={() => saveM.mutate("published")} disabled={saveM.isPending}>
              {status === "published" ? "Update" : "Publish"}
            </Button>
          </div>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 w-full max-w-[780px] mx-auto lg:mx-0">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Post title"
            className="w-full bg-transparent border-0 outline-none font-display text-3xl sm:text-4xl leading-tight text-foreground placeholder:text-muted-foreground/50 mb-4"
          />
          <RichEditor value={content} onChange={setContent} />
          <p className="mt-2 text-xs text-muted-foreground">
            Type &quot;/&quot; in the editor for blocks: headings, tables, images, YouTube,
            callouts, FAQ, table of contents and more.
          </p>
        </div>

        <aside className={`${panelOpen ? "block" : "hidden"} lg:block space-y-6`}>
          <section className="rounded-lg border border-border bg-card p-4 space-y-3">
            <div className="text-sm font-medium">Publishing</div>
            <div className="flex items-center justify-between">
              <Label className="text-xs">Published</Label>
              <Switch
                checked={status === "published"}
                onCheckedChange={(v) => {
                  const next = v ? "published" : "draft";
                  setStatus(next);
                  saveM.mutate(next);
                }}
              />
            </div>
            <div>
              <Label className="text-xs">Publish date</Label>
              <Input
                type="datetime-local"
                value={publishAt}
                onChange={(e) => setPublishAt(e.target.value)}
                className="mt-1"
              />
            </div>
            <div>
              <Label className="text-xs">Slug</Label>
              <Input
                value={slug}
                onChange={(e) => {
                  setSlug(slugify(e.target.value));
                  setSlugTouched(true);
                }}
                className="mt-1"
                placeholder="url-friendly-slug"
              />
            </div>
            <div>
              <Label className="text-xs">Category</Label>
              <select
                className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
              >
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label className="text-xs">Tags / meta keywords (comma separated)</Label>
              <Input
                value={tags}
                onChange={(e) => setTags(e.target.value)}
                className="mt-1"
                placeholder="churn, competitor analysis"
              />
            </div>
            <div>
              <Label className="text-xs">Author</Label>
              <select
                className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={authorId}
                onChange={(e) => {
                  const a = authorsQ.data?.authors.find((x) => x.id === e.target.value);
                  setAuthorId(e.target.value);
                  if (a) setAuthorName(a.name);
                }}
              >
                <option value="">Custom name…</option>
                {authorsQ.data?.authors.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
              {!authorId && (
                <Input
                  value={authorName}
                  onChange={(e) => setAuthorName(e.target.value)}
                  className="mt-2"
                  placeholder="Author name"
                />
              )}
              <a
                href="/blog-authors"
                className="mt-1 inline-block text-[11px] text-primary underline"
              >
                Manage author profiles
              </a>
            </div>
          </section>

          <section className="rounded-lg border border-border bg-card p-4 space-y-3">
            <div className="text-sm font-medium">SEO</div>
            <div>
              <Label className="text-xs">Meta title</Label>
              <Input
                value={metaTitle}
                onChange={(e) => setMetaTitle(e.target.value)}
                className="mt-1"
                maxLength={70}
              />
              <div
                className={`text-[11px] mt-1 ${metaTitle.length > 60 ? "text-destructive" : "text-muted-foreground"}`}
              >
                {metaTitle.length}/60
              </div>
            </div>
            <div>
              <Label className="text-xs">Meta description</Label>
              <Textarea
                rows={3}
                value={metaDescription}
                onChange={(e) => setMetaDescription(e.target.value)}
                className="mt-1"
                maxLength={200}
              />
              <div
                className={`text-[11px] mt-1 ${metaDescription.length > 160 ? "text-destructive" : "text-muted-foreground"}`}
              >
                {metaDescription.length}/160
              </div>
            </div>
            <div>
              <Label className="text-xs">Excerpt</Label>
              <Textarea
                rows={2}
                value={excerpt}
                onChange={(e) => setExcerpt(e.target.value)}
                className="mt-1"
                placeholder="1-2 sentence summary"
              />
            </div>
          </section>

          <section className="rounded-lg border border-border bg-card p-4 space-y-3">
            <div className="text-sm font-medium">Featured image</div>
            <Button
              variant="outline"
              size="sm"
              className="w-full"
              onClick={() => featuredInput.current?.click()}
            >
              <Upload className="w-4 h-4 mr-1" /> Upload image
            </Button>
            <input
              ref={featuredInput}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                void onFeaturedFile(f ?? null);
              }}
            />
            <Input
              value={featuredImage}
              onChange={(e) => setFeaturedImage(e.target.value)}
              placeholder="or paste an image URL"
            />
            <Input
              value={featuredImageAlt}
              onChange={(e) => setFeaturedImageAlt(e.target.value)}
              placeholder="Alt text"
            />
            {featuredImage ? (
              <img
                src={featuredImage}
                alt={featuredImageAlt || ""}
                className="rounded-md w-full aspect-[16/9] object-cover"
              />
            ) : null}
          </section>

          <section className="rounded-lg border border-border bg-card p-4">
            <div className="flex items-center gap-2 text-sm font-medium mb-2">
              <Sparkles className="w-4 h-4 text-primary" /> AI draft
            </div>
            <p className="text-xs text-muted-foreground mb-3">
              Paste research, notes, or a transcript. AI structures a publish-ready draft.
              Overwrites current fields.
            </p>
            <label className="text-xs inline-flex items-center gap-2 cursor-pointer text-primary underline mb-2">
              <Upload className="w-3.5 h-3.5" /> Upload .txt / .md
              <input
                type="file"
                accept=".txt,.md,text/plain,text/markdown"
                className="hidden"
                onChange={(e) => void onSourceFile(e.target.files?.[0] ?? null)}
              />
            </label>
            <Textarea
              rows={5}
              value={aiSource}
              onChange={(e) => setAiSource(e.target.value)}
              placeholder="Paste source text here..."
              className="text-xs"
            />
            <Input
              value={aiHint}
              onChange={(e) => setAiHint(e.target.value)}
              placeholder="Optional angle or audience"
              className="mt-2 text-xs"
            />
            <Button
              size="sm"
              className="mt-3 w-full"
              onClick={() => draftM.mutate()}
              disabled={draftM.isPending || aiSource.trim().length < 40}
            >
              {draftM.isPending ? "Generating…" : "Generate draft"}
            </Button>
          </section>
        </aside>
      </div>
    </div>
  );
}
