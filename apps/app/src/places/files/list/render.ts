// Files list markup. String HTML, same as the ui placeholders: no JSX, no fetch.
// Hover and selection sit on ui/Row at full width. Only the visible window is painted.

import { MenuPlaceholder } from "../../../../../../ui/src/Menu/Placeholder.tsx";
import type { MenuProps } from "../../../../../../ui/src/Menu/props.ts";
import { RowPlaceholder } from "../../../../../../ui/src/Row/Placeholder.tsx";
import { ShareSheetPlaceholder } from "../../../../../../ui/src/ShareSheet/Placeholder.tsx";
import type { Density, ShareSheetProps } from "../../../../../../ui/src/ShareSheet/props.ts";
import { StatesPlaceholder } from "../../../../../../ui/src/States/Placeholder.tsx";
import { nativeTokens, skinById, typeTokens } from "../../../../../../ui/src/tokens/skins.ts";
import { VirtualListPlaceholder } from "../../../../../../ui/src/VirtualList/Placeholder.tsx";
import { ROW_HEIGHT, visibleRange } from "./types.ts";
import type { Section } from "./types.ts";

/** Northwind uses Paper (System is paper by day). Harbor Studio uses Mist, a different skin. */
export const FILES_LIST_SHOTS = [
  { spaceName: "Northwind", skinId: "paper", width: 1280 },
  { spaceName: "Northwind", skinId: "paper", width: 390 },
  { spaceName: "Harbor Studio", skinId: "mist", width: 1280 },
  { spaceName: "Harbor Studio", skinId: "mist", width: 390 },
] as const;

export type ShotSpec = (typeof FILES_LIST_SHOTS)[number];

export interface ListEntry {
  id: string;
  entry: "file" | "folder";
  name: string;
  note: string;
  kind: string;
  size: number;
  via: string;
}

export interface QuickLook {
  fileId: string;
  name: string;
  kind: string;
  size: number;
  mime: string;
}

export interface ListPaint {
  spaceName: string;
  skinId: string;
  width: number;
  viewport: number;
  scrollTop: number;
  mode: "folder" | "recent" | "shared" | "trash" | "knowledge";
  section?: Section;
  folderId?: string;
  title: string;
  link: "ready" | "offline" | "error";
  entries: readonly ListEntry[];
  selected: readonly string[];
  hovered: string | null;
  springFolderId: string | null;
  spring: "idle" | "arming" | "open";
  quickLook: QuickLook | null;
  share: ShareSheetProps | null;
  menuFor: string | null;
}

