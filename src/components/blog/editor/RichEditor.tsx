import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import DragHandle from "@tiptap/extension-drag-handle-react";
import StarterKit from "@tiptap/starter-kit";
import { TaskList, TaskItem } from "@tiptap/extension-list";
import { TableKit } from "@tiptap/extension-table";
import { TextStyle, Color } from "@tiptap/extension-text-style";
import Highlight from "@tiptap/extension-highlight";
import Image from "@tiptap/extension-image";
import Youtube from "@tiptap/extension-youtube";
import Subscript from "@tiptap/extension-subscript";
import Superscript from "@tiptap/extension-superscript";
import TextAlign from "@tiptap/extension-text-align";
import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight";
import { createLowlight, common } from "lowlight";
import { useServerFn } from "@tanstack/react-start";
import { uploadBlogMedia } from "@/lib/blog-media.functions";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Bold,
  Italic,
  Underline as UnderlineIcon,
  Strikethrough,
  Code,
  Highlighter,
  List,
  ListOrdered,
  ListChecks,
  Quote,
  Minus,
  Link2,
  Link2Off,
  ImageIcon,
  Youtube as YoutubeIcon,
  Table as TableIcon,
  Code2,
  Info,
  HelpCircle,
  ListTree,
  Paperclip,
  AlignLeft,
  AlignCenter,
  AlignRight,
  Eraser,
  Superscript as SupIcon,
  Subscript as SubIcon,
  Indent,
  Outdent,
  Rows,
  Columns,
  Trash2,
  MessageSquareQuote,
} from "lucide-react";
import {
  Callout,
  PullQuote,
  TableOfContents,
  FaqItem,
  FaqQuestion,
  FaqAnswer,
  FileAttachment,
  CtaBox,
  AlsoRead,
} from "./nodes";
import { SlashCommand, buildSlashItems, type MenuState } from "./slash-command";

const lowlight = createLowlight(common);

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1] ?? "");
    r.onerror = () => reject(new Error("Could not read file"));
    r.readAsDataURL(file);
  });
}

type DialogKind = null | "image" | "youtube" | "link" | "file";

