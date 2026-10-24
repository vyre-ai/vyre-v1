// Files tree (spec 3.5, 2.16, ARCH 7.5).
// Recent, Shared with me, Trash, and Knowledge (Memory, Graph), plus the place roots.
// Folder rows go through ui/ListSections and ui/FolderTree. A drag that rests on a folder spring-loads it.

import { liveQuery } from "../../../../../../client/src/index.ts";
import type { FakeReplica } from "../../../../../../client/src/index.ts";
import { FolderTreePlaceholder } from "../../../../../../ui/src/FolderTree/Placeholder.tsx";
import type { AccessVia, FolderNode, FolderScope, FolderSectionId } from "../../../../../../ui/src/FolderTree/props.ts";
import { ListSectionsPlaceholder } from "../../../../../../ui/src/ListSections/Placeholder.tsx";
import type { ListSection, ListSectionName } from "../../../../../../ui/src/ListSections/props.ts";
import { applyMove, asFile, asFolder } from "../list/bind.ts";
import type { CapCall } from "../list/session.ts";
import { SPRING_LOAD_MS } from "../list/types.ts";
import type { FilesView, Section } from "../list/types.ts";

const PLACE_ROOTS: readonly { key: string; title: string }[] = [
  { key: "agents", title: "Agents" },
  { key: "projects", title: "Projects" },
  { key: "people", title: "People" },
  { key: "channels", title: "Channels" },
  { key: "shared-knowledge", title: "Shared knowledge" },
  { key: "agent-template", title: "Agent template" },
];

const VIRTUAL = new Set<string>(["recent", "shared", "trash", "memory", "graph"]);

interface Root {
  key: string;
  title: string;
  kind: "folder" | "virtual";
  count: number;
  folderId?: string;
}

