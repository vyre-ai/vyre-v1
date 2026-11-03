// Files Viewer wiring (spec 3.5, 2.16): the pure mapping between the Files capabilities (files.viewer_data, files.comments.*, files.markup.*, files.save) and the shared Viewer's own shapes.
// A file's text becomes blocks or a sheet; a comment anchored to an area is a numbered pin on an image, a comment anchored to a passage is a comment on that quote. Nothing here calls a capability.
import type { CapMap } from "../../../../../../generated/types.ts";
import type { DocBlock, DocComment, MarkupBox, Sheet, Stroke, ViewerKind } from "../../../../../../ui/src/Viewer/index.tsx";
import { googleAppOf } from "../google.ts";

export type ViewerData = CapMap["files.viewer_data"]["out"];
export type FileComment = CapMap["files.comments.list"]["out"]["comments"][number];
export type FileKind = ViewerData["file"]["kind"];

/** The hash subject types that open a file here: the shell reads `subject=file:<id>` (P-APP_03) and hands the id to FileViewer. */
export const FILE_SUBJECT_TYPES: readonly string[] = ["file", "doc", "document"];

/** Which of the Viewer's layouts a file takes. A kind with no preview of its own gets the quiet "no preview" state. */
export function viewerKind(kind: FileKind): ViewerKind {
  switch (kind) {
    case "image": return "image";
    case "text": case "markdown": case "code": case "document": case "google_native": return "document";
    case "spreadsheet": return "csv";
    // a deck is read as its slides, one card each, in the document layout
    case "presentation": return "document";
    default: return "other";
  }
}

/**
 * The layout of a file, from what it holds. A Google-native file is shown from its export: a Sheet as a table, a Doc (and the words of a Slides deck) as a document, a Drawing as a
 * picture. With nothing to show (a Form, or Google could not be reached) it is the quiet "no preview" state with Open in Google beside it, never "This file is empty".
 */
export function viewerKindOf(d: { file: { kind: FileKind; mime: string; size?: number; source?: unknown }; text?: string | undefined; previewUrl?: string | undefined }): ViewerKind {
  // a file of a connected folder that is still an empty placeholder (its provider could not be reached when it opened) has nothing to show yet: Open in is the way to it
  if (d.file.source !== undefined && d.file.size === 0 && (d.text ?? "") === "" && d.previewUrl === undefined) return "other";
  // a Word or PowerPoint file with no words read from it (password-protected, damaged, an old .doc with no converter) is the quiet "no preview" line with Open in Word, never a blank page
  if (isOffice(d.file.kind) && (d.text ?? "").trim() === "") return "other";
  if (d.file.kind !== "google_native") return viewerKind(d.file.kind);
  const app = googleAppOf(d.file);
  const words = (d.text ?? "").trim() !== "";
  if (app === "gsheets" && words) return "csv";
  if (app === "gdrawings" && d.previewUrl) return "image";
  if (words) return "document";
  return d.previewUrl ? "image" : "other";
}

/**
 * A Google Doc's Markdown as the viewer draws it: Drive escapes punctuation ("1\. Scope"), and a table is rows of pipes with a rule under the header. The escapes go, a table row reads as
 * its cells, and the rule is dropped. Headings, lists and bold stay Markdown for textToBlocks.
 */
