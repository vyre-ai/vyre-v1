// The TipTap extensions of the one Markdown editor: the starter kit plus what Markdown files need (links, checklists, a raw block for what the editor has no block for)
// and the few attributes that let a file come back as it was written (see mdtree.ts). No DOM is touched here until an editor mounts, so a test can build the schema.
import { Extension, Mark, Node, mergeAttributes, nodeInputRule, wrappingInputRule } from "@tiptap/core";
import type { Extensions } from "@tiptap/core";
import Blockquote from "@tiptap/extension-blockquote";
import Bold from "@tiptap/extension-bold";
import BulletList from "@tiptap/extension-bullet-list";
import Code from "@tiptap/extension-code";
import CodeBlock from "@tiptap/extension-code-block";
import Document from "@tiptap/extension-document";
import Dropcursor from "@tiptap/extension-dropcursor";
import Gapcursor from "@tiptap/extension-gapcursor";
import HardBreak from "@tiptap/extension-hard-break";
import Heading from "@tiptap/extension-heading";
import History from "@tiptap/extension-history";
import Italic from "@tiptap/extension-italic";
import ListItem from "@tiptap/extension-list-item";
import OrderedList from "@tiptap/extension-ordered-list";
import Paragraph from "@tiptap/extension-paragraph";
import Strike from "@tiptap/extension-strike";
import Text from "@tiptap/extension-text";

// The starter kit is not used: the lockfile resolves its extensions to 2.27.3 while @tiptap/core is pinned at 2.11.5, and the horizontal rule of 2.27.3 imports a name 2.11.5 does not export.
// Each extension below loads against core 2.11.5; the divider is written here.
export const Divider = Node.create({
  name: "horizontalRule",
  group: "block",
  parseHTML() { return [{ tag: "hr" }]; },
  renderHTML({ HTMLAttributes }) { return ["hr", mergeAttributes(HTMLAttributes)]; },
  addCommands() { return { setHorizontalRule: () => ({ commands }) => commands.insertContent({ type: this.name }) }; },
  addInputRules() { return [nodeInputRule({ find: /^(?:---|___)\s$/, type: this.type })]; },
});

/** Whether a blank line came before the block, and the other small facts a block keeps from the file. None is drawn. */
const Keeps = Extension.create({
  name: "mdKeeps",
  addGlobalAttributes() {
    const quiet = (v: unknown) => ({ default: v, rendered: false });
    return [
      { types: ["paragraph", "heading", "bulletList", "orderedList", "taskList", "blockquote", "codeBlock", "horizontalRule", "rawBlock", "liveBlock"], attributes: { tight: quiet(false), blockId: { default: null, rendered: false, keepOnSplit: false } } },
      { types: ["bulletList", "orderedList", "taskList"], attributes: { marker: quiet("-"), delim: quiet(".") } },
      { types: ["listItem", "taskItem"], attributes: { gap: quiet(false) } },
      { types: ["codeBlock"], attributes: { fence: quiet("```") } },
      { types: ["horizontalRule"], attributes: { mark: quiet("---") } },
    ];
  },
});

/** Shortcuts the page's buttons promise that the extensions do not carry: strike on Cmd+Shift+X, a quote on Cmd+Shift+period, a checklist on Cmd+Shift+9. */
const Shortcuts = Extension.create({
  name: "mdShortcuts",
  addKeyboardShortcuts() {
    return {
      "Mod-Shift-x": () => this.editor.commands.toggleStrike(),
      "Mod-Shift-.": () => this.editor.commands.toggleBlockquote(),
      "Mod-Shift-9": () => this.editor.commands.toggleList("taskList", "taskItem"),
    };
  },
});

