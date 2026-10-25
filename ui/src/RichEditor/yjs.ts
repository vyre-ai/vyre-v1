// The Yjs side of the RichEditor (spec 2.16, ARCH 5.6 and R6). The document is a Y.XmlFragment named "default", the layout y-prosemirror and
// TipTap's Collaboration extension read and write, so the web editor, the WebView editor and these helpers all see one document.
// blocksToFragment and fragmentToBlocks are how markdown goes in and out; connectDocs and the awareness helpers are how two editors converge
// and how a cursor is shown; nothing here needs a DOM.

import * as Y from "yjs";
import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate, removeAwarenessStates } from "y-protocols/awareness";
import { mergeRuns, parseMarkdown, renderMarkdown } from "./markdown.ts";
import type { Block, Mark, Run } from "./markdown.ts";

export { Awareness, Y };

/** TipTap Collaboration's default fragment name. */
export const FRAGMENT = "default";

type Attrs = Record<string, unknown>;
type Node = Y.XmlElement | Y.XmlText | Y.XmlHook;

/* ---------- blocks to fragment ---------- */

function markAttrs(run: Run): Attrs {
  const attrs: Attrs = {};
  for (const m of run.marks) attrs[m] = m === "link" ? { href: run.href ?? "", target: "_blank", rel: "noopener noreferrer nofollow", class: null } : {};
  return attrs;
}

function textNode(runs: readonly Run[]): Y.XmlText {
  const text = new Y.XmlText();
  let at = 0;
  for (const run of mergeRuns(runs)) {
    text.insert(at, run.text, markAttrs(run));
    at += run.text.length;
  }
  return text;
}

function paragraph(runs: readonly Run[]): Y.XmlElement {
  const p = new Y.XmlElement("paragraph");
  p.insert(0, [textNode(runs)]);
  return p;
}

function listOf(name: string, items: readonly (readonly Run[])[], attrs: Attrs): Y.XmlElement {
  const list = new Y.XmlElement(name);
  for (const [k, v] of Object.entries(attrs)) list.setAttribute(k, v as string);
  const kids: Y.XmlElement[] = [];
  for (const item of items) {
    const li = new Y.XmlElement("listItem");
    li.insert(0, [paragraph(item)]);
    kids.push(li);
  }
  list.insert(0, kids);
  return list;
}

function blockNode(b: Block): Y.XmlElement {
  switch (b.type) {
    case "paragraph": return paragraph(b.runs);
    case "heading": {
      const h = new Y.XmlElement("heading");
      h.setAttribute("level", b.level as unknown as string);
      h.insert(0, [textNode(b.runs)]);
      return h;
    }
    case "bulletList": return listOf("bulletList", b.items, {});
    case "orderedList": return listOf("orderedList", b.items, { start: 1 });
    case "blockquote": {
      const q = new Y.XmlElement("blockquote");
      q.insert(0, [paragraph(b.runs)]);
      return q;
    }
    case "codeBlock": {
      const c = new Y.XmlElement("codeBlock");
      if (b.lang !== "") c.setAttribute("language", b.lang);
      const t = new Y.XmlText();
      t.insert(0, b.text);
      c.insert(0, [t]);
      return c;
    }
    case "horizontalRule": return new Y.XmlElement("horizontalRule");
    default: return paragraph([]);
  }
}

/** Replaces the document's content with these blocks, in one transaction. */
export function blocksToFragment(doc: Y.Doc, blocks: readonly Block[], origin: unknown = "import", field: string = FRAGMENT): void {
  const fragment = doc.getXmlFragment(field);
  doc.transact(() => {
    if (fragment.length > 0) fragment.delete(0, fragment.length);
    const nodes: Y.XmlElement[] = [];
    for (const b of blocks) nodes.push(blockNode(b));
    if (nodes.length > 0) fragment.insert(0, nodes);
  }, origin);
}

/* ---------- fragment to blocks ---------- */

function runsOf(node: Node | undefined): Run[] {
  if (node === undefined || !(node instanceof Y.XmlText)) return [];
  const runs: Run[] = [];
  for (const piece of node.toDelta() as { insert: unknown; attributes?: Attrs }[]) {
    if (typeof piece.insert !== "string") continue;
    const marks: Mark[] = [];
    let href: string | undefined;
    for (const [k, v] of Object.entries(piece.attributes ?? {})) {
      if (k === "bold" || k === "italic" || k === "strike" || k === "code" || k === "link") {
        marks.push(k);
        if (k === "link" && v !== null && typeof v === "object" && typeof (v as { href?: unknown }).href === "string") href = (v as { href: string }).href;
      }
    }
    runs.push({ text: piece.insert, marks, ...(href === undefined ? {} : { href }) });
  }
  return mergeRuns(runs);
}

function kidsOf(el: Y.XmlElement): Node[] {
  return el.toArray() as Node[];
}