export function docsMarkdown(text: string): string {
  return text.split("\n")
    .filter((l) => !/^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/.test(l))
    .map((l) => (/^\s*\|.*\|\s*$/.test(l) ? l.trim().slice(1, -1).split("|").map((c) => c.trim()).filter((c) => c !== "").join(" \u00b7 ") : l))
    .map((l) => l.replace(/\\([\\`*_{}[\]()#+\-.!|<>~=])/g, "$1"))
    .join("\n");
}

/** A Word, PowerPoint or OpenDocument file: its words are read from the file, and it is edited in its own app, never by saving the words over it. */
export const isOffice = (kind: FileKind): boolean => kind === "document" || kind === "presentation";

const SLIDE = /^# Slide (\d+)(?::\s+(.*))?$/;
const PIPE_ROW = /^\s*\|.*\|\s*$/;
const PIPE_RULE = /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/;
/** The cells of a pipe-table row; a cell's own pipe is written \| and comes back as |. */
const pipeCells = (line: string): string[] => line.trim().slice(1, -1).split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, "|"));

/**
 * The words of an Office file (the Markdown the previews module reads from it) as the viewer's blocks: headings, paragraphs, bullets nested by level, numbered items, a table's header and rows,
 * a picture's place, and for a deck each "# Slide n: title" with the slide's words and its speaker notes under it.
 */
export function officeBlocks(text: string): DocBlock[] {
  const out: DocBlock[] = [];
  const lines = text.split("\n");
  let notes = false;
  let slides = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const id = `o${i}`;
    const slide = SLIDE.exec(line);
    if (slide) { slides = true; notes = false; out.push({ id, tag: "slide", text: slide[2] ?? "", n: Number(slide[1]) }); continue; }
    if (slides && /^Notes: /.test(line)) { notes = true; out.push({ id, tag: "note", text: line.slice(7) }); continue; }
    if (line.trim() === "") continue;
    if (notes) { out.push({ id, tag: "note", text: line }); continue; }
    if (PIPE_ROW.test(line) && !PIPE_RULE.test(line)) {
      const head = !PIPE_ROW.test(lines[i - 1] ?? "") && PIPE_RULE.test(lines[i + 1] ?? "");
      out.push({ id, tag: head ? "hrow" : "row", text: pipeCells(line).join("\t") });
      continue;
    }
    if (PIPE_RULE.test(line) && PIPE_ROW.test(lines[i - 1] ?? "")) continue;
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) { out.push({ id, tag: heading[1]!.length === 1 ? "h1" : "h2", text: heading[2]! }); continue; }
    const item = /^(\s*)([-*]|\d+\.)\s+(.*)$/.exec(line);
    if (item) {
      const level = Math.floor(item[1]!.length / 2);
      out.push({ id, tag: item[2] === "-" || item[2] === "*" ? "li" : "p", text: item[2] === "-" || item[2] === "*" ? item[3]! : `${item[2]} ${item[3]!}`, ...(level > 0 ? { level } : {}) });
      continue;
    }
    const fig = /^\[Image(?::\s*(.*))?\]$/.exec(line.trim());
    if (fig) { out.push({ id, tag: "fig", text: fig[1] ?? "" }); continue; }
    out.push({ id, tag: "p", text: line });
  }
  return out;
}

/** Plans and documents edit in place; images take markup; the rest is read only. */
export const isEditable = (d: Pick<ViewerData, "canEdit" | "file">): boolean => d.canEdit && d.file.deletedAt === undefined && (d.file.kind === "text" || d.file.kind === "markdown" || d.file.kind === "code");

/** The tile letters under the file's name: "PNG", "CSV", "MD". */
export function kindLabel(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 && dot < name.length - 1 ? name.slice(dot + 1).toUpperCase().slice(0, 4) : "FILE";
}

/** The memory graph's node for a note, found by its title (the file's name without the extension), or null when the note is not in the graph. */
export function nodeFor(graph: { nodes: readonly { nodeId: string; title: string }[] }, fileName: string): string | null {
  const title = fileName.replace(/\.[a-z0-9]+$/i, "").toLowerCase();
  return graph.nodes.find((n) => n.title.toLowerCase() === title)?.nodeId ?? null;
}

/** Front matter (`---` lines of `key: value`) is the note's property block: one meta block, keys and values split by a tab, as the Viewer draws it. */
export function splitFrontMatter(text: string): { meta: string | null; body: string } {
  const m = /^---\n([\s\S]*?)\n---\n?/.exec(text);
  if (!m) return { meta: null, body: text };
  const rows = m[1]!.split("\n").map((l) => l.replace(/^([^:]+):\s*/, "$1\t"));
  return { meta: rows.join("\n"), body: text.slice(m[0].length) };
}

/** Text to blocks: markdown headings and list items keep their weight, code files are one block per line, anything else is a paragraph per line. Blank lines are not blocks, so a save writes one line per block. */
export function textToBlocks(text: string, kind: FileKind): DocBlock[] {
  const out: DocBlock[] = [];
  const fm = kind === "markdown" ? splitFrontMatter(text) : { meta: null, body: text };
  if (fm.meta !== null) out.push({ id: "meta", tag: "meta", text: fm.meta });
  const lines = fm.body.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.trim() === "") continue;
    const id = `b${i}`;
    if (kind === "code") out.push({ id, tag: "code", text: line });
    else if (/^#\s/.test(line)) out.push({ id, tag: "h1", text: line.replace(/^#\s+/, "") });
    else if (/^##+\s/.test(line)) out.push({ id, tag: "h2", text: line.replace(/^#+\s+/, "") });
    else if (/^[-*]\s/.test(line)) out.push({ id, tag: "li", text: line.replace(/^[-*]\s+/, "") });
    else out.push({ id, tag: "p", text: line });
  }
  return out;
}

/** Blocks back to text, in the markdown the file had. Code is returned line for line. */
export function blocksToText(blocks: readonly DocBlock[], kind: FileKind): string {
  const lines: string[] = [];
  for (const b of blocks) {
    if (b.tag === "meta") lines.push("---", ...b.text.split("\n").map((l) => l.replace("\t", ": ")), "---");
    else if (kind === "code" || b.tag === "code") lines.push(b.text);
    else if (b.tag === "h1") lines.push(`# ${b.text}`);
    else if (b.tag === "h2") lines.push(`## ${b.text}`);
    else if (b.tag === "li") lines.push(`- ${b.text}`);
    else lines.push(b.text);
  }
  return `${lines.join("\n")}\n`;
}

/** CSV text to a sheet: quoted cells and doubled quotes are read; the first line is the header. */
export function parseCsv(text: string): Sheet {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') quoted = false; else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); cell = "";
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
    } else cell += c;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  const [head = [], ...body] = rows;
  return { cols: head, rows: body };
}

/** Comments anchored to an area become numbered pins on the image, in the order they were made. */
export function boxesOf(comments: readonly FileComment[]): MarkupBox[] {
  const out: MarkupBox[] = [];
  for (const c of comments) if (c.anchor.kind === "area" && c.anchor.box && !c.resolved) out.push({ id: c.commentId, text: c.text, ...c.anchor.box });
  return out;
}

const when = (at: number, now: number): string => {
  const min = Math.max(0, Math.floor((now - at) / 60_000));
  return min < 1 ? "just now" : min < 60 ? `${min} min ago` : min < 1440 ? `${Math.floor(min / 60)} h ago` : `${Math.floor(min / 1440)} d ago`;
};

/** Comments anchored to a passage become comments on that quote. A comment with no quote has no passage to mark and is listed under the file by the caller. */
export function docCommentsOf(comments: readonly FileComment[], name: (id: string) => string, now: number): DocComment[] {
  const out: DocComment[] = [];
  for (const c of comments) if (c.anchor.quote) out.push({ id: c.commentId, quote: c.anchor.quote, by: name(c.by), at: when(c.at, now), text: c.text, resolved: c.resolved });
  return out;
}

/** Strokes between the Viewer's tuples and the capability's point lists. */
export const strokesOf = (saved: CapMap["files.markup.get"]["out"]["strokes"]): Stroke[] => saved.map((s) => ({ points: s.points.map((p) => [p[0] ?? 0, p[1] ?? 0] as const) }));
export const strokesToSave = (strokes: readonly Stroke[]): CapMap["files.markup.save"]["in"]["strokes"] => strokes.map((s) => ({ color: "#e5484d", width: 3, points: s.points.map((p) => [p[0], p[1]]) }));

/** The one-line subtitle: where it is and when it changed. */
export const subtitleOf = (d: ViewerData, now: number, path?: string): string => [path, `changed ${when(d.file.updatedAt, now)}`].filter(Boolean).join(" · ");
