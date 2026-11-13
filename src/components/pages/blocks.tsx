import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Check,
  ChevronDown,
  Columns3,
  HelpCircle,
  Image as ImageIcon,
  LayoutGrid,
  Mail,
  Megaphone,
  MessageSquareQuote,
  Minus,
  Plus,
  Sparkles,
  Tag,
  Trash2,
  Type,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { MarkdownView } from "@/components/blog/MarkdownView";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { getPublicReviews, submitPageLead } from "@/lib/pages.functions";
import { platformLabel } from "@/lib/pipeline";
import { cn } from "@/lib/utils";

type C = Record<string, unknown>;
const str = (v: unknown, d = "") => (typeof v === "string" ? v : d);
const arr = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);

export const BLOCKS = [
  {
    type: "hero",
    label: "Hero section",
    icon: Sparkles,
    defaults: {
      headline: "The better alternative to Competitor",
      subheadline: "Everything you liked, without the frustration.",
      cta_text: "Start free",
      cta_link: "/auth",
      background_image: "",
    },
  },
  {
    type: "richtext",
    label: "Rich text",
    icon: Type,
    defaults: {
      markdown: "## Why teams switch\n\nWrite your story here. **Markdown** is supported.",
    },
  },
  {
    type: "comparison",
    label: "Comparison table",
    icon: Columns3,
    defaults: {
      title: "How we compare",
      columns: ["Us", "Competitor A"],
      highlight: 0,
      rows: [
        { feature: "Transparent pricing", cells: ["yes", "no"] },
        { feature: "Live support", cells: ["yes", "partial"] },
        { feature: "Setup time", cells: ["5 minutes", "2 weeks"] },
      ],
    },
  },
  {
    type: "reviews",
    label: "Real review cards",
    icon: MessageSquareQuote,
    defaults: { title: "What their customers are saying", competitor: "", limit: 6 },
  },
  {
    type: "features",
    label: "Feature grid",
    icon: LayoutGrid,
    defaults: {
      title: "Built for teams who switched",
      items: [
        { icon: "⚡", title: "Fast", text: "Set up in minutes." },
        { icon: "🔒", title: "Secure", text: "Your data stays yours." },
        { icon: "💬", title: "Human support", text: "Real people, fast replies." },
      ],
    },
  },
  {
    type: "faq",
    label: "FAQ accordion",
    icon: HelpCircle,
    defaults: {
      title: "Frequently asked questions",
      items: [{ q: "Can I import my data?", a: "Yes — in one click." }],
    },
  },
  {
    type: "pricing",
    label: "Pricing table",
    icon: Tag,
    defaults: {
      title: "Simple pricing",
      tiers: [
        {
          name: "Starter",
          price: "$0",
          period: "/mo",
          features: "1 user\nCore features",
          cta_text: "Start free",
          cta_link: "/auth",
          featured: false,
        },
        {
          name: "Pro",
          price: "$29",
          period: "/mo",
          features: "Unlimited users\nPriority support",
          cta_text: "Go Pro",
          cta_link: "/auth",
          featured: true,
        },
      ],
    },
  },
  {
    type: "leadform",
    label: "Lead capture form",
    icon: Mail,
    defaults: {
      title: "Get a free migration plan",
      subtitle: "Tell us where you're coming from.",
      button_text: "Send",
      success_text: "Thanks — we'll be in touch shortly.",
      show_company: true,
      show_message: true,
    },
  },
  {
    type: "media",
    label: "Image / YouTube",
    icon: ImageIcon,
    defaults: { kind: "image", url: "", alt: "", caption: "" },
  },
  {
    type: "cta",
    label: "CTA banner",
    icon: Megaphone,
    defaults: {
      headline: "Ready to switch?",
      text: "Move over in an afternoon. We'll help.",
      cta_text: "Get started",
      cta_link: "/auth",
    },
  },
] as const;
export type BlockType = (typeof BLOCKS)[number]["type"];
export const blockMeta = (t: string) => BLOCKS.find((b) => b.type === t);

