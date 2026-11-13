import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Copy,
  Eye,
  GripVertical,
  Loader2,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { getPageForEdit, savePage } from "@/lib/pages.functions";
import { BLOCKS, BlockSettings, BlockView, blockMeta } from "@/components/pages/blocks";
import { competitorsQuery } from "@/lib/queries";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/page-builder/$id")({
  head: () => ({
    meta: [
      { title: "Edit page — Churnhound" },
      { name: "description", content: "Edit a landing page." },
      { property: "og:title", content: "Edit page — Churnhound" },
      { property: "og:description", content: "Edit a landing page." },
    ],
  }),
  loader: ({ context }) => context.queryClient.ensureQueryData(competitorsQuery),
  component: Editor,
});

type B = { key: string; block_type: string; content: Record<string, unknown> };
const newKey = () => Math.random().toString(36).slice(2);
const slugify = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 120);

function SortableBlock({
  b,
  selected,
  onSelect,
  onMove,
  onDup,
  onDelete,
  first,
  last,
}: {
  b: B;
  selected: boolean;
  onSelect: () => void;
  onMove: (d: -1 | 1) => void;
  onDup: () => void;
  onDelete: () => void;
  first: boolean;
  last: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: b.key,
  });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        "group relative rounded-xl border-2 bg-background transition-colors",
        selected ? "border-primary" : "border-transparent hover:border-border",
        isDragging && "z-20 opacity-80 shadow-xl",
      )}
    >
      <div
        className={cn(
          "absolute -top-3 left-3 z-10 flex items-center gap-0.5 rounded-md border bg-card px-1 text-xs shadow-sm",
          selected ? "flex" : "hidden group-hover:flex",
        )}
      >
        <button
          type="button"
          {...attributes}
          {...listeners}
          aria-label="Drag to reorder"
          className="cursor-grab p-1"
        >
          <GripVertical className="h-3.5 w-3.5" />
        </button>
        <span className="px-1 font-medium">{blockMeta(b.block_type)?.label}</span>
        <button
          type="button"
          disabled={first}
          onClick={() => onMove(-1)}
          aria-label="Move up"
          className="p-1 disabled:opacity-30"
        >
          <ArrowUp className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          disabled={last}
          onClick={() => onMove(1)}
          aria-label="Move down"
          className="p-1 disabled:opacity-30"
        >
          <ArrowDown className="h-3.5 w-3.5" />
        </button>
        <button type="button" onClick={onDup} aria-label="Duplicate" className="p-1">
          <Copy className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={onDelete}
          aria-label="Delete block"
          className="p-1 hover:text-destructive"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
      <div
        onClickCapture={(e) => {
          onSelect();
          if ((e.target as HTMLElement).closest("a,button[type=submit]")) e.preventDefault();
        }}
        className="pointer-events-auto overflow-hidden rounded-xl"
      >
        <BlockView type={b.block_type} c={b.content} />
      </div>
    </div>
  );
}

