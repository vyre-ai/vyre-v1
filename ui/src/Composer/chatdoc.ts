// The chat field's document, pure: the composer keeps its text as a string (mentions are the plain words "@Aliza") and its cursor as a character offset; the field draws that text with each mention as one
// atomic chip. These functions turn the string and the mention ranges into the field's document and back, and map a character offset to a position in the document and back, so the composer's
// logic (triggers, popups, tokens, the send payload) is the same with the new field as with the old one. No DOM here; a test drives them.

export interface ChatRange { start: number; end: number; kind: string }
export interface ChatNode { type: string; attrs?: Record<string, unknown>; content?: ChatNode[]; text?: string }

const textNode = (text: string): ChatNode => ({ type: "text", text });

/** The text as one paragraph: plain text, a hard break for each newline, and a chip for each range. Ranges are sorted and never overlap (tokenRanges). */
export function chatDoc(text: string, ranges: readonly ChatRange[]): ChatNode {
  const content: ChatNode[] = [];
  const plain = (s: string): void => {
    const parts = s.split("\n");
    parts.forEach((p, i) => { if (i > 0) content.push({ type: "hardBreak" }); if (p !== "") content.push(textNode(p)); });
  };
  let at = 0;
  for (const r of ranges) {
    if (r.start < at || r.end > text.length || r.end <= r.start) continue;
    plain(text.slice(at, r.start));
    content.push({ type: "chip", attrs: { text: text.slice(r.start, r.end), kind: r.kind } });
    at = r.end;
  }
  plain(text.slice(at));
  return { type: "doc", content: [{ type: "paragraph", content }] };
}

/** The text of the document: the inverse of chatDoc. */
export function chatText(doc: ChatNode): string {
  let out = "";
  const walk = (n: ChatNode): void => {
    if (n.type === "text") out += n.text ?? "";
    else if (n.type === "hardBreak") out += "\n";
    else if (n.type === "chip") out += String(n.attrs?.["text"] ?? "");
    else for (const c of n.content ?? []) walk(c);
  };
  walk(doc);
  return out;
}

const width = (n: ChatNode): number => (n.type === "text" ? (n.text ?? "").length : n.type === "hardBreak" ? 1 : n.type === "chip" ? String(n.attrs?.["text"] ?? "").length : 0);
/** The size of a node in document positions: a text is its length, an atom is 1. */
const size = (n: ChatNode): number => (n.type === "text" ? (n.text ?? "").length : 1);

/** The document position for a character offset in the text (inside the one paragraph, so positions start at 1). An offset inside a chip lands after it. */
export function offsetToPos(doc: ChatNode, offset: number): number {
  const kids = doc.content?.[0]?.content ?? [];
  let chars = 0;
  let pos = 1;
  for (const k of kids) {
    const w = width(k);
    if (chars + w > offset) {
      if (k.type === "text") return pos + (offset - chars);
      return offset === chars ? pos : pos + size(k);
    }
    chars += w;
    pos += size(k);
  }
  return pos;
}

/** The character offset for a document position: the inverse of offsetToPos. */
export function posToOffset(doc: ChatNode, pos: number): number {
  const kids = doc.content?.[0]?.content ?? [];
  let chars = 0;
  let at = 1;
  for (const k of kids) {
    const s = size(k);
    if (pos < at + s) return k.type === "text" ? chars + (pos - at) : chars;
    chars += width(k);
    at += s;
  }
  return chars;
}

/** The pieces of pasted text as nodes: plain runs and hard breaks (a paste is plain text). */
export function pasteNodes(text: string): ChatNode[] {
  const out: ChatNode[] = [];
  text.replace(/\r\n?/g, "\n").split("\n").forEach((line, i) => { if (i > 0) out.push({ type: "hardBreak" }); if (line !== "") out.push(textNode(line)); });
  return out;
}

/** True when two documents are the same words and chips in the same places, so the field leaves what it holds alone. */
export function sameDoc(a: ChatNode, b: ChatNode): boolean {
  return JSON.stringify(a.content?.[0]?.content ?? []) === JSON.stringify(b.content?.[0]?.content ?? []);
}
