// A small, faithful XML reader and writer for the parts of an Office file the viewer edits (word/document.xml, ppt/slides/slideN.xml). It keeps every attribute in order, every namespace declaration, comments,
// CDATA and processing instructions, so a part that is read and written back without a change is the same document. Nothing here knows Word or PowerPoint.

export interface XNode {
  /** The tag, with its prefix ("w:p"). */
  name: string;
  attrs: [string, string][];
  children: (XNode | string)[];
  /** True when the tag was written as <a/> (and has no children). */
  empty?: boolean;
}
/** A node written back as it was read: a comment, a CDATA section, a processing instruction. */
export interface XRaw {
  raw: string;
}
type Kid = XNode | string;

const ENT: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
export const unescapeXml = (s: string): string =>
  s.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (_m, e: string) =>
    e[0] === "#"
      ? String.fromCodePoint(e[1] === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10))
      : (ENT[e] ?? _m),
  );
export const escapeText = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\r/g, "&#13;");
export const escapeAttr = (s: string): string =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/"/g, "&quot;")
    .replace(/\t/g, "&#9;")
    .replace(/\n/g, "&#10;")
    .replace(/\r/g, "&#13;");

export interface XDoc {
  /** Everything before the root element (the XML declaration), written back as it was. */
  head: string;
  root: XNode;
  /** Anything after the root (a trailing newline). */
  tail: string;
}

/** Text kept as raw nodes: a comment, CDATA or a PI is stored as a node named "#raw" with the original text as its only child. */
const RAW = "#raw";

export function parseXml(src: string): XDoc {
  let i = 0;
  const rootStart = (() => {
    // skip the declaration, comments and a doctype before the root
    let j = 0;
    for (;;) {
      while (j < src.length && /\s/.test(src[j]!)) j++;
      if (src.startsWith("<?", j)) j = src.indexOf("?>", j) + 2;
      else if (src.startsWith("<!--", j)) j = src.indexOf("-->", j) + 3;
      else if (/^<!DOCTYPE/i.test(src.slice(j, j + 9)))
        throw new Error("This file declares entities of its own (a DOCTYPE), which are not read.");
      else return j;
    }
  })();
  const head = src.slice(0, rootStart);
  i = rootStart;
  function element(): XNode {
    // at "<"
    i++;
    let j = i;
    while (j < src.length && !/[\s/>]/.test(src[j]!)) j++;
    const node: XNode = { name: src.slice(i, j), attrs: [], children: [] };
    i = j;
    for (;;) {
      while (/\s/.test(src[i]!)) i++;
      if (src[i] === "/") {
        i += 2; // "/>"
        node.empty = true;
        return node;
      }
      if (src[i] === ">") {
        i++;
        break;
      }
      let k = i;
      while (src[k] !== "=" && !/\s/.test(src[k]!)) k++;
      const an = src.slice(i, k);
      while (src[k] !== '"' && src[k] !== "'") k++;
      const q = src[k]!;
      const e = src.indexOf(q, k + 1);
      node.attrs.push([an, unescapeXml(src.slice(k + 1, e))]);
      i = e + 1;
    }
    for (;;) {
      if (src.startsWith("</", i)) {
        i = src.indexOf(">", i) + 1;
        return node;
      }
      if (src[i] === "<") {
        if (src.startsWith("<!--", i)) {
          const e = src.indexOf("-->", i) + 3;
          node.children.push({ name: RAW, attrs: [], children: [src.slice(i, e)] });
          i = e;
        } else if (src.startsWith("<![CDATA[", i)) {
          const e = src.indexOf("]]>", i) + 3;
          node.children.push({ name: RAW, attrs: [], children: [src.slice(i, e)] });
          i = e;
        } else if (src.startsWith("<?", i)) {
          const e = src.indexOf("?>", i) + 2;
          node.children.push({ name: RAW, attrs: [], children: [src.slice(i, e)] });
          i = e;
        } else node.children.push(element());
      } else {
        const e = src.indexOf("<", i);
        node.children.push(unescapeXml(src.slice(i, e)));
        i = e;
      }
    }
  }
  const root = element();
  return { head, root, tail: src.slice(i) };
}

export function writeXml(doc: XDoc): string {
  const out: string[] = [doc.head];
  const w = (n: XNode): void => {
    if (n.name === RAW) {
      out.push(n.children[0] as string);
      return;
    }
    out.push(`<${n.name}`);
    for (const [k, v] of n.attrs) out.push(` ${k}="${escapeAttr(v)}"`);
    if (n.children.length === 0 && n.empty === true) {
      out.push("/>");
      return;
    }
    out.push(">");
    for (const c of n.children) typeof c === "string" ? out.push(escapeText(c)) : w(c);
    out.push(`</${n.name}>`);
  };
  w(doc.root);
  out.push(doc.tail);
  return out.join("");
}

export const isNode = (k: Kid | undefined): k is XNode => typeof k === "object" && k !== null && k.name !== RAW;
export const kids = (n: XNode, name?: string): XNode[] =>
  n.children.filter((c): c is XNode => isNode(c) && (name === undefined || c.name === name));
export const kid = (n: XNode | undefined, name: string): XNode | undefined =>
  n?.children.find((c): c is XNode => isNode(c) && c.name === name);
export const attr = (n: XNode | undefined, name: string): string | undefined => n?.attrs.find(([k]) => k === name)?.[1];
export const setAttr = (n: XNode, name: string, value: string): void => {
  const a = n.attrs.find(([k]) => k === name);
  if (a) a[1] = value;
  else n.attrs.push([name, value]);
};
/** The text under a node: its own text children and its descendants', in order. */
export const textOf = (n: XNode): string =>
  n.children.map((c) => (typeof c === "string" ? c : isNode(c) ? textOf(c) : "")).join("");
export const el = (name: string, attrs: [string, string][] = [], children: Kid[] = []): XNode =>
  children.length === 0 ? { name, attrs, children, empty: true } : { name, attrs, children };