export function RichEditor({
  value,
  onChange,
}: {
  value: string;
  onChange: (html: string) => void;
}) {
  const uploadFn = useServerFn(uploadBlogMedia);
  const [slash, setSlash] = useState<MenuState | null>(null);
  const [dialog, setDialog] = useState<DialogKind>(null);
  const [urlField, setUrlField] = useState("");
  const [altField, setAltField] = useState("");
  const [uploading, setUploading] = useState(false);
  const fileInput = useRef<HTMLInputElement | null>(null);
  const attachInput = useRef<HTMLInputElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  const slashItems = useMemo(
    () =>
      buildSlashItems({
        onImage: () => {
          setUrlField("");
          setAltField("");
          setDialog("image");
        },
        onYoutube: () => {
          setUrlField("");
          setDialog("youtube");
        },
        onLink: () => {
          setUrlField("");
          setDialog("link");
        },
        onFile: () => attachInput.current?.click(),
      }),
    [],
  );

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3, 4, 5] },
        codeBlock: false,
        link: {
          openOnClick: false,
          autolink: true,
          HTMLAttributes: { target: "_blank", rel: "noopener noreferrer" },
        },
      }),
      CodeBlockLowlight.configure({ lowlight }),
      TaskList,
      TaskItem.configure({ nested: true }),
      TableKit.configure({ table: { resizable: true } }),
      TextStyle,
      Color,
      Highlight.configure({ multicolor: true }),
      Subscript,
      Superscript,
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      Image.configure({ HTMLAttributes: { loading: "lazy" } }),
      Youtube.configure({ controls: true, nocookie: true, width: 800, height: 450 }),
      Callout,
      PullQuote,
      TableOfContents,
      FaqItem,
      FaqQuestion,
      FaqAnswer,
      FileAttachment,
      CtaBox,
      AlsoRead,
      SlashCommand.configure({ items: slashItems, onStateChange: setSlash }),
    ],
    content: value || "<p></p>",
    editorProps: {
      attributes: {
        class: "tiptap-surface prose-blog focus:outline-none",
      },
    },
    onUpdate: ({ editor }) => onChange(editor.getHTML()),
  });

  // Load external content changes (e.g. AI draft) without clobbering typing
  const lastSet = useRef(value);
  useEffect(() => {
    if (!editor) return;
    if (value === lastSet.current) return;
    if (value !== editor.getHTML()) {
      lastSet.current = value;
      editor.commands.setContent(value || "<p></p>", { emitUpdate: false });
    }
  }, [value, editor]);

  const doUpload = useCallback(
    async (file: File, kind: "image" | "file") => {
      setUploading(true);
      try {
        const dataBase64 = await fileToBase64(file);
        const res = await uploadFn({
          data: { fileName: file.name, contentType: file.type, dataBase64 },
        });
        if (kind === "image") {
          editor
            ?.chain()
            .focus()
            .setImage({ src: res.url, alt: altField || file.name })
            .run();
        } else {
          editor?.chain().focus().insertFileAttachment({ href: res.url, label: file.name }).run();
        }
        toast.success("Uploaded");
        setDialog(null);
      } catch (e) {
        toast.error((e as Error).message);
      } finally {
        setUploading(false);
      }
    },
    [uploadFn, editor, altField],
  );

  if (!editor) return <div className="min-h-[400px] rounded-lg border border-border bg-card" />;

  const btn = (active: boolean) =>
    `h-8 min-w-8 px-2 inline-flex items-center justify-center rounded-md text-sm transition-colors ${
      active ? "bg-primary text-primary-foreground" : "text-foreground/80 hover:bg-muted"
    }`;

  const applyLink = () => {
    const href = urlField.trim();
    if (!href) {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
    } else {
      editor
        .chain()
        .focus()
        .extendMarkRange("link")
        .setLink({ href, target: "_blank", rel: "noopener noreferrer" })
        .run();
    }
    setDialog(null);
  };

  return (
    <div ref={wrapRef} className="rounded-lg border border-border bg-card overflow-hidden">
      {/* Fixed toolbar */}
      <div className="sticky top-0 z-20 border-b border-border bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/80">
        <div className="flex flex-wrap items-center gap-1 p-2 overflow-x-auto">
          <select
            className="h-8 rounded-md border border-input bg-background px-2 text-xs"
            value={
              editor.isActive("heading", { level: 1 })
                ? "1"
                : editor.isActive("heading", { level: 2 })
                  ? "2"
                  : editor.isActive("heading", { level: 3 })
                    ? "3"
                    : editor.isActive("heading", { level: 4 })
                      ? "4"
                      : editor.isActive("heading", { level: 5 })
                        ? "5"
                        : "p"
            }
            onChange={(e) => {
              const v = e.target.value;
              if (v === "p") editor.chain().focus().setParagraph().run();
              else
                editor
                  .chain()
                  .focus()
                  .setHeading({ level: Number(v) as 1 | 2 | 3 | 4 | 5 })
                  .run();
            }}
          >
            <option value="p">Paragraph</option>
            <option value="1">Heading 1</option>
            <option value="2">Heading 2</option>
            <option value="3">Heading 3</option>
            <option value="4">Heading 4</option>
            <option value="5">Heading 5</option>
          </select>

          <span className="w-px h-6 bg-border mx-1" />
          <button
            className={btn(editor.isActive("bold"))}
            onClick={() => editor.chain().focus().toggleBold().run()}
            title="Bold"
          >
            <Bold className="w-4 h-4" />
          </button>
          <button
            className={btn(editor.isActive("italic"))}
            onClick={() => editor.chain().focus().toggleItalic().run()}
            title="Italic"
          >
            <Italic className="w-4 h-4" />
          </button>
          <button
            className={btn(editor.isActive("underline"))}
            onClick={() => editor.chain().focus().toggleUnderline().run()}
            title="Underline"
          >
            <UnderlineIcon className="w-4 h-4" />
          </button>
          <button
            className={btn(editor.isActive("strike"))}
            onClick={() => editor.chain().focus().toggleStrike().run()}
            title="Strikethrough"
          >
            <Strikethrough className="w-4 h-4" />
          </button>
          <button
            className={btn(editor.isActive("code"))}
            onClick={() => editor.chain().focus().toggleCode().run()}
            title="Inline code"
          >
            <Code className="w-4 h-4" />
          </button>
          <button
            className={btn(editor.isActive("highlight"))}
            onClick={() => editor.chain().focus().toggleHighlight({ color: "#fde68a" }).run()}
            title="Highlight"
          >
            <Highlighter className="w-4 h-4" />
          </button>
          <button
            className={btn(editor.isActive("superscript"))}
            onClick={() => editor.chain().focus().toggleSuperscript().run()}
            title="Superscript"
          >
            <SupIcon className="w-4 h-4" />
          </button>
          <button
            className={btn(editor.isActive("subscript"))}
            onClick={() => editor.chain().focus().toggleSubscript().run()}
            title="Subscript"
          >
            <SubIcon className="w-4 h-4" />
          </button>
          <label
            className="h-8 w-8 inline-flex items-center justify-center rounded-md hover:bg-muted cursor-pointer"
            title="Text color"
          >
            <span
              className="w-4 h-4 rounded-full border border-border"
              style={{ background: editor.getAttributes("textStyle")["color"] || "currentColor" }}
            />
            <input
              type="color"
              className="sr-only"
              onChange={(e) => editor.chain().focus().setColor(e.target.value).run()}
            />
          </label>
          <button
            className={btn(false)}
            onClick={() => editor.chain().focus().unsetAllMarks().clearNodes().run()}
            title="Clear formatting"
          >
            <Eraser className="w-4 h-4" />
          </button>

          <span className="w-px h-6 bg-border mx-1" />
          <button
            className={btn(editor.isActive({ textAlign: "left" }))}
            onClick={() => editor.chain().focus().setTextAlign("left").run()}
            title="Align left"
          >
            <AlignLeft className="w-4 h-4" />
          </button>
          <button
            className={btn(editor.isActive({ textAlign: "center" }))}
            onClick={() => editor.chain().focus().setTextAlign("center").run()}
            title="Align center"
          >
            <AlignCenter className="w-4 h-4" />
          </button>
          <button
            className={btn(editor.isActive({ textAlign: "right" }))}
            onClick={() => editor.chain().focus().setTextAlign("right").run()}
            title="Align right"
          >
            <AlignRight className="w-4 h-4" />
          </button>

          <span className="w-px h-6 bg-border mx-1" />
          <button
            className={btn(editor.isActive("bulletList"))}
            onClick={() => editor.chain().focus().toggleBulletList().run()}
            title="Bullet list"
          >
            <List className="w-4 h-4" />
          </button>
          <button
            className={btn(editor.isActive("orderedList"))}
            onClick={() => editor.chain().focus().toggleOrderedList().run()}
            title="Numbered list"
          >
            <ListOrdered className="w-4 h-4" />
          </button>
          <button
            className={btn(editor.isActive("taskList"))}
            onClick={() => editor.chain().focus().toggleTaskList().run()}
            title="Task list"
          >
            <ListChecks className="w-4 h-4" />
          </button>
          <button
            className={btn(false)}
            onClick={() => editor.chain().focus().sinkListItem("listItem").run()}
            title="Indent"
          >
            <Indent className="w-4 h-4" />
          </button>
          <button
            className={btn(false)}
            onClick={() => editor.chain().focus().liftListItem("listItem").run()}
            title="Outdent"
          >
            <Outdent className="w-4 h-4" />
          </button>
          <button
            className={btn(editor.isActive("blockquote"))}
            onClick={() => editor.chain().focus().toggleBlockquote().run()}
            title="Blockquote"
          >
            <Quote className="w-4 h-4" />
          </button>
          <button
            className={btn(editor.isActive("pullQuote"))}
            onClick={() => editor.chain().focus().togglePullQuote().run()}
            title="Pull quote"
          >
            <MessageSquareQuote className="w-4 h-4" />
          </button>
          <button
            className={btn(false)}
            onClick={() => editor.chain().focus().setHorizontalRule().run()}
            title="Divider"
          >
            <Minus className="w-4 h-4" />
          </button>

          <span className="w-px h-6 bg-border mx-1" />
          <button
            className={btn(editor.isActive("link"))}
            onClick={() => {
              setUrlField(editor.getAttributes("link")["href"] ?? "");
              setDialog("link");
            }}
            title="Link"
          >
            <Link2 className="w-4 h-4" />
          </button>
          <button
            className={btn(false)}
            onClick={() => editor.chain().focus().extendMarkRange("link").unsetLink().run()}
            title="Remove link"
          >
            <Link2Off className="w-4 h-4" />
          </button>
          <button
            className={btn(false)}
            onClick={() => {
              setUrlField("");
              setAltField("");
              setDialog("image");
            }}
            title="Image"
          >
            <ImageIcon className="w-4 h-4" />
          </button>
          <button
            className={btn(false)}
            onClick={() => {
              setUrlField("");
              setDialog("youtube");
            }}
            title="YouTube"
          >
            <YoutubeIcon className="w-4 h-4" />
          </button>
          <button
            className={btn(false)}
            onClick={() => attachInput.current?.click()}
            title="File attachment"
          >
            <Paperclip className="w-4 h-4" />
          </button>
          <button
            className={btn(editor.isActive("table"))}
            onClick={() =>
              editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()
            }
            title="Insert table"
          >
            <TableIcon className="w-4 h-4" />
          </button>
          <button
            className={btn(editor.isActive("codeBlock"))}
            onClick={() => editor.chain().focus().toggleCodeBlock().run()}
            title="Code block"
          >
            <Code2 className="w-4 h-4" />
          </button>
          <button
            className={btn(editor.isActive("callout"))}
            onClick={() => editor.chain().focus().toggleCallout("info").run()}
            title="Callout"
          >
            <Info className="w-4 h-4" />
          </button>
          <button
            className={btn(false)}
            onClick={() => editor.chain().focus().insertFaqItem().run()}
            title="FAQ block"
          >
            <HelpCircle className="w-4 h-4" />
          </button>
          <button
            className={btn(false)}
            onClick={() => editor.chain().focus().insertTableOfContents().run()}
            title="Table of contents"
          >
            <ListTree className="w-4 h-4" />
          </button>
        </div>

        {editor.isActive("table") ? (
          <div className="flex flex-wrap items-center gap-1 px-2 pb-2 text-xs">
            <span className="text-muted-foreground mr-1">Table:</span>
            <button
              className={btn(false)}
              onClick={() => editor.chain().focus().addRowAfter().run()}
            >
              <Rows className="w-3.5 h-3.5 mr-1" />
              Row
            </button>
            <button
              className={btn(false)}
              onClick={() => editor.chain().focus().addColumnAfter().run()}
            >
              <Columns className="w-3.5 h-3.5 mr-1" />
              Col
            </button>
            <button className={btn(false)} onClick={() => editor.chain().focus().deleteRow().run()}>
              Del row
            </button>
            <button
              className={btn(false)}
              onClick={() => editor.chain().focus().deleteColumn().run()}
            >
              Del col
            </button>
            <button
              className={btn(false)}
              onClick={() => editor.chain().focus().mergeOrSplit().run()}
            >
              Merge / split
            </button>
            <button
              className={btn(false)}
              onClick={() => editor.chain().focus().toggleHeaderRow().run()}
            >
              Header row
            </button>
            <button
              className={btn(false)}
              onClick={() => editor.chain().focus().deleteTable().run()}
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        ) : null}

        {editor.isActive("ctaBox") ? (
          <div className="flex flex-wrap items-center gap-1 px-2 pb-2 text-xs">
            <span className="text-muted-foreground mr-1">CTA button:</span>
            <button
              className={btn(false)}
              onClick={() => {
                const label = window.prompt("Button text", editor.getAttributes("ctaBox")["label"]);
                if (label) editor.chain().focus().updateAttributes("ctaBox", { label }).run();
              }}
            >
              Edit text
            </button>
            <button
              className={btn(false)}
              onClick={() => {
                const href = window.prompt("Button link", editor.getAttributes("ctaBox")["href"]);
                if (href) editor.chain().focus().updateAttributes("ctaBox", { href }).run();
              }}
            >
              Edit link
            </button>
          </div>
        ) : null}

        {editor.isActive("callout") ? (
          <div className="flex flex-wrap items-center gap-1 px-2 pb-2 text-xs">
            <span className="text-muted-foreground mr-1">Callout style:</span>
            {["info", "tip", "warning", "note", "didyouknow", "tldr", "quote"].map((v) => (
              <button
                key={v}
                className={btn(editor.isActive("callout", { variant: v }))}
                onClick={() =>
                  editor.chain().focus().updateAttributes("callout", { variant: v }).run()
                }
              >
                {v}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {/* Floating bubble toolbar */}
      <BubbleMenu
        editor={editor}
        className="flex items-center gap-1 rounded-lg border border-border bg-popover p-1 shadow-lg"
      >
        <button
          className={btn(editor.isActive("bold"))}
          onClick={() => editor.chain().focus().toggleBold().run()}
        >
          <Bold className="w-4 h-4" />
        </button>
        <button
          className={btn(editor.isActive("italic"))}
          onClick={() => editor.chain().focus().toggleItalic().run()}
        >
          <Italic className="w-4 h-4" />
        </button>
        <button
          className={btn(editor.isActive("underline"))}
          onClick={() => editor.chain().focus().toggleUnderline().run()}
        >
          <UnderlineIcon className="w-4 h-4" />
        </button>
        <button
          className={btn(editor.isActive("highlight"))}
          onClick={() => editor.chain().focus().toggleHighlight({ color: "#fde68a" }).run()}
        >
          <Highlighter className="w-4 h-4" />
        </button>
        <button
          className={btn(editor.isActive("link"))}
          onClick={() => {
            setUrlField(editor.getAttributes("link")["href"] ?? "");
            setDialog("link");
          }}
        >
          <Link2 className="w-4 h-4" />
        </button>
        <button className={btn(false)} onClick={() => editor.chain().focus().unsetAllMarks().run()}>
          <Eraser className="w-4 h-4" />
        </button>
      </BubbleMenu>

      {/* Drag handle for block reordering */}
      <DragHandle editor={editor}>
        <div className="w-5 h-6 mr-1 rounded cursor-grab text-muted-foreground hover:bg-muted flex items-center justify-center select-none">
          ⠿
        </div>
      </DragHandle>

      <div className="px-4 py-8 sm:px-8">
        <div className="mx-auto w-full max-w-[760px]">
          <EditorContent editor={editor} />
        </div>
      </div>

      {/* Slash command menu */}
      {slash && slash.items.length > 0 ? (
        <div
          className="fixed z-50 w-72 max-h-72 overflow-auto rounded-lg border border-border bg-popover shadow-xl p-1"
          style={{
            top: (slash.rect?.top ?? 0) - window.scrollY + 6,
            left: (slash.rect?.left ?? 0) - window.scrollX,
          }}
        >
          {slash.items.map((item, i) => (
            <button
              key={item.title}
              onMouseDown={(e) => {
                e.preventDefault();
                slash.select(item);
              }}
              className={`w-full text-left rounded-md px-2 py-1.5 ${i === slash.index ? "bg-muted" : "hover:bg-muted/60"}`}
            >
              <div className="text-sm text-foreground">{item.title}</div>
              <div className="text-[11px] text-muted-foreground">{item.hint}</div>
            </button>
          ))}
        </div>
      ) : null}

      <input
        ref={fileInput}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) void doUpload(f, "image");
        }}
      />
      <input
        ref={attachInput}
        type="file"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) void doUpload(f, "file");
        }}
      />

      <Dialog open={dialog === "image"} onOpenChange={(o) => !o && setDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Insert image</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Alt text (for SEO and accessibility)</Label>
              <Input
                value={altField}
                onChange={(e) => setAltField(e.target.value)}
                className="mt-1"
                placeholder="Describe the image"
              />
            </div>
            <Button
              variant="outline"
              className="w-full"
              disabled={uploading}
              onClick={() => fileInput.current?.click()}
            >
              {uploading ? "Uploading…" : "Upload from device"}
            </Button>
            <div className="text-xs text-muted-foreground text-center">or</div>
            <div>
              <Label className="text-xs">Image URL</Label>
              <Input
                value={urlField}
                onChange={(e) => setUrlField(e.target.value)}
                className="mt-1"
                placeholder="https://..."
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              onClick={() => {
                if (!urlField.trim()) return;
                editor.chain().focus().setImage({ src: urlField.trim(), alt: altField }).run();
                setDialog(null);
              }}
            >
              Insert URL
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={dialog === "youtube"} onOpenChange={(o) => !o && setDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Embed YouTube video</DialogTitle>
          </DialogHeader>
          <Input
            value={urlField}
            onChange={(e) => setUrlField(e.target.value)}
            placeholder="https://www.youtube.com/watch?v=..."
          />
          <DialogFooter>
            <Button
              onClick={() => {
                const src = urlField.trim();
                if (!src) return;
                editor.commands.setYoutubeVideo({ src, width: 800, height: 450 });
                setDialog(null);
              }}
            >
              Embed
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={dialog === "link"} onOpenChange={(o) => !o && setDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Link</DialogTitle>
          </DialogHeader>
          <Input
            value={urlField}
            onChange={(e) => setUrlField(e.target.value)}
            placeholder="https://... (leave empty to remove)"
          />
          <p className="text-xs text-muted-foreground">Links open in a new tab.</p>
          <DialogFooter>
            <Button onClick={applyLink}>Apply</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export type { Editor };