function Editor() {
  const { id } = Route.useParams();
  const get = useServerFn(getPageForEdit);
  const save = useServerFn(savePage);
  const { data: comps } = useSuspenseQuery(competitorsQuery);
  const q = useQuery({ queryKey: ["custom-page", id], queryFn: () => get({ data: { id } }) });
  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");
  const [seo, setSeo] = useState("");
  const [status, setStatus] = useState<"draft" | "published">("draft");
  const [blocks, setBlocks] = useState<B[]>([]);
  const [sel, setSel] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dropHover, setDropHover] = useState(false);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  useEffect(() => {
    if (!q.data) return;
    const p = q.data.page;
    setTitle(p.title);
    setSlug(p.slug);
    setSeo(p.seo_description ?? "");
    setStatus(p.status === "published" ? "published" : "draft");
    setBlocks(
      q.data.blocks.map((b) => ({ key: newKey(), block_type: b.block_type, content: b.content })),
    );
  }, [q.data]);

  function add(type: string, at?: number) {
    const meta = blockMeta(type);
    if (!meta) return;
    const b: B = {
      key: newKey(),
      block_type: type,
      content: structuredClone(meta.defaults) as Record<string, unknown>,
    };
    setBlocks((l) => {
      const n = [...l];
      n.splice(at ?? n.length, 0, b);
      return n;
    });
    setSel(b.key);
  }
  function move(i: number, d: -1 | 1) {
    setBlocks((l) => arrayMove(l, i, i + d));
  }
  function onDragEnd(e: DragEndEvent) {
    if (!e.over || e.active.id === e.over.id) return;
    setBlocks((l) =>
      arrayMove(
        l,
        l.findIndex((b) => b.key === e.active.id),
        l.findIndex((b) => b.key === e.over!.id),
      ),
    );
  }
  async function persist(next: "draft" | "published") {
    setBusy(true);
    try {
      const r = await save({
        data: {
          id,
          title,
          slug: slugify(slug || title),
          seo_description: seo || null,
          status: next,
          blocks: blocks.map((b) => ({ block_type: b.block_type, content: b.content })),
        },
      });
      if (!r.ok) {
        toast.error(r.error ?? "Could not save");
        return;
      }
      setStatus(next);
      setSlug(slugify(slug || title));
      toast.success(next === "published" ? "Published" : "Draft saved");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save");
    } finally {
      setBusy(false);
    }
  }

  if (q.isLoading) return <Loader2 className="animate-spin" />;
  if (q.error) return <p className="text-destructive">Could not load page.</p>;
  const selected = blocks.find((b) => b.key === sel);

  return (
    <div className="-m-4 flex min-h-[calc(100vh-3rem)] flex-col sm:-m-6 md:-m-10">
      <div className="sticky top-0 z-20 flex flex-wrap items-center gap-2 border-b bg-background/95 p-3 backdrop-blur">
        <Button asChild variant="ghost" size="icon" aria-label="Back">
          <Link to="/page-builder">
            <ArrowLeft />
          </Link>
        </Button>
        <Input
          className="h-8 w-48"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Page title"
          aria-label="Page title"
        />
        <div className="flex h-8 items-center rounded-md border px-2 text-sm text-muted-foreground">
          /p/
          <input
            className="w-36 bg-transparent text-foreground outline-none"
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            onBlur={() => setSlug(slugify(slug))}
            aria-label="Slug"
          />
        </div>
        <Input
          className="h-8 min-w-48 flex-1"
          value={seo}
          maxLength={320}
          onChange={(e) => setSeo(e.target.value)}
          placeholder="SEO description (shown in Google)"
          aria-label="SEO description"
        />
        <span
          className={cn(
            "rounded-full px-2 py-0.5 text-xs",
            status === "published"
              ? "bg-primary/15 text-primary"
              : "bg-muted text-muted-foreground",
          )}
        >
          {status}
        </span>
        <Button size="sm" variant="outline" disabled={busy} onClick={() => persist("draft")}>
          {status === "published" ? "Unpublish" : "Save draft"}
        </Button>
        <Button size="sm" disabled={busy} onClick={() => persist("published")}>
          {busy && <Loader2 className="animate-spin" />}Publish
        </Button>
        <Button size="sm" variant="ghost" asChild>
          <a
            href={`/p/${slug}${status === "published" ? "" : ""}`}
            target="_blank"
            rel="noreferrer"
            onClick={(e) => {
              if (status !== "published") {
                e.preventDefault();
                toast.info("Publish first, or use the canvas as a live preview.");
              }
            }}
          >
            <Eye />
            Preview
          </a>
        </Button>
      </div>
      <div className="grid flex-1 lg:grid-cols-[200px_1fr_300px]">
        <aside className="border-b p-3 lg:border-b-0 lg:border-r">
          <div className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Blocks
          </div>
          <div className="grid grid-cols-2 gap-1.5 lg:grid-cols-1">
            {BLOCKS.map((b) => (
              <button
                key={b.type}
                type="button"
                draggable
                onDragStart={(e) => e.dataTransfer.setData("block", b.type)}
                onClick={() => add(b.type)}
                className="flex cursor-grab items-center gap-2 rounded-md border bg-card px-2.5 py-2 text-left text-sm hover:border-primary/50"
              >
                <b.icon className="h-4 w-4 shrink-0 text-primary" />
                {b.label}
              </button>
            ))}
          </div>
          <p className="mt-3 text-xs text-muted-foreground">Click or drag onto the page.</p>
        </aside>
        <div
          className={cn("min-w-0 bg-muted/30 p-4", dropHover && "bg-primary/5")}
          onDragOver={(e) => {
            if (e.dataTransfer.types.includes("block")) {
              e.preventDefault();
              setDropHover(true);
            }
          }}
          onDragLeave={() => setDropHover(false)}
          onDrop={(e) => {
            const t = e.dataTransfer.getData("block");
            setDropHover(false);
            if (t) add(t);
          }}
        >
          <div className="mx-auto max-w-5xl space-y-4 rounded-xl border bg-background p-2 shadow-sm">
            {!blocks.length && (
              <div className="flex h-64 items-center justify-center rounded-lg border-2 border-dashed text-sm text-muted-foreground">
                Drop blocks here to start building
              </div>
            )}
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
              <SortableContext
                items={blocks.map((b) => b.key)}
                strategy={verticalListSortingStrategy}
              >
                {blocks.map((b, i) => (
                  <SortableBlock
                    key={b.key}
                    b={b}
                    selected={sel === b.key}
                    first={i === 0}
                    last={i === blocks.length - 1}
                    onSelect={() => setSel(b.key)}
                    onMove={(d) => move(i, d)}
                    onDup={() => add(b.block_type, i + 1)}
                    onDelete={() => {
                      setBlocks((l) => l.filter((x) => x.key !== b.key));
                      setSel(null);
                    }}
                  />
                ))}
              </SortableContext>
            </DndContext>
          </div>
        </div>
        <aside className="space-y-4 border-t p-4 lg:border-l lg:border-t-0">
          {selected ? (
            <>
              <div className="font-semibold">{blockMeta(selected.block_type)?.label}</div>
              <BlockSettings
                type={selected.block_type}
                c={selected.content}
                competitors={comps.map((c) => c.name)}
                onChange={(c) =>
                  setBlocks((l) =>
                    l.map((b) => (b.key === selected.key ? { ...b, content: c } : b)),
                  )
                }
              />
            </>
          ) : (
            <p className="text-sm text-muted-foreground">Select a block to edit its settings.</p>
          )}
        </aside>
      </div>
    </div>
  );
}