/** What a host's live block view is told and can do. `update` merges into the block's attributes (type, spec, view); `remove` deletes the block. */
export interface LiveBlockApi { update(patch: { type?: string; spec?: unknown; view?: string }): void; remove(): void }
export interface LiveBlockView { update(attrs: LiveBlockAttrsLike, readOnly: boolean): void; destroy(): void }
export interface LiveBlockAttrsLike { blockId: string | null; type: string; spec: unknown; view: string }
/** Draws a live block into `el` (the host renders its own view there) and says how to update and tear it down. */
export type LiveBlockRenderer = (el: HTMLElement, attrs: LiveBlockAttrsLike, readOnly: boolean, api: LiveBlockApi) => LiveBlockView;

export interface MarkdownExtensionOptions {
  /** How a live block is drawn. Without it a live block shows its type and view as a quiet line. */
  liveBlock?: LiveBlockRenderer;
  /** Cmd+K: the editor opens its link field. */
  onLink?: () => void;
}

export const Link = Mark.create<MarkdownExtensionOptions>({
  name: "link",
  inclusive: false,
  addOptions() { return {}; },
  addKeyboardShortcuts() { return { "Mod-k": () => { if (this.options.onLink === undefined) return false; this.options.onLink(); return true; } }; },
  addAttributes() { return { href: { default: "" }, title: { default: null } }; },
  parseHTML() { return [{ tag: "a[href]" }]; },
  renderHTML({ HTMLAttributes }) { return ["a", mergeAttributes({ rel: "noopener noreferrer nofollow", target: "_blank" }, HTMLAttributes), 0]; },
});

export const TaskList = Node.create({
  name: "taskList",
  group: "block list",
  content: "taskItem+",
  parseHTML() { return [{ tag: 'ul[data-type="taskList"]' }]; },
  renderHTML({ HTMLAttributes }) { return ["ul", mergeAttributes(HTMLAttributes, { "data-type": "taskList" }), 0]; },
});

