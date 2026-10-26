// Files model: the pure part. Where the list is (a folder, Recent, Shared with me, Trash, Knowledge), what a line is, how a selection grows with click, Cmd-click and Shift-click,
// what a drop does, and how long a dragged item rests on a folder before it opens (spring-load). No React and no clock; every rule is tested without a renderer.
import type { CapMap } from "../../../../../../generated/types.ts";

export type FileRow = CapMap["files.list"]["out"]["files"][number];
export type FolderRow = CapMap["files.list"]["out"]["folders"][number];
export type FileKind = FileRow["kind"];
export type TreeRoots = CapMap["files.tree"]["out"]["roots"];

export const SCREENS = { tree: "files.tree", list: "files.list" } as const;

/** Where the list is. */
export type Where = { kind: "folder"; id: string | null } | { kind: "recent" } | { kind: "starred" } | { kind: "shared" } | { kind: "trash" } | { kind: "knowledge" };
export type SortKey = "name" | "updated" | "by" | "size" | "kind";
export type ViewMode = "list" | "grid";

export interface FilesState {
  where: Where;
  /** Selected line keys ("file:fil_1", "folder:fld_2"), in the order they were added. */
  selection: readonly string[];
  /** The line the next Shift-click ranges from. */
  anchor: string | null;
  sort: SortKey;
  dir: "asc" | "desc";
  /** The line Quick Look shows, or null. */
  quickLook: string | null;
  /** The list as rows with columns, or as a grid of tiles (P-L9e_01b). */
  view: ViewMode;
  /** Names that start with a dot (.vyre, .index) stay out of the list unless this is on. */
  showHidden: boolean;
  /** Where the list was before, newest last: the back arrow walks it. */
  back: readonly Where[];
  /** Where Back came from, newest last: the forward arrow walks it. */
  forward: readonly Where[];
}

export const INITIAL_STATE: FilesState = { where: { kind: "folder", id: null }, selection: [], anchor: null, sort: "name", dir: "asc", quickLook: null, view: "list", showHidden: false, back: [], forward: [] };

export const SORT_LABEL: Record<SortKey, string> = { name: "Name", updated: "Date modified", by: "Made by", size: "Size", kind: "Kind" };
export const SORTS: readonly SortKey[] = ["name", "updated", "by", "size", "kind"];

// ---------------------------------------------------------------- lines

export interface Line {
  /** "file:<id>" or "folder:<id>": unique in the list and the payload of a drag. */
  key: string;
  type: "file" | "folder";
  id: string;
  name: string;
  kind: FileKind | "folder";
  size: number;
  updatedAt: number;
  updatedBy: string | null;
  thumb: boolean;
  source: string | null;
  /** What the line holds, for a folder. */
  items: number;
  folderId: string | null;
  /** The person starred this file (files.star). */
  starred?: boolean;
  /** Two edits of this file wait for a choice (the Conflict tag). */
  conflict?: boolean;
}

export function fileLine(f: FileRow): Line {
  return { key: `file:${f.fileId}`, type: "file", id: f.fileId, name: f.name, kind: f.kind, size: f.size, updatedAt: f.updatedAt, updatedBy: f.updatedBy, thumb: f.thumb, source: f.source?.provider ?? null, items: 0, folderId: f.folderId, ...(f.starred === true ? { starred: true } : {}), ...(f.conflict === true ? { conflict: true } : {}) };
}

export function folderLine(f: FolderRow): Line {
  return { key: `folder:${f.folderId}`, type: "folder", id: f.folderId, name: f.name, kind: "folder", size: 0, updatedAt: 0, updatedBy: null, thumb: false, source: f.source?.provider ?? null, items: f.fileCount + f.folderCount, folderId: f.parentId ?? null };
}

const KIND_LABEL: Record<FileKind | "folder", string> = {
  folder: "Folder", text: "Text", markdown: "Markdown", document: "Document", spreadsheet: "Spreadsheet", presentation: "Presentation", pdf: "PDF", image: "Image", video: "Video", audio: "Audio",
  code: "Code", archive: "Archive", google_native: "Google file", other: "File",
};
export const kindLabel = (k: FileKind | "folder"): string => KIND_LABEL[k];