function esc(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

export function densityFor(width: number): Density {
  return width < 800 ? "compact" : "regular";
}

function skinStyle(skinId: string): { style: string; accent: string } {
  const skin = skinById(skinId);
  if (!skin) return { style: "", accent: "" };
  const tokens = nativeTokens(skin);
  const body = Object.entries({ ...tokens, "--ui": typeTokens["--ui"], "--mono": typeTokens["--mono"] })
    .map(([key, value]) => `${key}:${value}`)
    .join(";");
  return { style: ` style="${esc(body)}"`, accent: tokens["--accent"] };
}

function menu(entry: ListEntry): MenuProps {
  const items = entry.entry === "folder"
    ? [
      { label: "Share", icon: "share" },
      { label: "Rename", icon: "pencil" },
      { label: "Move to Trash", icon: "trash" },
    ]
    : [
      { label: "Quick Look", icon: "eye" },
      { label: "Share", icon: "share" },
      { label: "Rename", icon: "pencil" },
      { label: "Move to Trash", icon: "trash" },
    ];
  return { items, source: "context" };
}

function emptyState(paint: ListPaint): string {
  if (paint.link === "offline") {
    return StatesPlaceholder({ kind: "offline", title: "Offline, showing your saved copy", icon: "offline" });
  }
  if (paint.link === "error") {
    return StatesPlaceholder({
      kind: "error",
      message: "Could not load this",
      next: "Try again",
      retryable: true,
    });
  }
  if (paint.entries.length > 0) return "";
  if (paint.mode === "trash") return StatesPlaceholder({ kind: "empty", title: "Trash is empty", icon: "files" });
  if (paint.mode === "shared") return StatesPlaceholder({ kind: "empty", title: "Nothing shared with you", icon: "files" });
  if (paint.mode === "recent" || paint.mode === "knowledge") {
    return StatesPlaceholder({ kind: "empty", title: "No files yet", icon: "files" });
  }
  return StatesPlaceholder({
    kind: "empty",
    title: "This folder is empty",
    icon: "files",
    action: { label: "Upload a file", onPress: () => undefined },
  });
}

export function renderFilesList(paint: ListPaint): string {
  const density = densityFor(paint.width);
  const range = visibleRange(paint.entries.length, paint.scrollTop, paint.viewport);
  const window = paint.entries.slice(range.start, range.end);
  const selected = new Set(paint.selected);
  const skin = skinStyle(paint.skinId);
  const rows = window.map((entry) => {
    const row = RowPlaceholder({
      id: entry.id,
      title: entry.name,
      note: entry.note,
      selected: selected.has(entry.id),
      hovered: paint.hovered === entry.id,
    });
    const spring = entry.entry === "folder" && paint.springFolderId === entry.id ? paint.spring : "idle";
    const drop = entry.entry === "folder" ? ` data-drop-target="${esc(entry.id)}" data-spring="${spring}"` : "";
    return `<div data-entry="${entry.entry}" data-id="${esc(entry.id)}" data-via="${esc(entry.via)}" data-kind="${esc(entry.kind)}" data-width="100%" style="height:${ROW_HEIGHT}px"${drop}>${row}</div>`;
  }).join("");
  const list = VirtualListPlaceholder({
    data: window.map((entry) => ({ id: entry.id, name: entry.name, title: entry.name })),
    rowHeight: ROW_HEIGHT,
    window: { start: range.start, end: range.end },
    renderItem: (item) => item.name,
    keyOf: (item) => item.id,
  });
  const section = paint.section ? ` data-section="${paint.section}"` : "";
  const folder = paint.folderId ? ` data-folder="${esc(paint.folderId)}"` : "";
  const quick = paint.quickLook
    ? `<aside data-quick-look="${esc(paint.quickLook.fileId)}" data-name="${esc(paint.quickLook.name)}" data-kind="${esc(paint.quickLook.kind)}" data-size="${paint.quickLook.size}" data-mime="${esc(paint.quickLook.mime)}"><p>Preview from the local copy</p></aside>`
    : "";
  const share = paint.share ? shareBox(paint.share) : "";
  const menuHtml = paint.menuFor ? menuBox(paint.entries, paint.menuFor) : "";
  const bodyHeight = paint.entries.length * ROW_HEIGHT;
  return `<main data-screen="files.list" data-screen-id="files.list" data-space="${esc(paint.spaceName)}" data-skin="${esc(paint.skinId)}" data-width="${paint.width}" data-density="${density}" data-accent="${esc(skin.accent)}" data-mode="${paint.mode}" data-title="${esc(paint.title)}" data-link="${paint.link}"${section}${folder}${skin.style}><header><h1>${esc(paint.title)}</h1></header><div data-virtual-list="true" data-total="${paint.entries.length}" data-row-height="${ROW_HEIGHT}" data-window-start="${range.start}" data-window-end="${range.end}" data-scroll-top="${paint.scrollTop}" data-viewport="${paint.viewport}" style="height:${bodyHeight}px">${list}${rows}</div>${emptyState(paint)}${quick}${share}${menuHtml}</main>`;
}

function shareBox(props: ShareSheetProps): string {
  const box = ShareSheetPlaceholder(props);
  return `<div data-placeholder="${box.label}" data-share-target="${props.target}" data-resource-id="${esc(props.resourceId)}" data-resource-name="${esc(props.resourceName)}" data-density="${box.density}" data-label="${esc(box.text)}"><span data-label>${esc(box.text)}</span></div>`;
}

function menuBox(entries: readonly ListEntry[], id: string): string {
  const entry = entries.find((row) => row.id === id);
  if (!entry) return "";
  return MenuPlaceholder(menu(entry));
}

export function placeFrame(listHtml: string, treeHtml: string, shot: ShotSpec): string {
  return `<div data-place="files" data-shot="files.list" data-space="${esc(shot.spaceName)}" data-skin="${esc(shot.skinId)}" data-width="${shot.width}">${treeHtml}${listHtml}</div>`;
}
