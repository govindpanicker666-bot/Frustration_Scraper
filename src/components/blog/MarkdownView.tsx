import { marked } from "marked";
import { useMemo } from "react";

marked.setOptions({ gfm: true, breaks: false });

export type TocItem = { id: string; text: string; level: 2 | 3 };

function slugifyHeading(t: string): string {
  return (
    t
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, "")
      .trim()
      .replace(/\s+/g, "-")
      .slice(0, 60) || "section"
  );
}

export function buildToc(md: string): TocItem[] {
  const items: TocItem[] = [];
  const lines = md.split(/\r?\n/);
  const seen = new Set<string>();
  for (const l of lines) {
    const m2 = /^##\s+(.+)$/.exec(l);
    const m3 = /^###\s+(.+)$/.exec(l);
    if (m2 || m3) {
      const text = (m2 ? m2[1]! : m3![1]!).replace(/[*_`]/g, "").trim();
      let id = slugifyHeading(text);
      let n = 2;
      while (seen.has(id)) id = `${slugifyHeading(text)}-${n++}`;
      seen.add(id);
      items.push({ id, text, level: m2 ? 2 : 3 });
    }
  }
  return items;
}

function renderMarkdown(md: string, toc: TocItem[]): string {
  const renderer = new marked.Renderer();
  let idx = 0;
  renderer.heading = ({
    tokens,
    depth,
  }: {
    tokens: { raw?: string; text?: string }[];
    depth: number;
  }) => {
    const text = tokens.map((t) => t.text ?? t.raw ?? "").join("");
    if (depth === 2 || depth === 3) {
      const item = toc[idx++];
      const id = item?.id ?? slugifyHeading(text);
      return `<h${depth} id="${id}">${text}</h${depth}>`;
    }
    return `<h${depth}>${text}</h${depth}>`;
  };
  return marked.parse(md, { renderer }) as string;
}

export function MarkdownView({ content }: { content: string }) {
  const { html } = useMemo(() => {
    const toc = buildToc(content);
    return { html: renderMarkdown(content, toc) };
  }, [content]);
  return (
    <div
      className="prose-blog"
      // Author-only trusted content (admin-authored)
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