function textRunsOf(el: Y.XmlElement): Run[] {
  const out: Run[] = [];
  for (const [n, k] of kidsOf(el).entries()) {
    const part = k instanceof Y.XmlElement ? textRunsOf(k) : runsOf(k);
    if (n > 0 && part.length > 0 && out.length > 0) out.push({ text: "\n", marks: [] });
    out.push(...part);
  }
  return mergeRuns(out);
}

function itemsOf(el: Y.XmlElement): Run[][] {
  const items: Run[][] = [];
  for (const li of kidsOf(el)) if (li instanceof Y.XmlElement) items.push(textRunsOf(li));
  return items;
}

/** The blocks of the document as it is now. Unknown node types read as paragraphs of their text. */
export function fragmentToBlocks(doc: Y.Doc, field: string = FRAGMENT): Block[] {
  const blocks: Block[] = [];
  for (const node of doc.getXmlFragment(field).toArray() as Node[]) {
    if (node instanceof Y.XmlText) { blocks.push({ type: "paragraph", runs: runsOf(node) }); continue; }
    if (!(node instanceof Y.XmlElement)) continue;
    switch (node.nodeName) {
      case "heading": {
        const level = Number(node.getAttribute("level") ?? 1);
        blocks.push({ type: "heading", level: (level >= 1 && level <= 6 ? level : 1) as 1 | 2 | 3 | 4 | 5 | 6, runs: runsOf(kidsOf(node)[0]) });
        break;
      }
      case "bulletList": blocks.push({ type: "bulletList", items: itemsOf(node) }); break;
      case "orderedList": blocks.push({ type: "orderedList", items: itemsOf(node) }); break;
      case "blockquote": blocks.push({ type: "blockquote", runs: textRunsOf(node) }); break;
      case "codeBlock": {
        const t = kidsOf(node)[0];
        blocks.push({ type: "codeBlock", lang: String(node.getAttribute("language") ?? ""), text: t instanceof Y.XmlText ? t.toString() : "" });
        break;
      }
      case "horizontalRule": blocks.push({ type: "horizontalRule" }); break;
      default: blocks.push({ type: "paragraph", runs: textRunsOf(node) });
    }
  }
  return blocks;
}

/** Markdown in: replaces the content. */
export function importMarkdown(doc: Y.Doc, md: string, origin: unknown = "import"): void {
  blocksToFragment(doc, parseMarkdown(md), origin);
}

/** Markdown out: the snapshot for search and for the file on disk. */
export function exportMarkdown(doc: Y.Doc): string {
  return renderMarkdown(fragmentToBlocks(doc));
}

/* ---------- convergence ---------- */

/** Two-way live link between two docs in the same process (tests, the WebView page's twin). Returns the unlink function. */
export function connectDocs(a: Y.Doc, b: Y.Doc): () => void {
  const link = {};
  const toB = (update: Uint8Array, origin: unknown): void => { if (origin !== link) Y.applyUpdate(b, update, link); };
  const toA = (update: Uint8Array, origin: unknown): void => { if (origin !== link) Y.applyUpdate(a, update, link); };
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a), link);
  Y.applyUpdate(a, Y.encodeStateAsUpdate(b), link);
  a.on("update", toB);
  b.on("update", toA);
  return () => { a.off("update", toB); b.off("update", toA); };
}

/* ---------- cursors ---------- */

export interface CursorUser {
  name: string;
  color: string;
}

export interface RemoteCursor extends CursorUser {
  clientId: number;
  /** Character offsets in the plain text of the document, when the cursor is known. */
  anchor: number | null;
  head: number | null;
}

/** Announces who this editor is and where its cursor sits. */
export function setLocalCursor(awareness: Awareness, user: CursorUser, anchor: number | null, head: number | null = anchor): void {
  awareness.setLocalState({ user: { name: user.name, color: user.color }, cursor: anchor === null ? null : { anchor, head } });
}

/** Everyone else's cursors, in client id order. */
export function remoteCursors(awareness: Awareness): RemoteCursor[] {
  const out: RemoteCursor[] = [];
  for (const [clientId, state] of awareness.getStates()) {
    if (clientId === awareness.clientID) continue;
    const s = state as { user?: Partial<CursorUser>; cursor?: { anchor?: number; head?: number } | null };
    if (s.user === undefined || typeof s.user.name !== "string") continue;
    out.push({ clientId, name: s.user.name, color: typeof s.user.color === "string" ? s.user.color : "#888888", anchor: s.cursor?.anchor ?? null, head: s.cursor?.head ?? s.cursor?.anchor ?? null });
  }
  return out.sort((x, y) => x.clientId - y.clientId);
}

/** Carries awareness from one editor to another, as the sync module would over the wire. */
export function sendAwareness(from: Awareness, to: Awareness): void {
  applyAwarenessUpdate(to, encodeAwarenessUpdate(from, [from.clientID]), "remote");
}

/** A leaving editor drops its cursor everywhere. */
export function dropAwareness(awareness: Awareness, clientIds: number[]): void {
  removeAwarenessStates(awareness, clientIds, "leave");
}
