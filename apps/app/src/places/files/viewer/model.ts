// Files Viewer wiring (spec 3.5, 2.16): the pure mapping between the Files capabilities (files.viewer_data, files.comments.*, files.markup.*, files.save) and the shared Viewer's own shapes.
// A file's text becomes blocks or a sheet; a comment anchored to an area is a numbered pin on an image, a comment anchored to a passage is a comment on that quote. Nothing here calls a capability.
import type { CapMap } from "../../../../../../generated/types.ts";
import type { DocBlock, DocComment, MarkupBox, Sheet, Stroke, ViewerKind } from "../../../../../../ui/src/Viewer/index.tsx";

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
    case "presentation": return "plan";
    default: return "other";
  }
}

/** Plans and documents edit in place; images take markup; the rest is read only. */
export const isEditable = (d: Pick<ViewerData, "canEdit" | "file">): boolean => d.canEdit && d.file.deletedAt === undefined && (d.file.kind === "text" || d.file.kind === "markdown" || d.file.kind === "code");

/** The tile letters under the file's name: "PNG", "CSV", "MD". */
export function kindLabel(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 && dot < name.length - 1 ? name.slice(dot + 1).toUpperCase().slice(0, 4) : "FILE";
}

/** Text to blocks: markdown headings and list items keep their weight, code files are one block per line, anything else is a paragraph per line. Blank lines are not blocks, so a save writes one line per block. */
export function textToBlocks(text: string, kind: FileKind): DocBlock[] {
  const out: DocBlock[] = [];
  const lines = text.split("\n");
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
    if (kind === "code" || b.tag === "code") lines.push(b.text);
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
