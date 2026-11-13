import { Node, mergeAttributes, type CommandProps } from "@tiptap/core";

/** Callout / info box: <div data-callout="info">...</div> */
export const Callout = Node.create({
  name: "callout",
  group: "block",
  content: "block+",
  defining: true,
  addAttributes() {
    return {
      variant: {
        default: "info",
        parseHTML: (el) => el.getAttribute("data-callout") || "info",
        renderHTML: (attrs) => ({ "data-callout": attrs["variant"] }),
      },
    };
  },
  parseHTML() {
    return [{ tag: "div[data-callout]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { class: "callout" }), 0];
  },
  addCommands() {
    return {
      setCallout:
        (variant = "info") =>
        ({ commands }: CommandProps) =>
          commands.wrapIn(this.name, { variant }),
      toggleCallout:
        (variant = "info") =>
        ({ commands }: CommandProps) =>
          commands.toggleWrap(this.name, { variant }),
    } as never;
  },
});

/** Oversized feature quote: <blockquote data-pullquote> */
export const PullQuote = Node.create({
  name: "pullQuote",
  group: "block",
  content: "block+",
  defining: true,
  parseHTML() {
    return [{ tag: "blockquote[data-pullquote]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return [
      "blockquote",
      mergeAttributes(HTMLAttributes, { "data-pullquote": "", class: "pullquote" }),
      0,
    ];
  },
  addCommands() {
    return {
      togglePullQuote:
        () =>
        ({ commands }: CommandProps) =>
          commands.toggleWrap(this.name),
    } as never;
  },
});

/** Table of contents placeholder: <div data-toc></div> */
export const TableOfContents = Node.create({
  name: "tocBlock",
  group: "block",
  atom: true,
  selectable: true,
  parseHTML() {
    return [{ tag: "div[data-toc]" }];
  },
  renderHTML() {
    return ["div", { "data-toc": "", class: "toc-block" }];
  },
  addCommands() {
    return {
      insertTableOfContents:
        () =>
        ({ commands }: CommandProps) =>
          commands.insertContent({ type: this.name }),
    } as never;
  },
});

/** FAQ question line */
export const FaqQuestion = Node.create({
  name: "faqQuestion",
  content: "inline*",
  defining: true,
  parseHTML() {
    return [{ tag: "div[data-faq-question]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-faq-question": "", class: "faq-q" }), 0];
  },
});

/** FAQ answer body */
export const FaqAnswer = Node.create({
  name: "faqAnswer",
  content: "block+",
  defining: true,
  parseHTML() {
    return [{ tag: "div[data-faq-answer]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-faq-answer": "", class: "faq-a" }), 0];
  },
});

/** FAQ pair block, serialized so the public page can emit FAQPage JSON-LD */
export const FaqItem = Node.create({
  name: "faqItem",
  group: "block",
  content: "faqQuestion faqAnswer",
  defining: true,
  isolating: true,
  parseHTML() {
    return [{ tag: "div[data-faq-item]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-faq-item": "", class: "faq-item" }), 0];
  },
  addCommands() {
    return {
      insertFaqItem:
        () =>
        ({ commands }: CommandProps) =>
          commands.insertContent({
            type: this.name,
            content: [
              { type: "faqQuestion", content: [{ type: "text", text: "Your question here?" }] },
              {
                type: "faqAnswer",
                content: [
                  {
                    type: "paragraph",
                    content: [{ type: "text", text: "A direct answer in the first sentence." }],
                  },
                ],
              },
            ],
          }),
    } as never;
  },
});

/** File attachment rendered as an inline downloadable link */
export const FileAttachment = Node.create({
  name: "fileAttachment",
  group: "block",
  atom: true,
  addAttributes() {
    return {
      href: { default: "" },
      label: { default: "Download file" },
    };
  },
  parseHTML() {
    return [{ tag: "a[data-file-attachment]" }];
  },
  renderHTML({ HTMLAttributes }) {
    const { href, label } = HTMLAttributes as { href: string; label: string };
    return [
      "a",
      {
        "data-file-attachment": "",
        class: "file-attachment",
        href,
        download: "",
        rel: "noopener noreferrer",
      },
      label || "Download file",
    ];
  },
  addCommands() {
    return {
      insertFileAttachment:
        (attrs: { href: string; label: string }) =>
        ({ commands }: CommandProps) =>
          commands.insertContent({ type: this.name, attrs }),
    } as never;
  },
});
/** Call-to-action box: <div data-cta data-href data-label>content</div> */
export const CtaBox = Node.create({
  name: "ctaBox",
  group: "block",
  content: "block+",
  defining: true,
  addAttributes() {
    return {
      href: {
        default: "/",
        parseHTML: (el) => el.getAttribute("data-href") || "/",
        renderHTML: (a) => ({ "data-href": a["href"] }),
      },
      label: {
        default: "Get started",
        parseHTML: (el) => el.getAttribute("data-label") || "Get started",
        renderHTML: (a) => ({ "data-label": a["label"] }),
      },
    };
  },
  parseHTML() {
    return [{ tag: "div[data-cta]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-cta": "", class: "cta-box" }), 0];
  },
  addCommands() {
    return {
      insertCta:
        (attrs: { href: string; label: string }) =>
        ({ commands }: CommandProps) =>
          commands.insertContent({
            type: this.name,
            attrs,
            content: [
              {
                type: "paragraph",
                content: [{ type: "text", text: "Ready to switch? Describe the offer here." }],
              },
            ],
          }),
    } as never;
  },
});

/** "Also read" placeholder. On the public page it is replaced by our latest related posts. */
export const AlsoRead = Node.create({
  name: "alsoRead",
  group: "block",
  atom: true,
  parseHTML() {
    return [{ tag: "div[data-also-read]" }];
  },
  renderHTML() {
    return [
      "div",
      { "data-also-read": "", class: "also-read-placeholder" },
      "Also read: related posts appear here automatically",
    ];
  },
  addCommands() {
    return {
      insertAlsoRead:
        () =>
        ({ commands }: CommandProps) =>
          commands.insertContent({ type: this.name }),
    } as never;
  },
});

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    churnhoundBlocks: {
      insertCta: (attrs: { href: string; label: string }) => ReturnType;
      insertAlsoRead: () => ReturnType;
      setCallout: (variant?: string) => ReturnType;
      toggleCallout: (variant?: string) => ReturnType;
      togglePullQuote: () => ReturnType;
      insertTableOfContents: () => ReturnType;
      insertFaqItem: () => ReturnType;
      insertFileAttachment: (attrs: { href: string; label: string }) => ReturnType;
    };
  }
}