export function sizeText(bytes: number): string {
  if (bytes < 1000) return `${bytes} B`;
  if (bytes < 1_000_000) return `${Math.round(bytes / 1000)} KB`;
  if (bytes < 1_000_000_000) return `${(bytes / 1_000_000).toFixed(bytes < 10_000_000 ? 1 : 0).replace(/\.0$/, "")} MB`;
  return `${(bytes / 1_000_000_000).toFixed(1).replace(/\.0$/, "")} GB`;
}

const DAY = 86_400_000;
const MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

/** Today: the clock time. Yesterday: the word. Otherwise the date. */
export function updatedText(at: number, now: number, offsetMin: number): string {
  if (at <= 0) return "";
  const day = (t: number): number => Math.floor((t + offsetMin * 60_000) / DAY);
  const local = new Date(at + offsetMin * 60_000);
  const age = day(now) - day(at);
  if (age <= 0) {
    const h = local.getUTCHours(), m = local.getUTCMinutes();
    return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
  }
  if (age === 1) return "Yesterday";
  return `${MONTH[local.getUTCMonth()] ?? ""} ${local.getUTCDate()}${local.getUTCFullYear() === new Date(now + offsetMin * 60_000).getUTCFullYear() ? "" : `, ${local.getUTCFullYear()}`}`;
}

/** Folders first, then files, each by the chosen key. Name sorts without case and with numbers in order ("file 2" before "file 10"). */
export function sortLines(lines: readonly Line[], key: SortKey, dir: "asc" | "desc", nameOf: (id: string) => string = (id) => id): Line[] {
  const sign = dir === "asc" ? 1 : -1;
  const cmp = (a: Line, b: Line): number => {
    if (a.type !== b.type) return a.type === "folder" ? -1 : 1;
    const byName = a.name.localeCompare(b.name, "en", { sensitivity: "base", numeric: true });
    switch (key) {
      case "name": return sign * byName;
      case "updated": return sign * (a.updatedAt - b.updatedAt) || byName;
      case "by": return sign * (a.updatedBy === null ? (b.updatedBy === null ? 0 : -1) : b.updatedBy === null ? 1 : nameOf(a.updatedBy).localeCompare(nameOf(b.updatedBy), "en", { sensitivity: "base" })) || byName;
      case "size": return sign * (a.size - b.size) || byName;
      case "kind": return sign * a.kind.localeCompare(b.kind) || byName;
    }
  };
  return lines.slice().sort(cmp);
}

// ---------------------------------------------------------------- selection

export type Mods = { meta: boolean; shift: boolean };

/** Finder rules: a plain click selects one; Cmd or Ctrl toggles one; Shift selects the range from the anchor to the line. */
export function clickSelect(s: FilesState, order: readonly string[], key: string, mods: Mods): FilesState {
  if (mods.shift && s.anchor !== null && order.includes(s.anchor)) {
    const a = order.indexOf(s.anchor), b = order.indexOf(key);
    const [lo, hi] = a < b ? [a, b] : [b, a];
    return { ...s, selection: order.slice(lo, hi + 1) };
  }
  if (mods.meta) {
    const on = s.selection.includes(key);
    return { ...s, selection: on ? s.selection.filter((k) => k !== key) : [...s.selection, key], anchor: key };
  }
  return { ...s, selection: [key], anchor: key };
}

/** An arrow key moves the selection to the neighbour; Shift keeps the anchor and grows the range. Nothing selected starts at the first or last line. */
export function arrowSelect(s: FilesState, order: readonly string[], dir: 1 | -1, shift: boolean): FilesState {
  if (order.length === 0) return s;
  const last = s.selection[s.selection.length - 1];
  const at = last === undefined ? -1 : order.indexOf(last);
  const next = at < 0 ? (dir === 1 ? 0 : order.length - 1) : Math.max(0, Math.min(order.length - 1, at + dir));
  const key = order[next]!;
  if (!shift) return { ...s, selection: [key], anchor: key };
  return clickSelect({ ...s, anchor: s.anchor ?? key }, order, key, { meta: false, shift: true });
}

