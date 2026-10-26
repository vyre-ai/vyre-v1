// The Home sidebar's content (spec 3.1, the prototype's Home list): Home, My work with Assigned by you and Runs, then Starred, Following and Recent.
// Pure: the builder turns the data and a search into the rows the sidebar draws, so the order and the counts are tested without a renderer.
import { matchRows } from "../../../shell/sidebar/model.ts";

export type HomeItemKind = "terminal" | "agent" | "assistant" | "file" | "project" | "record" | "chat" | "automation" | "person";

export interface HomeSidebarItem {
  id: string;
  title: string;
  note?: string;
  kind: HomeItemKind;
  /** Where choosing the row goes: the place and the item's route hash. */
  target: { place: string; hash?: string };
}

export interface HomeSidebarData {
  counts: { myWork: number; assigned: number; runs: number };
  starred: readonly HomeSidebarItem[];
  following: readonly HomeSidebarItem[];
  recent: readonly HomeSidebarItem[];
}

export type FolderKey = "starred" | "following" | "recent";
export const FOLDERS: readonly { key: FolderKey; title: string }[] = [
  { key: "starred", title: "Starred" },
  { key: "following", title: "Following" },
  { key: "recent", title: "Recent" },
];

/** A fixed row of the sidebar: Home, My work and its two children. */
export interface FixedRow { id: "home" | "work" | "assigned" | "runs"; title: string; count?: number; child?: boolean; target: { place: string; hash?: string } }

export function fixedRows(d: HomeSidebarData, query: string): FixedRow[] {
  const all: FixedRow[] = [
    { id: "home", title: "Home", target: { place: "home" } },
    { id: "work", title: "My work", count: d.counts.myWork, target: { place: "home", hash: "work" } },
    { id: "assigned", title: "Assigned by you", count: d.counts.assigned, child: true, target: { place: "home", hash: "work:assigned" } },
    { id: "runs", title: "Runs", count: d.counts.runs, child: true, target: { place: "home", hash: "work:runs" } },
  ];
  return query.trim() === "" ? all : matchRows(all, query);
}

export function folderRows(d: HomeSidebarData, key: FolderKey, query: string): HomeSidebarItem[] {
  return matchRows(d[key], query);
}

/** Folders with nothing to show (after a search) are not drawn. */
export function visibleFolders(d: HomeSidebarData, query: string): { key: FolderKey; title: string; rows: HomeSidebarItem[] }[] {
  const out: { key: FolderKey; title: string; rows: HomeSidebarItem[] }[] = [];
  for (const f of FOLDERS) {
    const rows = folderRows(d, f.key, query);
    if (rows.length > 0 || query.trim() === "") out.push({ ...f, rows });
  }
  return out;
}