function esc(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function sectionName(section: Section): ListSectionName {
  if (section === "shared") return "Shared with me";
  if (section === "space") return "Space";
  return "Personal";
}

function treeSection(section: Section): FolderSectionId {
  return section;
}

export function bindFilesTree(replica: FakeReplica): void {
  replica.resolve("files.tree", (tables) => {
    const folders = [];
    for (const row of tables.get("folders")?.values() ?? []) {
      const folder = asFolder(row);
      if (folder && folder.deletedAt === undefined) folders.push(folder);
    }
    let shared = 0;
    let trash = 0;
    let recent = 0;
    for (const row of tables.get("files")?.values() ?? []) {
      const file = asFile(row);
      if (!file) continue;
      if (file.deletedAt !== undefined) {
        trash += 1;
        continue;
      }
      recent += 1;
      if (file.via === "grant" || file.via === "folder") shared += 1;
    }
    const byName = new Map(folders.map((folder) => [folder.name.toLowerCase(), folder]));
    const roots: Root[] = [
      { key: "recent", title: "Recent", kind: "virtual", count: Math.min(recent, 200) },
      { key: "shared", title: "Shared with me", kind: "virtual", count: shared },
      { key: "trash", title: "Trash", kind: "virtual", count: trash },
      { key: "memory", title: "Memory", kind: "virtual", count: 0 },
      { key: "graph", title: "Graph", kind: "virtual", count: 0 },
    ];
    for (const place of PLACE_ROOTS) {
      const folder = byName.get(place.title.toLowerCase());
      const root: Root = {
        key: place.key,
        title: place.title,
        kind: folder ? "folder" : "virtual",
        count: folder?.fileCount ?? 0,
      };
      if (folder) root.folderId = folder.folderId;
      roots.push(root);
    }
    return { roots };
  });
}

export interface FilesTreeOptions {
  replica: FakeReplica;
  invoke?: (call: CapCall) => void;
  width?: number;
  spaceName?: string;
  skinId?: string;
}

export class FilesTree {
  readonly calls: CapCall[] = [];
  private readonly replica: FakeReplica;
  private readonly invoke: ((call: CapCall) => void) | undefined;
  private width: number;
  private spaceName: string;
  private skinId: string;
  private selected = "recent";
  private opened: string | null = null;
  private over: { id: string; since: number } | null = null;
  private query: { getSnapshot(): { status: "loading" } | { status: "ready"; data: { roots: Root[] } } } | null = null;

  constructor(options: FilesTreeOptions) {
    this.replica = options.replica;
    this.invoke = options.invoke;
    this.width = options.width ?? 1280;
    this.spaceName = options.spaceName ?? "Northwind";
    this.skinId = options.skinId ?? "paper";
    bindFilesTree(this.replica);
  }

  setFrame(frame: { width?: number; spaceName?: string; skinId?: string }): void {
    if (frame.width) this.width = frame.width;
    if (frame.spaceName) this.spaceName = frame.spaceName;
    if (frame.skinId) this.skinId = frame.skinId;
  }

  select(key: string): FilesView {
    this.selected = key;
    if (key === "recent") return { mode: "recent" };
    if (key === "shared") return { mode: "shared" };
    if (key === "trash") return { mode: "trash" };
    if (key === "memory" || key === "graph") return { mode: "knowledge", key };
    const folderId = this.folderId(key);
    if (!folderId) return { mode: "folder" };
    const section = this.sectionOf(folderId);
    return section ? { mode: "folder", folderId, section } : { mode: "folder", folderId };
  }

  dragOver(folderId: string, now: number): void {
    if (this.over?.id !== folderId) this.over = { id: folderId, since: now };
  }

  tick(now: number): void {
    if (!this.over) return;
    if (now - this.over.since < SPRING_LOAD_MS) return;
    this.opened = this.over.id;
    this.selected = this.over.id;
  }

  /** Drop a file onto a folder in the sidebar. Moving into a shared folder shares it. */
  receiveDrop(fileId: string, toFolderId: string): boolean {
    if (!applyMove(this.replica, fileId, toFolderId)) return false;
    const call = { cap: "files.move", input: { fileId, toFolderId } };
    this.calls.push(call);
    this.invoke?.(call);
    return true;
  }

  html(): string {
    const roots = this.roots();
    const density = this.width < 800 ? "compact" : "regular";
    const folders = this.folders();
    const virtual = roots.filter((root) => root.key === "recent" || root.key === "shared" || root.key === "trash");
    const knowledge = roots.filter((root) => root.key === "memory" || root.key === "graph");
    const place = roots.filter((root) => !VIRTUAL.has(root.key));
    const items = (rows: readonly Root[]) => rows.map((root) => this.rootHtml(root)).join("");
    const sections = this.sections(folders);
    const tree = FolderTreePlaceholder({
      resourceType: "file",
      nodes: this.nodes(folders),
      selectedId: this.opened,
      density,
    });
    const treeBox = `<div data-placeholder="${tree.label}" data-density="${tree.density}" data-label="${esc(tree.text)}"><span data-label>${esc(tree.text)}</span></div>`;
    return `<nav data-screen="files.tree" data-screen-id="files.tree" data-space="${esc(this.spaceName)}" data-skin="${esc(this.skinId)}" data-width="${this.width}" data-density="${density}" data-selected="${esc(this.selected)}" data-open="${esc(this.opened ?? "")}"><ul data-roots="virtual">${items(virtual)}</ul><section data-group="Knowledge"><h2>Knowledge</h2><ul>${items(knowledge)}</ul></section><ul data-roots="place">${items(place)}</ul>${ListSectionsPlaceholder({ type: "files", sections })}${treeBox}</nav>`;
  }

  private rootHtml(root: Root): string {
    const selected = this.selected === root.key || this.selected === root.folderId ? "true" : "false";
    const folder = root.folderId ? ` data-folder="${esc(root.folderId)}"` : "";
    const spring = this.over?.id === (root.folderId ?? root.key) ? (this.opened === this.over.id ? "open" : "arming") : "idle";
    return `<li data-root="${esc(root.key)}" data-kind="${root.kind}" data-title="${esc(root.title)}" data-count="${root.count}" data-selected="${selected}" data-spring="${spring}"${folder}>${esc(root.title)}</li>`;
  }

  private folders() {
    const out = [];
    for (const row of this.replica.rows("folders")) {
      const folder = asFolder(row);
      if (folder && folder.deletedAt === undefined) out.push(folder);
    }
    return out;
  }

  private sections(folders: readonly { folderId: string; name: string; section: Section; fileCount: number }[]): ListSection[] {
    const buckets = new Map<ListSectionName, { id: string; title: string; note: string }[]>();
    for (const name of ["Personal", "Shared with me", "Space"] as const) buckets.set(name, []);
    for (const folder of folders) {
      const name = sectionName(folder.section);
      buckets.get(name)?.push({ id: folder.folderId, title: folder.name, note: String(folder.fileCount) });
    }
    return (["Personal", "Shared with me", "Space"] as const).map((name) => ({ name, rows: buckets.get(name) ?? [] }));
  }

  private nodes(folders: readonly { folderId: string; name: string; parentId?: string; fileCount: number; scope: FolderScope; section: Section; via: AccessVia }[]): FolderNode[] {
    return folders.map((folder) => ({
      id: folder.folderId,
      name: folder.name,
      parentId: folder.parentId ?? null,
      count: folder.fileCount,
      scope: folder.scope,
      section: treeSection(folder.section),
      via: folder.via,
      open: this.opened === folder.folderId,
    }));
  }

  private roots(): Root[] {
    if (!this.query) this.query = liveQuery(this.replica, "files.tree", {});
    const snap = this.query.getSnapshot();
    return snap.status === "ready" ? snap.data.roots : [];
  }

  private folderId(key: string): string | null {
    const roots = this.roots();
    const root = roots.find((row) => row.key === key || row.folderId === key);
    if (root?.folderId) return root.folderId;
    const folder = this.folders().find((row) => row.folderId === key);
    return folder?.folderId ?? null;
  }

  private sectionOf(folderId: string): Section | null {
    const folder = this.folders().find((row) => row.folderId === folderId);
    return folder?.section ?? null;
  }
}