export const TaskItem = Node.create({
  name: "taskItem",
  content: "paragraph block*",
  defining: true,
  addAttributes() {
    return { checked: { default: false, parseHTML: (el: HTMLElement) => el.getAttribute("data-checked") === "true", renderHTML: (a: { checked?: boolean }) => ({ "data-checked": a.checked === true ? "true" : "false" }) } };
  },
  parseHTML() { return [{ tag: 'li[data-type="taskItem"]' }]; },
  addKeyboardShortcuts() {
    return {
      Enter: () => this.editor.commands.splitListItem(this.name),
      Tab: () => this.editor.commands.sinkListItem(this.name),
      "Shift-Tab": () => this.editor.commands.liftListItem(this.name),
    };
  },
  addInputRules() {
    return [wrappingInputRule({ find: /^\s*(\[([( |x])?\])\s$/, type: this.type, getAttributes: (m) => ({ checked: m[m.length - 1] === "x" }) })];
  },
  renderHTML({ node, HTMLAttributes }) {
    return ["li", mergeAttributes(HTMLAttributes, { "data-type": "taskItem" }), ["label", { contenteditable: "false" }, ["input", { type: "checkbox", ...(node.attrs["checked"] === true ? { checked: "checked" } : {}) }]], ["div", 0]];
  },
  addNodeView() {
    return ({ node, getPos, editor }) => {
      const li = document.createElement("li");
      li.setAttribute("data-type", "taskItem");
      li.setAttribute("data-checked", node.attrs["checked"] === true ? "true" : "false");
      const label = document.createElement("label");
      label.contentEditable = "false";
      const box = document.createElement("input");
      box.type = "checkbox";
      box.checked = node.attrs["checked"] === true;
      box.addEventListener("change", () => {
        if (!editor.isEditable) { box.checked = !box.checked; return; }
        const at = typeof getPos === "function" ? getPos() : undefined;
        if (at === undefined) return;
        editor.view.dispatch(editor.view.state.tr.setNodeMarkup(at, undefined, { ...node.attrs, checked: box.checked }));
      });
      label.appendChild(box);
      const body = document.createElement("div");
      li.append(label, body);
      return {
        dom: li,
        contentDOM: body,
        update: (n) => {
          if (n.type !== node.type) return false;
          li.setAttribute("data-checked", n.attrs["checked"] === true ? "true" : "false");
          box.checked = n.attrs["checked"] === true;
          return true;
        },
      };
    };
  },
});

/** A table, HTML, front matter or a link reference: the editor has no block for it, so it is kept as written and shown in mono. */
export const RawBlock = Node.create({
  name: "rawBlock",
  group: "block",
  content: "text*",
  marks: "",
  code: true,
  defining: true,
  isolating: true,
  addAttributes() { return { kind: { default: "other", parseHTML: (el: HTMLElement) => el.getAttribute("data-raw") ?? "other", renderHTML: (a: { kind?: string }) => ({ "data-raw": a.kind ?? "other" }) } }; },
  parseHTML() { return [{ tag: "pre[data-raw]", priority: 60 }]; },
  renderHTML({ HTMLAttributes }) { return ["pre", mergeAttributes(HTMLAttributes, { class: "vyre-raw" }), ["code", 0]]; },
});

/** A live block: one line in the file (:::live {json}), an atom in the page. Only the host's view edits it. */
export const LiveBlock = Node.create<{ render?: LiveBlockRenderer | undefined }>({
  name: "liveBlock",
  group: "block",
  atom: true,
  selectable: true,
  draggable: true,
  addOptions() { return {}; },
  addAttributes() {
    const keep = (d: unknown) => ({ default: d, rendered: false });
    return { type: keep(""), spec: keep(null), view: keep(""), json: keep(""), extra: keep({}), sig: keep("") };
  },
  parseHTML() { return [{ tag: "div[data-live]" }]; },
  renderHTML({ node }) { return ["div", { "data-live": String(node.attrs["type"]) }]; },
  addNodeView() {
    const render = this.options.render;
    return ({ node, editor, getPos }) => {
      const dom = document.createElement("div");
      dom.setAttribute("data-live", String(node.attrs["type"]));
      dom.setAttribute("contenteditable", "false");
      dom.setAttribute("data-testid", "live-block");
      const attrsOf = (n: typeof node): LiveBlockAttrsLike => ({ blockId: (n.attrs["blockId"] as string | null) ?? null, type: String(n.attrs["type"] ?? ""), spec: n.attrs["spec"], view: String(n.attrs["view"] ?? "") });
      const api: LiveBlockApi = {
        update: (patch) => { const at = typeof getPos === "function" ? getPos() : undefined; const cur = at === undefined ? null : editor.state.doc.nodeAt(at); if (at === undefined || cur === null) return; editor.view.dispatch(editor.state.tr.setNodeMarkup(at, undefined, { ...cur.attrs, ...patch })); },
        remove: () => { const at = typeof getPos === "function" ? getPos() : undefined; const cur = at === undefined ? null : editor.state.doc.nodeAt(at); if (at === undefined || cur === null) return; editor.view.dispatch(editor.state.tr.delete(at, at + cur.nodeSize)); },
      };
      if (!render) {
        dom.textContent = `${String(node.attrs["type"])} (${String(node.attrs["view"] || "list")})`;
        return { dom, update: (n) => n.type === node.type };
      }
      let current = node;
      const view = render(dom, attrsOf(node), !editor.isEditable, api);
      return {
        dom,
        stopEvent: () => true,
        ignoreMutation: () => true,
        update: (n) => { if (n.type !== current.type) return false; current = n; view.update(attrsOf(n), !editor.isEditable); return true; },
        destroy: () => view.destroy(),
      };
    };
  },
});

/** The extension list the Markdown editor mounts. History stays on: this is a single-author editor; collaboration is the Notes editor's job. */
export function markdownExtensions(options: MarkdownExtensionOptions = {}): Extensions {
  return [Document, Paragraph, Text, HardBreak, Heading, Bold, Italic, Strike, Code, BulletList, OrderedList, ListItem, Blockquote, CodeBlock, Divider, History, Dropcursor, Gapcursor, Keeps, Shortcuts, Link.configure(options), TaskList, TaskItem, RawBlock, LiveBlock.configure({ render: options.liveBlock })];
}