const Wrap = ({ children, className }: { children: React.ReactNode; className?: string }) => (
  <section className={cn("mx-auto w-full max-w-5xl px-5 py-12 sm:py-16", className)}>
    {children}
  </section>
);
const H2 = ({ children }: { children: React.ReactNode }) =>
  children ? (
    <h2 className="mb-8 text-center text-2xl font-semibold tracking-tight sm:text-3xl">
      {children}
    </h2>
  ) : null;
const linkProps = (href: string) =>
  /^https?:/.test(href)
    ? { href, target: "_blank", rel: "noopener noreferrer" }
    : { href: href || "#" };

function Cell({ v, highlight }: { v: string; highlight?: boolean }) {
  const t = v.trim().toLowerCase();
  if (t === "yes" || t === "✓")
    return (
      <span
        className={cn(
          "inline-flex h-7 w-7 items-center justify-center rounded-full",
          highlight ? "bg-primary text-primary-foreground" : "bg-primary/15 text-primary",
        )}
      >
        <Check className="h-4 w-4" strokeWidth={3} />
      </span>
    );
  if (t === "no" || t === "✗" || t === "x")
    return (
      <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-destructive/10 text-destructive">
        <X className="h-4 w-4" strokeWidth={3} />
      </span>
    );
  if (t === "partial")
    return (
      <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <Minus className="h-4 w-4" strokeWidth={3} />
      </span>
    );
  return <span className={cn("text-sm", highlight && "font-semibold")}>{v}</span>;
}

