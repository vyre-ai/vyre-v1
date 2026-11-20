// The TipTap parts of a Vyre document page: the field chip, the two tracked-change marks, and the plugin that turns a person's edits into suggestions while the page is in Suggesting mode.
// markdownExtensions adds these only for a page that asks (`doc`), so every other Markdown editor is as it was.
import { Extension, InputRule, Mark, Node, mergeAttributes } from "@tiptap/core";
import type { Extensions } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { chipLook } from "./fields.ts";
import type { FieldResolver } from "./fields.ts";
import { trackTransaction } from "./track.ts";

/** What a document page is told by its host. All of it is read when it is needed, so a change (another record, Suggesting switched on) shows at once with no new editor. */
export interface DocOptions {
  /** The record the page is read against: what each chip shows. Left out, chips show their field names. */
  resolve?: () => FieldResolver | undefined;
  /** Who is editing and whether their edits are suggestions. */
  suggesting?: () => { on: boolean; author: string } | undefined;
  /** The clock of a suggestion's time (ISO, to the second). Tests pass their own. */
  now?: () => string;
}

const CHIP_TYPED = /\{(\s*[A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)*\s*|(?:sign|date):[A-Za-z0-9_]+)\}$/;

export const isoNow = (): string => new Date().toISOString().replace(/\.\d{3}Z$/, "Z");

/** A blank of the template, drawn as a chip. Stored as `{tag}`, so the fill engine reads exactly what the page shows. An atom: the caret steps over it and Backspace takes it whole. */
export const FieldChip = Node.create<{ opts: DocOptions }, { views: Set<() => void>; refresh: () => void }>({
  name: "fieldChip",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  draggable: true,
  addOptions() {
    return { opts: {} };
  },
  addStorage() {
    const views = new Set<() => void>();
    return {
      views,
      /** Draw every chip again (the record changed). */
      refresh: () => views.forEach((f) => f()),
    };
  },
  addAttributes() {
    return { raw: { default: "" } };
  },
  parseHTML() {
    return [
      { tag: "span[data-field]", getAttrs: (el) => ({ raw: (el as HTMLElement).getAttribute("data-field") ?? "" }) },
    ];
  },
  renderHTML({ node, HTMLAttributes }) {
    const look = chipLook(String(node.attrs["raw"]));
    return [
      "span",
      mergeAttributes(HTMLAttributes, {
        "data-field": String(node.attrs["raw"]),
        class: `vyre-chip vyre-chip-${look.state}`,
      }),
      look.text,
    ];
  },
  addInputRules() {
    const type = this.type;
    return [
      new InputRule({
        find: CHIP_TYPED,
        handler: ({ state, range, match }) => {
          state.tr.replaceWith(range.from, range.to, type.create({ raw: match[1] ?? "" }));
        },
      }),
    ];
  },
  addNodeView() {
    const views = this.storage.views;
    const opts = this.options.opts;
    return ({ node }) => {
      let raw = String(node.attrs["raw"] ?? "");
      const dom = document.createElement("span");
      dom.setAttribute("contenteditable", "false");
      dom.setAttribute("data-testid", "field-chip");
      const draw = (): void => {
        const look = chipLook(raw, opts.resolve?.());
        dom.className = `vyre-chip vyre-chip-${look.state}`;
        dom.setAttribute("data-field", raw);
        dom.setAttribute("data-state", look.state);
        dom.title = look.title;
        dom.textContent = look.text;
      };
      draw();
      views.add(draw);
      return {
        dom,
        update: (n) => {
          if (n.type.name !== "fieldChip") return false;
          raw = String(n.attrs["raw"] ?? "");
          draw();
          return true;
        },
        destroy: () => {
          views.delete(draw);
        },
      };
    };
  },
});

const sgAttrs = {
  author: { default: "" },
  at: { default: "" },
  sub: { default: false },
};
const sgHtml = (kind: "add" | "del", attrs: Record<string, unknown>): Record<string, string> => ({
  class: `vyre-sg vyre-sg-${kind}`,
  "data-sg": kind,
  "data-author": String(attrs["author"] ?? ""),
  "data-at": String(attrs["at"] ?? ""),
  ...(attrs["sub"] === true ? { "data-sub": "1" } : {}),
});

/** Text a person or an agent added while suggesting. */
export const SuggestAdd = Mark.create({
  name: "suggestAdd",
  inclusive: false,
  excludes: "suggestAdd suggestDel",
  addAttributes: () => sgAttrs,
  parseHTML: () => [
    {
      tag: "ins[data-sg]",
      getAttrs: (el) => {
        const e = el as HTMLElement;
        return {
          author: e.getAttribute("data-author") ?? "",
          at: e.getAttribute("data-at") ?? "",
          sub: e.hasAttribute("data-sub"),
        };
      },
    },
  ],
  renderHTML: ({ mark }) => ["ins", sgHtml("add", mark.attrs), 0],
});

/** Text a person or an agent marked for removal while suggesting. It stays on the page, struck through, until someone accepts or rejects it. */
export const SuggestDel = Mark.create({
  name: "suggestDel",
  inclusive: false,
  excludes: "suggestAdd suggestDel",
  addAttributes: () => sgAttrs,
  parseHTML: () => [
    {
      tag: "del[data-sg]",
      getAttrs: (el) => {
        const e = el as HTMLElement;
        return {
          author: e.getAttribute("data-author") ?? "",
          at: e.getAttribute("data-at") ?? "",
          sub: e.hasAttribute("data-sub"),
        };
      },
    },
  ],
  renderHTML: ({ mark }) => ["del", sgHtml("del", mark.attrs), 0],
});

export const suggestingKey = new PluginKey("vyreSuggesting");

/** In Suggesting mode an edit does not change the text: what is typed is added as a suggestion, what is deleted stays, struck through. Anything else (undo, an agent's merge, Accept and Reject) is left as it is. */
export const Suggesting = Extension.create<{ opts: DocOptions }>({
  name: "vyreSuggesting",
  addOptions() {
    return { opts: {} };
  },
  addProseMirrorPlugins() {
    const opts = this.options.opts;
    return [
      new Plugin({
        key: suggestingKey,
        appendTransaction: (trs, before, after) => {
          const s = opts.suggesting?.();
          if (!s || !s.on || trs.length !== 1) return null;
          return trackTransaction(trs[0] as never, before, after, { author: s.author, now: opts.now ?? isoNow });
        },
      }),
    ];
  },
});

/** The extensions of a document page. */
export function docExtensions(opts: DocOptions): Extensions {
  return [FieldChip.configure({ opts }), SuggestAdd, SuggestDel, Suggesting.configure({ opts })];
}
