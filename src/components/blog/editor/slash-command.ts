import { Extension, type Editor, type Range } from "@tiptap/core";
import Suggestion from "@tiptap/suggestion";
import "@tiptap/starter-kit";
import "@tiptap/extension-list";
import "@tiptap/extension-table";
import "./nodes";

export type SlashItem = {
  title: string;
  hint: string;
  keywords: string;
  run: (editor: Editor, range: Range) => void;
};

export function buildSlashItems(opts: {
  onImage: () => void;
  onYoutube: () => void;
  onLink: () => void;
  onFile: () => void;
}): SlashItem[] {
  const chain = (editor: Editor, range: Range) => editor.chain().focus().deleteRange(range);
  return [
    {
      title: "Heading 1",
      hint: "Large section title",
      keywords: "h1 title",
      run: (e, r) => chain(e, r).setNode("heading", { level: 1 }).run(),
    },
    {
      title: "Heading 2",
      hint: "Section heading",
      keywords: "h2",
      run: (e, r) => chain(e, r).setNode("heading", { level: 2 }).run(),
    },
    {
      title: "Heading 3",
      hint: "Sub heading",
      keywords: "h3",
      run: (e, r) => chain(e, r).setNode("heading", { level: 3 }).run(),
    },
    {
      title: "Heading 4",
      hint: "Minor heading",
      keywords: "h4",
      run: (e, r) => chain(e, r).setNode("heading", { level: 4 }).run(),
    },
    {
      title: "Heading 5",
      hint: "Smallest heading",
      keywords: "h5",
      run: (e, r) => chain(e, r).setNode("heading", { level: 5 }).run(),
    },
    {
      title: "Paragraph",
      hint: "Plain text",
      keywords: "text body",
      run: (e, r) => chain(e, r).setNode("paragraph").run(),
    },
    {
      title: "Bullet list",
      hint: "Unordered list",
      keywords: "ul bullets",
      run: (e, r) => chain(e, r).toggleBulletList().run(),
    },
    {
      title: "Numbered list",
      hint: "Ordered list",
      keywords: "ol numbers",
      run: (e, r) => chain(e, r).toggleOrderedList().run(),
    },
    {
      title: "Task list",
      hint: "Checklist",
      keywords: "todo checkbox",
      run: (e, r) => chain(e, r).toggleTaskList().run(),
    },
    {
      title: "Blockquote",
      hint: "Quote block",
      keywords: "quote",
      run: (e, r) => chain(e, r).toggleBlockquote().run(),
    },
    {
      title: "Pull quote",
      hint: "Oversized feature quote",
      keywords: "pullquote highlight",
      run: (e, r) => chain(e, r).run() || e.chain().focus().togglePullQuote().run(),
    },
    {
      title: "Callout",
      hint: "Tip / note box",
      keywords: "info note warning",
      run: (e, r) => chain(e, r).run() || e.chain().focus().toggleCallout("info").run(),
    },
    {
      title: "Did you know box",
      hint: "Highlight a surprising fact",
      keywords: "did you know fact",
      run: (e, r) => chain(e, r).run() || e.chain().focus().toggleCallout("didyouknow").run(),
    },
    {
      title: "TL;DR box",
      hint: "Short summary",
      keywords: "tldr summary",
      run: (e, r) => chain(e, r).run() || e.chain().focus().toggleCallout("tldr").run(),
    },
    {
      title: "Quote box",
      hint: "Highlighted quote",
      keywords: "quote box",
      run: (e, r) => chain(e, r).run() || e.chain().focus().toggleCallout("quote").run(),
    },
    {
      title: "CTA box",
      hint: "Call to action with a button",
      keywords: "cta button signup",
      run: (e, r) =>
        chain(e, r).run() ||
        e.chain().focus().insertCta({ href: "/auth", label: "Try Churnhound free" }).run(),
    },
    {
      title: "Also read",
      hint: "Auto list of our related posts",
      keywords: "related posts also read",
      run: (e, r) => chain(e, r).run() || e.chain().focus().insertAlsoRead().run(),
    },
    {
      title: "FAQ block",
      hint: "Question and answer (adds FAQ schema)",
      keywords: "faq question answer seo",
      run: (e, r) => chain(e, r).run() || e.chain().focus().insertFaqItem().run(),
    },
    {
      title: "Table of contents",
      hint: "Auto-generated from headings",
      keywords: "toc outline",
      run: (e, r) => chain(e, r).run() || e.chain().focus().insertTableOfContents().run(),
    },
    {
      title: "Code block",
      hint: "Syntax highlighted code",
      keywords: "code snippet",
      run: (e, r) => chain(e, r).toggleCodeBlock().run(),
    },
    {
      title: "Table",
      hint: "Insert a 3x3 table",
      keywords: "grid rows columns",
      run: (e, r) => chain(e, r).insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
    },
    {
      title: "Divider",
      hint: "Horizontal rule",
      keywords: "hr separator line",
      run: (e, r) => chain(e, r).setHorizontalRule().run(),
    },
    {
      title: "Image",
      hint: "Upload or embed an image",
      keywords: "picture photo upload",
      run: (e, r) => {
        chain(e, r).run();
        opts.onImage();
      },
    },
    {
      title: "YouTube video",
      hint: "Embed a YouTube URL",
      keywords: "video embed",
      run: (e, r) => {
        chain(e, r).run();
        opts.onYoutube();
      },
    },
    {
      title: "File attachment",
      hint: "Upload a downloadable file",
      keywords: "attachment pdf download",
      run: (e, r) => {
        chain(e, r).run();
        opts.onFile();
      },
    },
    {
      title: "Link",
      hint: "Add a hyperlink",
      keywords: "url href",
      run: (e, r) => {
        chain(e, r).run();
        opts.onLink();
      },
    },
  ];
}