function Comparison({ c }: { c: C }) {
  const cols = arr<string>(c["columns"]);
  const rows = arr<{ feature: string; cells: string[] }>(c["rows"]);
  const hl = Number(c["highlight"] ?? 0);
  const [hover, setHover] = useState<number | null>(null);
  return (
    <Wrap>
      <H2>{str(c["title"])}</H2>
      <div className="overflow-x-auto rounded-2xl border bg-card shadow-sm">
        <table className="w-full min-w-[520px] border-collapse text-left">
          <thead>
            <tr>
              <th className="sticky left-0 z-10 bg-card p-4 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Feature
              </th>
              {cols.map((col, i) => (
                <th
                  key={i}
                  className={cn(
                    "p-4 text-center font-display text-base font-semibold",
                    i === hl && "bg-primary/10 text-primary",
                  )}
                >
                  {i === hl && (
                    <div className="mb-1 text-[10px] font-medium uppercase tracking-widest">
                      Recommended
                    </div>
                  )}
                  {col}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, ri) => (
              <tr
                key={ri}
                onMouseEnter={() => setHover(ri)}
                onMouseLeave={() => setHover(null)}
                className={cn("border-t transition-colors", hover === ri && "bg-muted/50")}
              >
                <td className="sticky left-0 z-10 bg-inherit p-4 text-sm font-medium">
                  {r.feature}
                </td>
                {cols.map((_, ci) => (
                  <td key={ci} className={cn("p-4 text-center", ci === hl && "bg-primary/5")}>
                    <Cell v={r.cells?.[ci] ?? ""} highlight={ci === hl} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Wrap>
  );
}

function Reviews({ c }: { c: C }) {
  const competitor = str(c["competitor"]);
  const limit = Math.min(12, Math.max(1, Number(c["limit"] ?? 6)));
  const fn = useServerFn(getPublicReviews);
  const q = useQuery({
    queryKey: ["public-reviews", competitor, limit],
    queryFn: () => fn({ data: { competitor, limit } }),
    enabled: !!competitor,
  });
  const [open, setOpen] = useState<string | null>(null);
  return (
    <Wrap>
      <H2>{str(c["title"])}</H2>
      {!competitor ? (
        <p className="text-center text-sm text-muted-foreground">
          Pick a competitor in the block settings.
        </p>
      ) : q.isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }, (_, i) => (
            <div key={i} className="h-44 animate-pulse rounded-2xl bg-muted" />
          ))}
        </div>
      ) : !q.data?.length ? (
        <p className="text-center text-sm text-muted-foreground">
          No reviews about {competitor} yet.
        </p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {q.data.map((r) => {
            const expanded = open === r.id;
            return (
              <button
                type="button"
                key={r.id}
                onClick={() => setOpen(expanded ? null : r.id)}
                className="group flex flex-col rounded-2xl border bg-card p-5 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md"
              >
                <div className="mb-3 flex items-center justify-between">
                  <div className="flex gap-0.5" aria-label={`Frustration ${r.score} of 10`}>
                    {Array.from({ length: 5 }, (_, i) => (
                      <span
                        key={i}
                        className={cn(
                          "h-1.5 w-5 rounded-full",
                          i < Math.ceil(r.score / 2) ? "bg-destructive" : "bg-muted",
                        )}
                      />
                    ))}
                  </div>
                  <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                    {platformLabel(r.platform)}
                  </span>
                </div>
                {r.complaint && (
                  <div className="mb-2 font-display text-sm font-semibold">{r.complaint}</div>
                )}
                <p className={cn("text-sm text-muted-foreground", !expanded && "line-clamp-4")}>
                  “{r.text}”
                </p>
                <div className="mt-auto flex items-center justify-between pt-4 text-xs text-muted-foreground">
                  <span className="flex items-center gap-2">
                    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/15 font-semibold text-primary">
                      {r.author[0]}
                    </span>
                    {r.author} · {competitor} user
                  </span>
                  <ChevronDown
                    className={cn("h-4 w-4 transition-transform", expanded && "rotate-180")}
                  />
                </div>
              </button>
            );
          })}
        </div>
      )}
    </Wrap>
  );
}

function Faq({ c }: { c: C }) {
  const [open, setOpen] = useState<number | null>(0);
  return (
    <Wrap className="max-w-3xl">
      <H2>{str(c["title"])}</H2>
      <div className="divide-y rounded-2xl border bg-card">
        {arr<{ q: string; a: string }>(c["items"]).map((it, i) => (
          <div key={i}>
            <button
              type="button"
              onClick={() => setOpen(open === i ? null : i)}
              aria-expanded={open === i}
              className="flex w-full items-center justify-between gap-4 p-5 text-left font-medium"
            >
              {it.q}
              <ChevronDown
                className={cn("h-4 w-4 shrink-0 transition-transform", open === i && "rotate-180")}
              />
            </button>
            {open === i && <div className="px-5 pb-5 text-sm text-muted-foreground">{it.a}</div>}
          </div>
        ))}
      </div>
    </Wrap>
  );
}

function LeadForm({ c, pageId }: { c: C; pageId?: string | undefined }) {
  const fn = useServerFn(submitPageLead);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!pageId) {
      toast.info("Forms work on the published page.");
      return;
    }
    const f = new FormData(e.currentTarget);
    setBusy(true);
    try {
      const r = await fn({
        data: {
          page_id: pageId,
          name: String(f.get("name") ?? ""),
          email: String(f.get("email") ?? ""),
          company: String(f.get("company") ?? "") || undefined,
          message: String(f.get("message") ?? "") || undefined,
        },
      });
      if (r.ok) setDone(true);
      else toast.error("Could not send. Please try again.");
    } catch {
      toast.error("Please enter a valid email.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Wrap className="max-w-xl">
      <div className="rounded-2xl border bg-card p-6 shadow-sm sm:p-8">
        <h2 className="text-xl font-semibold tracking-tight">{str(c["title"])}</h2>
        {str(c["subtitle"]) && (
          <p className="mt-1 text-sm text-muted-foreground">{str(c["subtitle"])}</p>
        )}
        {done ? (
          <p className="mt-6 rounded-lg bg-primary/10 p-4 text-sm text-primary">
            {str(c["success_text"], "Thanks!")}
          </p>
        ) : (
          <form onSubmit={submit} className="mt-6 space-y-3">
            <Input name="name" placeholder="Your name" maxLength={120} />
            <Input name="email" type="email" required placeholder="Work email" maxLength={255} />
            {c["show_company"] !== false && (
              <Input name="company" placeholder="Company" maxLength={160} />
            )}
            {c["show_message"] !== false && (
              <Textarea
                name="message"
                placeholder="What are you using today?"
                maxLength={2000}
                rows={3}
              />
            )}
            <Button type="submit" className="w-full" disabled={busy}>
              {str(c["button_text"], "Send")}
            </Button>
          </form>
        )}
      </div>
    </Wrap>
  );
}

function youtubeId(u: string) {
  return u.match(/(?:youtu\.be\/|v=|embed\/|shorts\/)([\w-]{11})/)?.[1] ?? null;
}

export function BlockView({
  type,
  c,
  pageId,
}: {
  type: string;
  c: C;
  pageId?: string | undefined;
}) {
  switch (type) {
    case "hero": {
      const bg = str(c["background_image"]);
      return (
        <section className={cn("relative overflow-hidden border-b", bg && "text-white")}>
          {bg && (
            <>
              <img src={bg} alt="" className="absolute inset-0 h-full w-full object-cover" />
              <div className="absolute inset-0 bg-black/60" />
            </>
          )}
          <div className="relative mx-auto max-w-4xl px-5 py-20 text-center sm:py-28">
            <h1 className="text-3xl font-semibold tracking-tight sm:text-5xl">
              {str(c["headline"])}
            </h1>
            {str(c["subheadline"]) && (
              <p
                className={cn(
                  "mx-auto mt-4 max-w-2xl text-lg",
                  bg ? "text-white/80" : "text-muted-foreground",
                )}
              >
                {str(c["subheadline"])}
              </p>
            )}
            {str(c["cta_text"]) && (
              <Button asChild size="lg" className="mt-8">
                <a {...linkProps(str(c["cta_link"]))}>{str(c["cta_text"])}</a>
              </Button>
            )}
          </div>
        </section>
      );
    }
    case "richtext":
      return (
        <Wrap className="max-w-3xl">
          <div className="prose-blog">
            <MarkdownView content={str(c["markdown"])} />
          </div>
        </Wrap>
      );
    case "comparison":
      return <Comparison c={c} />;
    case "reviews":
      return <Reviews c={c} />;
    case "features":
      return (
        <Wrap>
          <H2>{str(c["title"])}</H2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {arr<{ icon: string; title: string; text: string }>(c["items"]).map((it, i) => (
              <div key={i} className="rounded-2xl border bg-card p-6">
                <div className="mb-3 text-2xl">{it.icon}</div>
                <div className="font-display font-semibold">{it.title}</div>
                <p className="mt-1 text-sm text-muted-foreground">{it.text}</p>
              </div>
            ))}
          </div>
        </Wrap>
      );
    case "faq":
      return <Faq c={c} />;
    case "pricing":
      return (
        <Wrap>
          <H2>{str(c["title"])}</H2>
          <div className="grid gap-4 md:grid-cols-[repeat(auto-fit,minmax(240px,1fr))]">
            {arr<{
              name: string;
              price: string;
              period: string;
              features: string;
              cta_text: string;
              cta_link: string;
              featured: boolean;
            }>(c["tiers"]).map((t, i) => (
              <div
                key={i}
                className={cn(
                  "flex flex-col rounded-2xl border bg-card p-6",
                  t.featured && "border-primary ring-1 ring-primary",
                )}
              >
                {t.featured && (
                  <span className="mb-3 w-fit rounded-full bg-primary px-2 py-0.5 text-[11px] font-medium text-primary-foreground">
                    Most popular
                  </span>
                )}
                <div className="font-display font-semibold">{t.name}</div>
                <div className="mt-2">
                  <span className="text-3xl font-semibold">{t.price}</span>
                  <span className="text-sm text-muted-foreground">{t.period}</span>
                </div>
                <ul className="my-6 space-y-2 text-sm">
                  {(t.features ?? "")
                    .split("\n")
                    .filter(Boolean)
                    .map((f, j) => (
                      <li key={j} className="flex gap-2">
                        <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                        {f}
                      </li>
                    ))}
                </ul>
                <Button asChild variant={t.featured ? "default" : "outline"} className="mt-auto">
                  <a {...linkProps(t.cta_link)}>{t.cta_text}</a>
                </Button>
              </div>
            ))}
          </div>
        </Wrap>
      );
    case "leadform":
      return <LeadForm c={c} pageId={pageId} />;
    case "media": {
      const url = str(c["url"]);
      const yt = c["kind"] === "youtube" ? youtubeId(url) : null;
      if (!url)
        return (
          <Wrap>
            <div className="flex h-48 items-center justify-center rounded-2xl border border-dashed text-sm text-muted-foreground">
              Add an image or YouTube link
            </div>
          </Wrap>
        );
      return (
        <Wrap className="max-w-4xl">
          <figure>
            {yt ? (
              <div className="aspect-video overflow-hidden rounded-2xl border">
                <iframe
                  className="h-full w-full"
                  src={`https://www.youtube-nocookie.com/embed/${yt}`}
                  title={str(c["caption"], "Video")}
                  allowFullScreen
                  loading="lazy"
                />
              </div>
            ) : (
              <img
                src={url}
                alt={str(c["alt"])}
                loading="lazy"
                className="w-full rounded-2xl border"
              />
            )}
            {str(c["caption"]) && (
              <figcaption className="mt-2 text-center text-sm text-muted-foreground">
                {str(c["caption"])}
              </figcaption>
            )}
          </figure>
        </Wrap>
      );
    }
    case "cta":
      return (
        <Wrap>
          <div className="flex flex-col items-center justify-between gap-4 rounded-2xl bg-primary p-8 text-primary-foreground sm:flex-row sm:p-10">
            <div>
              <h2 className="text-2xl font-semibold tracking-tight">{str(c["headline"])}</h2>
              {str(c["text"]) && <p className="mt-1 opacity-85">{str(c["text"])}</p>}
            </div>
            <Button asChild size="lg" variant="secondary">
              <a {...linkProps(str(c["cta_link"]))}>{str(c["cta_text"])}</a>
            </Button>
          </div>
        </Wrap>
      );
    default:
      return null;
  }
}

// ---------------- Settings forms ----------------
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{label}</Label>
      {children}
    </div>
  );
}
function ListEditor<T extends C>({
  items,
  onChange,
  blank,
  render,
  label,
}: {
  items: T[];
  onChange: (v: T[]) => void;
  blank: T;
  render: (it: T, set: (p: Partial<T>) => void) => React.ReactNode;
  label: string;
}) {
  return (
    <div className="space-y-3">
      {items.map((it, i) => (
        <div key={i} className="space-y-2 rounded-lg border p-3">
          <div className="flex justify-between text-xs text-muted-foreground">
            {label} {i + 1}
            <button
              type="button"
              aria-label="Remove"
              onClick={() => onChange(items.filter((_, j) => j !== i))}
            >
              <Trash2 className="h-3.5 w-3.5 hover:text-destructive" />
            </button>
          </div>
          {render(it, (p) => onChange(items.map((x, j) => (j === i ? { ...x, ...p } : x))))}
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => onChange([...items, { ...blank }])}
      >
        <Plus />
        Add {label.toLowerCase()}
      </Button>
    </div>
  );
}

export function BlockSettings({
  type,
  c,
  onChange,
  competitors,
}: {
  type: string;
  c: C;
  onChange: (c: C) => void;
  competitors: string[];
}) {
  const set = (k: string, v: unknown) => onChange({ ...c, [k]: v });
  const text = (k: string, label: string, ph?: string) => (
    <Field label={label}>
      <Input value={str(c[k])} placeholder={ph} onChange={(e) => set(k, e.target.value)} />
    </Field>
  );
  const area = (k: string, label: string, rows = 3) => (
    <Field label={label}>
      <Textarea rows={rows} value={str(c[k])} onChange={(e) => set(k, e.target.value)} />
    </Field>
  );
  switch (type) {
    case "hero":
      return (
        <>
          {text("headline", "Headline")}
          {area("subheadline", "Subheadline", 2)}
          {text("cta_text", "Button text")}
          {text("cta_link", "Button link", "/auth or https://…")}
          {text("background_image", "Background image URL", "https://…")}
        </>
      );
    case "richtext":
      return area("markdown", "Content (Markdown: ## heading, **bold**, [link](url))", 16);
    case "comparison": {
      const cols = arr<string>(c["columns"]);
      const rows = arr<{ feature: string; cells: string[] }>(c["rows"]);
      return (
        <>
          {text("title", "Title")}
          <Field label="Columns (products)">
            <div className="space-y-2">
              {cols.map((col, i) => (
                <div key={i} className="flex gap-2">
                  <Input
                    value={col}
                    onChange={(e) =>
                      set(
                        "columns",
                        cols.map((x, j) => (j === i ? e.target.value : x)),
                      )
                    }
                  />
                  <Button
                    type="button"
                    size="icon"
                    variant={Number(c["highlight"] ?? 0) === i ? "default" : "outline"}
                    title="Highlight this column"
                    onClick={() => set("highlight", i)}
                  >
                    <Sparkles />
                  </Button>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    aria-label="Remove column"
                    onClick={() =>
                      onChange({
                        ...c,
                        columns: cols.filter((_, j) => j !== i),
                        rows: rows.map((r) => ({ ...r, cells: r.cells.filter((_, j) => j !== i) })),
                      })
                    }
                  >
                    <Trash2 />
                  </Button>
                </div>
              ))}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  onChange({
                    ...c,
                    columns: [...cols, `Competitor ${String.fromCharCode(65 + cols.length - 1)}`],
                    rows: rows.map((r) => ({ ...r, cells: [...r.cells, "no"] })),
                  })
                }
              >
                <Plus />
                Add column
              </Button>
            </div>
          </Field>
          <p className="text-xs text-muted-foreground">
            Cells: type <b>yes</b>, <b>no</b>, <b>partial</b>, or any text.
          </p>
          <ListEditor
            label="Row"
            items={rows}
            blank={{ feature: "New feature", cells: cols.map(() => "yes") }}
            onChange={(v) => set("rows", v)}
            render={(r, setR) => (
              <>
                <Input
                  value={r.feature}
                  placeholder="Feature"
                  onChange={(e) => setR({ feature: e.target.value })}
                />
                <div className="grid grid-cols-2 gap-2">
                  {cols.map((col, ci) => (
                    <Input
                      key={ci}
                      value={r.cells?.[ci] ?? ""}
                      placeholder={col}
                      title={col}
                      onChange={(e) => {
                        const cells = [...(r.cells ?? [])];
                        cells[ci] = e.target.value;
                        setR({ cells });
                      }}
                    />
                  ))}
                </div>
              </>
            )}
          />
        </>
      );
    }
    case "reviews":
      return (
        <>
          {text("title", "Title")}
          <Field label="Competitor">
            <select
              className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
              value={str(c["competitor"])}
              onChange={(e) => set("competitor", e.target.value)}
            >
              <option value="">Choose…</option>
              {competitors.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </Field>
          <Field label="How many reviews">
            <Input
              type="number"
              min={1}
              max={12}
              value={Number(c["limit"] ?? 6)}
              onChange={(e) => set("limit", Number(e.target.value))}
            />
          </Field>
          <p className="text-xs text-muted-foreground">
            Shows real complaints we collected, first names only.
          </p>
        </>
      );
    case "features":
      return (
        <>
          {text("title", "Title")}
          <ListEditor
            label="Feature"
            items={arr<{ icon: string; title: string; text: string }>(c["items"])}
            blank={{ icon: "✨", title: "Feature", text: "" }}
            onChange={(v) => set("items", v)}
            render={(it, s) => (
              <>
                <div className="flex gap-2">
                  <Input
                    className="w-16"
                    value={it.icon}
                    onChange={(e) => s({ icon: e.target.value })}
                  />
                  <Input value={it.title} onChange={(e) => s({ title: e.target.value })} />
                </div>
                <Textarea rows={2} value={it.text} onChange={(e) => s({ text: e.target.value })} />
              </>
            )}
          />
        </>
      );
    case "faq":
      return (
        <>
          {text("title", "Title")}
          <ListEditor
            label="Question"
            items={arr<{ q: string; a: string }>(c["items"])}
            blank={{ q: "", a: "" }}
            onChange={(v) => set("items", v)}
            render={(it, s) => (
              <>
                <Input
                  placeholder="Question"
                  value={it.q}
                  onChange={(e) => s({ q: e.target.value })}
                />
                <Textarea
                  rows={3}
                  placeholder="Answer"
                  value={it.a}
                  onChange={(e) => s({ a: e.target.value })}
                />
              </>
            )}
          />
        </>
      );
    case "pricing":
      return (
        <>
          {text("title", "Title")}
          <ListEditor
            label="Tier"
            items={arr<{
              name: string;
              price: string;
              period: string;
              features: string;
              cta_text: string;
              cta_link: string;
              featured: boolean;
            }>(c["tiers"])}
            blank={{
              name: "Plan",
              price: "$0",
              period: "/mo",
              features: "",
              cta_text: "Choose",
              cta_link: "/auth",
              featured: false,
            }}
            onChange={(v) => set("tiers", v)}
            render={(t, s) => (
              <>
                <Input
                  placeholder="Name"
                  value={t.name}
                  onChange={(e) => s({ name: e.target.value })}
                />
                <div className="flex gap-2">
                  <Input
                    placeholder="$29"
                    value={t.price}
                    onChange={(e) => s({ price: e.target.value })}
                  />
                  <Input
                    placeholder="/mo"
                    value={t.period}
                    onChange={(e) => s({ period: e.target.value })}
                  />
                </div>
                <Textarea
                  rows={3}
                  placeholder="One feature per line"
                  value={t.features}
                  onChange={(e) => s({ features: e.target.value })}
                />
                <div className="flex gap-2">
                  <Input
                    placeholder="Button"
                    value={t.cta_text}
                    onChange={(e) => s({ cta_text: e.target.value })}
                  />
                  <Input
                    placeholder="Link"
                    value={t.cta_link}
                    onChange={(e) => s({ cta_link: e.target.value })}
                  />
                </div>
                <label className="flex items-center gap-2 text-xs">
                  <input
                    type="checkbox"
                    checked={!!t.featured}
                    onChange={(e) => s({ featured: e.target.checked })}
                  />
                  Highlight as most popular
                </label>
              </>
            )}
          />
        </>
      );
    case "leadform":
      return (
        <>
          {text("title", "Title")}
          {text("subtitle", "Subtitle")}
          {text("button_text", "Button text")}
          {text("success_text", "Thank-you message")}
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={c["show_company"] !== false}
              onChange={(e) => set("show_company", e.target.checked)}
            />
            Ask for company
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={c["show_message"] !== false}
              onChange={(e) => set("show_message", e.target.checked)}
            />
            Ask for a message
          </label>
          <p className="text-xs text-muted-foreground">
            Submissions appear under "Form submissions" in the page builder.
          </p>
        </>
      );
    case "media":
      return (
        <>
          <Field label="Type">
            <select
              className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
              value={str(c["kind"], "image")}
              onChange={(e) => set("kind", e.target.value)}
            >
              <option value="image">Image</option>
              <option value="youtube">YouTube video</option>
            </select>
          </Field>
          {text("url", c["kind"] === "youtube" ? "YouTube link" : "Image URL", "https://…")}
          {c["kind"] !== "youtube" && text("alt", "Alt text")}
          {text("caption", "Caption")}
        </>
      );
    case "cta":
      return (
        <>
          {text("headline", "Headline")}
          {area("text", "Text", 2)}
          {text("cta_text", "Button text")}
          {text("cta_link", "Button link")}
        </>
      );
    default:
      return null;
  }
}
