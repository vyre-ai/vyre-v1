// The Markdown projection of a document (ARCH 5.6). A note keeps its text in the Y.Text "body" (Markdown source). The rich editor keeps a ProseMirror tree in the Y.XmlFragment "content".
// Compaction writes this text beside the snapshot so search, agents and memory read plain text and never have to open the CRDT. The projection holds no author data.
import * as Y from "yjs";

export const BODY = "body";
export const CONTENT = "content";

/** A document with both roots declared, so a fresh Y.Doc reads the same on every device. */
export function newDoc(): Y.Doc {
  const d = new Y.Doc();
  d.getText(BODY);
  d.getXmlFragment(CONTENT);
  return d;
}

type Attrs = Record<string, unknown>;

function mark(text: string, a: Attrs | undefined): string {
  if (!a) return text;
  let out = text;
  if (a["code"]) out = `\`${out}\``;
  if (a["bold"] || a["strong"]) out = `**${out}**`;
  if (a["italic"] || a["em"]) out = `*${out}*`;
  const link = a["link"];
  if (link && typeof link === "object" && typeof (link as { href?: unknown }).href === "string") out = `[${out}](${(link as { href: string }).href})`;
  return out;
}

function inline(node: Y.XmlElement | Y.XmlFragment | Y.XmlText): string {
  if (node instanceof Y.XmlText) {
    return (node.toDelta() as { insert?: unknown; attributes?: Attrs }[]).map((d) => (typeof d.insert === "string" ? mark(d.insert, d.attributes) : "")).join("");
  }
  let out = "";
  for (const child of node.toArray()) {
    if (child instanceof Y.XmlText) out += inline(child);
    else if (child instanceof Y.XmlElement) out += child.nodeName === "hardBreak" ? "\n" : inline(child);
  }
  return out;
}

function block(node: Y.XmlElement | Y.XmlText, prefix: string, depth: number): string {
  if (node instanceof Y.XmlText) return `${prefix}${inline(node)}\n\n`;
  const name = node.nodeName;
  const kids = node.toArray().filter((c): c is Y.XmlElement | Y.XmlText => c instanceof Y.XmlElement || c instanceof Y.XmlText);
  if (name === "heading") {
    const level = Math.min(6, Math.max(1, Number(node.getAttribute("level") ?? 1) || 1));
    return `${prefix}${"#".repeat(level)} ${inline(node)}\n\n`;
  }
  if (name === "paragraph") return `${prefix}${inline(node)}\n\n`;
  if (name === "codeBlock") return `${prefix}\`\`\`${String(node.getAttribute("language") ?? "")}\n${inline(node)}\n\`\`\`\n\n`;
  if (name === "blockquote") return kids.map((k) => block(k, `${prefix}> `, depth)).join("");
  if (name === "bulletList" || name === "orderedList") {
    const items = kids.map((li, i) => {
      const lead = name === "bulletList" ? "- " : `${i + 1}. `;
      const inner = li instanceof Y.XmlElement ? li.toArray().filter((c): c is Y.XmlElement => c instanceof Y.XmlElement) : [];
      const [first, ...rest] = inner;
      const head = first ? inline(first) : "";
      const nested = rest.map((r) => block(r, "  ".repeat(depth + 1), depth + 1).replace(/\n+$/, "\n")).join("");
      return `${"  ".repeat(depth)}${lead}${head}\n${nested}`;
    });
    return `${prefix}${items.join(`${prefix}`)}\n`;
  }
  if (name === "horizontalRule") return `${prefix}---\n\n`;
  return kids.map((k) => block(k, prefix, depth)).join("");
}

function fragmentToMarkdown(f: Y.XmlFragment): string {
  let out = "";
  for (const child of f.toArray()) if (child instanceof Y.XmlElement || child instanceof Y.XmlText) out += block(child, "", 0);
  return out.replace(/\n{3,}/g, "\n\n").trim();
}

/** The text a search index, an agent or a history list sees. */
export function toMarkdown(doc: Y.Doc): string {
  const body = doc.getText(BODY).toString();
  if (body.length > 0) return body;
  return fragmentToMarkdown(doc.getXmlFragment(CONTENT));
}