export function selectAll(s: FilesState, order: readonly string[]): FilesState {
  return { ...s, selection: [...order], anchor: order[0] ?? null };
}

/** A right-click on a line inside the selection keeps the selection; on a line outside it, selects that line. */
export function contextSelect(s: FilesState, key: string): FilesState {
  return s.selection.includes(key) ? s : { ...s, selection: [key], anchor: key };
}

// ---------------------------------------------------------------- drag and drop

/** What a drag carries: the dragged lines (the whole selection when the dragged line is in it), as one string. */
export function dragPayload(s: FilesState, key: string): string {
  return (s.selection.includes(key) ? s.selection : [key]).join(",");
}

export function parsePayload(payload: string): { type: "file" | "folder"; id: string }[] {
  const out: { type: "file" | "folder"; id: string }[] = [];
  for (const part of payload.split(",")) {
    const m = /^(file|folder):(.+)$/.exec(part.trim());
    if (m) out.push({ type: m[1] as "file" | "folder", id: m[2]! });
  }
  return out;
}

export interface Move { cap: "files.move" | "folders.move"; input: Record<string, unknown> }

/** The moves a drop makes: each file to the folder, each folder under it. A folder never moves into itself, and an item already there stays put. */
export function dropMoves(items: readonly { type: "file" | "folder"; id: string }[], target: string | null, here: (item: { type: "file" | "folder"; id: string }) => string | null): Move[] {
  const out: Move[] = [];
  for (const it of items) {
    if (it.type === "folder" && it.id === target) continue;
    if (here(it) === target) continue;
    out.push(it.type === "file" ? { cap: "files.move", input: { fileId: it.id, toFolderId: target } } : { cap: "folders.move", input: { folderId: it.id, parentId: target } });
  }
  return out;
}

export interface Spring {
  enter(id: string): void;
  leave(id: string): void;
  cancel(): void;
}

export const SPRING_MS = 700;

/** Spring-load: a dragged item resting on a folder for `delay` ms opens it. Moving to another folder restarts the wait; leaving cancels it. */
export function createSpring(fire: (id: string) => void, delay: number = SPRING_MS, schedule: (fn: () => void, ms: number) => unknown = setTimeout, clear: (h: unknown) => void = (h) => clearTimeout(h as ReturnType<typeof setTimeout>)): Spring {
  let on: string | null = null;
  let handle: unknown = null;
  const stop = (): void => { if (handle !== null) clear(handle); handle = null; on = null; };
  return {
    enter(id) {
      if (on === id) return;
      stop();
      on = id;
      handle = schedule(() => { handle = null; on = null; fire(id); }, delay);
    },
    leave(id) { if (on === id) stop(); },
    cancel: stop,
  };
}

// ---------------------------------------------------------------- the state

export type Action =
  | { type: "go"; where: Where }
  | { type: "click"; order: readonly string[]; key: string; mods: Mods }
  | { type: "arrow"; order: readonly string[]; dir: 1 | -1; shift: boolean }
  | { type: "all"; order: readonly string[] }
  | { type: "context"; key: string }
  | { type: "clear" }
  | { type: "sort"; key: SortKey }
  | { type: "dir"; dir: "asc" | "desc" }
  | { type: "quicklook"; key: string | null }
  | { type: "view"; view: ViewMode }
  | { type: "hidden"; on: boolean }
  | { type: "back" }
  | { type: "forward" };

export function reduce(s: FilesState, a: Action): FilesState {
  switch (a.type) {
    case "go": return sameWhere(s.where, a.where)
      ? { ...s, where: a.where, selection: [], anchor: null, quickLook: null }
      : { ...s, where: a.where, selection: [], anchor: null, quickLook: null, back: [...s.back, s.where].slice(-50), forward: [] };
    case "hidden": return { ...s, showHidden: a.on };
    case "back": {
      const prev = s.back[s.back.length - 1];
      return prev === undefined ? s : { ...s, where: prev, selection: [], anchor: null, quickLook: null, back: s.back.slice(0, -1), forward: [...s.forward, s.where] };
    }
    case "forward": {
      const next = s.forward[s.forward.length - 1];
      return next === undefined ? s : { ...s, where: next, selection: [], anchor: null, quickLook: null, back: [...s.back, s.where], forward: s.forward.slice(0, -1) };
    }
    case "click": return clickSelect(s, a.order, a.key, a.mods);
    case "arrow": return arrowSelect(s, a.order, a.dir, a.shift);
    case "all": return selectAll(s, a.order);
    case "context": return contextSelect(s, a.key);
    case "clear": return { ...s, selection: [], anchor: null, quickLook: null };
    case "sort": return s.sort === a.key ? { ...s, dir: s.dir === "asc" ? "desc" : "asc" } : { ...s, sort: a.key, dir: a.key === "updated" ? "desc" : "asc" };
    case "dir": return { ...s, dir: a.dir };
    case "quicklook": return { ...s, quickLook: a.key };
    case "view": return { ...s, view: a.view };
  }
}

