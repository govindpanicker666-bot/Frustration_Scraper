import { useMemo } from "react";
import { MarkdownView, buildToc, type TocItem } from "./MarkdownView";

export type Faq = { question: string; answer: string };

function stripTags(s: string): string {
  return s
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function decode(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

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

export function isHtmlContent(content: string, format?: string | null): boolean {
  if (format === "html") return true;
  return /^\s*<(p|h[1-6]|ul|ol|div|blockquote|figure|table|pre|img)\b/i.test(content);
}

/** Adds heading anchors, expands the TOC placeholder, and extracts FAQ pairs. */
export type RelatedLink = { slug?: string; title?: string };
const esc = (t: string) =>
  t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function prepareBlogHtml(
  raw: string,
  related: RelatedLink[] = [],
): { html: string; toc: TocItem[]; faqs: Faq[] } {
  const toc: TocItem[] = [];
  const seen = new Set<string>();

  let html = raw.replace(
    /<h([23])([^>]*)>([\s\S]*?)<\/h\1>/g,
    (_m, lvl: string, attrs: string, inner: string) => {
      const text = decode(stripTags(inner));
      const existing = /id="([^"]+)"/.exec(attrs)?.[1];
      let id = existing || slugifyHeading(text);
      let n = 2;
      while (seen.has(id)) id = `${slugifyHeading(text)}-${n++}`;
      seen.add(id);
      toc.push({ id, text, level: Number(lvl) as 2 | 3 });
      const cleaned = attrs.replace(/\s*id="[^"]*"/, "");
      return `<h${lvl}${cleaned} id="${id}">${inner}</h${lvl}>`;
    },
  );

  const faqs: Faq[] = [];
  const questions = [...raw.matchAll(/<div[^>]*data-faq-question[^>]*>([\s\S]*?)<\/div>/g)].map(
    (m) => decode(stripTags(m[1] ?? "")),
  );
  const answers = [
    ...raw.matchAll(/<div[^>]*data-faq-answer[^>]*>([\s\S]*?)<\/div>\s*<\/div>/g),
  ].map((m) => decode(stripTags(m[1] ?? "")));
  questions.forEach((q, i) => {
    if (q && answers[i]) faqs.push({ question: q, answer: answers[i] });
  });

  const tocHtml =
    toc.length > 0
      ? `<nav class="toc-block" aria-label="Table of contents"><p class="toc-title">On this page</p><ul>${toc
          .map((t) => `<li class="toc-l${t.level}"><a href="#${t.id}">${t.text}</a></li>`)
          .join("")}</ul></nav>`
      : "";
  html = html.replace(/<div[^>]*data-toc[^>]*>\s*<\/div>/g, tocHtml);

  // CTA boxes get a real button; "Also read" placeholders become links to our other posts.
  html = html.replace(
    /<div([^>]*data-cta[^>]*)>([\s\S]*?)<\/div>/g,
    (_m, attrs: string, inner: string) => {
      const href = /data-href="([^"]*)"/.exec(attrs)?.[1] ?? "/";
      const label = /data-label="([^"]*)"/.exec(attrs)?.[1] ?? "Get started";
      const safeHref = /^(https?:\/\/|\/)/.test(href) ? href : "/";
      return `<div${attrs}>${inner}<a class="cta-button" href="${safeHref}">${label}</a></div>`;
    },
  );
  const alsoRead = related.filter((r) => r.slug && r.title).slice(0, 3);
  html = html.replace(/<div[^>]*data-also-read[^>]*>[\s\S]*?<\/div>/g, () =>
    alsoRead.length
      ? `<aside class="also-read"><p class="also-read-title">Also read</p><ul>${alsoRead.map((r) => `<li><a href="/blog/${encodeURIComponent(r.slug!)}">${esc(r.title!)}</a></li>`).join("")}</ul></aside>`
      : "",
  );

  // Responsive YouTube wrapper + lazy images
  html = html.replace(/<iframe /g, '<iframe loading="lazy" ');
  html = html.replace(/<img /g, '<img loading="lazy" decoding="async" ');

  return { html, toc, faqs };
}

export function buildBlogToc(content: string, format?: string | null): TocItem[] {
  return isHtmlContent(content, format) ? prepareBlogHtml(content).toc : buildToc(content);
}

export function buildFaqSchema(content: string, format?: string | null) {
  if (!isHtmlContent(content, format)) return null;
  const { faqs } = prepareBlogHtml(content);
  if (!faqs.length) return null;
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqs.map((f) => ({
      "@type": "Question",
      name: f.question,
      acceptedAnswer: { "@type": "Answer", text: f.answer },
    })),
  };
}

export function RichContentView({
  content,
  format,
  related,
}: {
  content: string;
  format?: string | null;
  related?: RelatedLink[];
}) {
  const html = useMemo(
    () => (isHtmlContent(content, format) ? prepareBlogHtml(content, related).html : null),
    [content, format, related],
  );
  if (html === null) return <MarkdownView content={content} />;
  return (
    <div
      className="prose-blog"
      // Admin-authored trusted content
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