type MenuState = {
  items: SlashItem[];
  index: number;
  rect: { top: number; left: number } | null;
  select: (item: SlashItem) => void;
};

export const SlashCommand = Extension.create<{
  items: SlashItem[];
  onStateChange: (state: MenuState | null) => void;
}>({
  name: "slashCommand",
  addOptions() {
    return { items: [], onStateChange: () => {} };
  },
  addProseMirrorPlugins() {
    let current: { editor: Editor; range: Range; items: SlashItem[]; index: number } | null = null;

    const emit = (rect: { top: number; left: number } | null) => {
      if (!current || !rect) {
        this.options.onStateChange(null);
        return;
      }
      this.options.onStateChange({
        items: current.items,
        index: current.index,
        rect,
        select: (item) => {
          if (current) item.run(current.editor, current.range);
          this.options.onStateChange(null);
        },
      });
    };

    return [
      Suggestion({
        editor: this.editor,
        char: "/",
        startOfLine: false,
        allowSpaces: false,
        items: ({ query }) => {
          const q = query.toLowerCase().trim();
          const all = this.options.items;
          if (!q) return all;
          return all.filter(
            (i) => i.title.toLowerCase().includes(q) || i.keywords.toLowerCase().includes(q),
          );
        },
        render: () => {
          let lastRect: { top: number; left: number } | null = null;
          const toRect = (props: { clientRect?: (() => DOMRect | null) | null }) => {
            const r = props.clientRect?.();
            if (!r) return lastRect;
            lastRect = { top: r.bottom + window.scrollY, left: r.left + window.scrollX };
            return lastRect;
          };
          return {
            onStart: (props) => {
              current = {
                editor: props.editor,
                range: props.range,
                items: props.items as SlashItem[],
                index: 0,
              };
              emit(toRect(props));
            },
            onUpdate: (props) => {
              if (!current) return;
              current = {
                editor: props.editor,
                range: props.range,
                items: props.items as SlashItem[],
                index: 0,
              };
              emit(toRect(props));
            },
            onKeyDown: (props) => {
              if (!current) return false;
              const key = props.event.key;
              if (key === "Escape") {
                current = null;
                this.options.onStateChange(null);
                return true;
              }
              if (key === "ArrowDown" || key === "ArrowUp") {
                const len = current.items.length || 1;
                current.index =
                  key === "ArrowDown" ? (current.index + 1) % len : (current.index - 1 + len) % len;
                emit(lastRect);
                return true;
              }
              if (key === "Enter" || key === "Tab") {
                const item = current.items[current.index];
                if (item) {
                  item.run(current.editor, current.range);
                  current = null;
                  this.options.onStateChange(null);
                  return true;
                }
              }
              return false;
            },
            onExit: () => {
              current = null;
              this.options.onStateChange(null);
            },
          };
        },
      }),
    ];
  },
});

export type { MenuState };