export function sameWhere(a: Where, b: Where): boolean {
  return a.kind === b.kind && (a.kind !== "folder" || (b.kind === "folder" && a.id === b.id));
}

export const WHERE_LABEL: Record<Exclude<Where["kind"], "folder">, string> = { recent: "Recent", starred: "Starred", shared: "Shared with me", trash: "Trash", knowledge: "Knowledge" };

/** The capability and input that list a place. */
export function sourceOf(where: Where): { cap: "files.list" | "files.recent" | "files.shared_with_me" | "files.knowledge" | "files.trash.list"; input: Record<string, unknown> } {
  switch (where.kind) {
    case "folder": return { cap: "files.list", input: where.id === null ? {} : { folder: where.id } };
    case "recent": return { cap: "files.recent", input: { limit: 50 } };
    // Starred reads the starred flag on the files the copy holds; the list keeps the flagged ones
    case "starred": return { cap: "files.recent", input: { limit: 500 } };
    case "shared": return { cap: "files.shared_with_me", input: {} };
    case "trash": return { cap: "files.trash.list", input: {} };
    case "knowledge": return { cap: "files.knowledge", input: {} };
  }
}

/** The titles from the top of the tree down to a folder. */
export function crumbs(nodes: readonly { id: string; name: string; parentId: string | null }[], id: string | null): { id: string; name: string }[] {
  const out: { id: string; name: string }[] = [];
  let cur = id === null ? undefined : nodes.find((n) => n.id === id);
  while (cur && out.length < 16) {
    out.unshift({ id: cur.id, name: cur.name });
    const parent: string | null = cur.parentId;
    cur = parent === null ? undefined : nodes.find((n) => n.id === parent);
  }
  return out;
}

export function emptyText(where: Where): string {
  switch (where.kind) {
    case "folder": return "This folder is empty.";
    case "recent": return "Nothing opened recently.";
    case "starred": return "Nothing starred yet.";
    case "shared": return "Nothing has been shared with you yet.";
    case "trash": return "The Trash is empty.";
    case "knowledge": return "No notes in Knowledge yet.";
  }
}

// ---------------------------------------------------------------- Agents and Projects

export type TreeRoot = TreeRoots[number];
export interface SubjectGroups { agents: TreeRoot[]; projects: TreeRoot[] }

/** The folders Files registers for itself (ruling 65): one per agent and one per project, read from the roots of files.tree. */
export function subjectGroups(roots: TreeRoots): SubjectGroups {
  const mine = roots.filter((r) => r.kind === "folder" && r.folderId !== undefined);
  const byTitle = (a: TreeRoot, b: TreeRoot): number => a.title.localeCompare(b.title, "en", { sensitivity: "base" });
  return {
    agents: mine.filter((r) => r.subject?.kind === "agent").sort(byTitle),
    projects: mine.filter((r) => r.subject?.kind === "project").sort(byTitle),
  };
}

/** The ids of the given folders and everything under them: the main folder tree leaves these out, because the groups show them. */
export function subtreeIds(nodes: readonly { id: string; parentId: string | null }[], rootIds: readonly string[]): Set<string> {
  const out = new Set<string>(rootIds);
  let grew = true;
  while (grew) {
    grew = false;
    for (const n of nodes) if (n.parentId !== null && out.has(n.parentId) && !out.has(n.id)) { out.add(n.id); grew = true; }
  }
  return out;
}
