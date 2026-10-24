// Finder-grade files list: select, drag, spring-load, Quick Look, folder share.
// One replica subscription. Rows read a window of the cached snapshot and do not subscribe.

import { liveQuery } from "../../../../../../client/src/index.ts";
import type { FakeReplica } from "../../../../../../client/src/index.ts";
import type { ShareLevel, ShareSheetProps, ShareSubjectKind } from "../../../../../../ui/src/ShareSheet/props.ts";
import { applyMove, bindFilesList, collect } from "./bind.ts";
import type { FileOut, FolderOut } from "./bind.ts";
import { renderFilesList } from "./render.ts";
import type { ListEntry, ListPaint, QuickLook } from "./render.ts";
import { queryFor, SPRING_LOAD_MS, viewKey } from "./types.ts";
import type { FilesView, Section, Via } from "./types.ts";

export interface CapCall {
  cap: string;
  input: Record<string, unknown>;
}

export interface FilesListOptions {
  replica: FakeReplica;
  invoke?: (call: CapCall) => void;
  prefetch?: (screenId: string, args: Record<string, unknown>) => void;
  spaceName?: string;
  skinId?: string;
  width?: number;
  viewport?: number;
  view?: FilesView;
}

interface Drag {
  fileIds: string[];
  overFolderId: string | null;
  overSince: number;
}

interface Cache {
  version: number;
  key: string;
  entries: ListEntry[];
  files: Map<string, FileOut>;
  folders: Map<string, FolderOut>;
  via: Map<string, Via>;
  folderSection: Map<string, Section>;
}

const EMPTY_FILES: FileOut[] = [];
const EMPTY_FOLDERS: FolderOut[] = [];

export class FilesList {
  readonly calls: CapCall[] = [];
  private readonly replica: FakeReplica;
  private readonly invoke: ((call: CapCall) => void) | undefined;
  private readonly prefetch: ((screenId: string, args: Record<string, unknown>) => void) | undefined;
  private view: FilesView;
  private spaceName: string;
  private skinId: string;
  private width: number;
  private viewport: number;
  private scrollTop = 0;
  private selected: string[] = [];
  private anchor: string | null = null;
  private hovered: string | null = null;
  private drag: Drag | null = null;
  private sprung: string | null = null;
  private quickId: string | null = null;
  private share: ShareSheetProps | null = null;
  private menuFor: string | null = null;
  private link: ListPaint["link"] = "ready";
  private cache: Cache | null = null;
  private listKey = "";
  private listQuery: { getSnapshot(): { status: "loading" } | { status: "ready"; data: { files: FileOut[]; folders: FolderOut[] } } } | null = null;
  private recentQuery: { getSnapshot(): { status: "loading" } | { status: "ready"; data: { files: FileOut[] } } } | null = null;
  private trashQuery: { getSnapshot(): { status: "loading" } | { status: "ready"; data: { files: FileOut[]; folders: FolderOut[] } } } | null = null;

  constructor(options: FilesListOptions) {
    this.replica = options.replica;
    this.invoke = options.invoke;
    this.prefetch = options.prefetch;
    this.view = options.view ?? { mode: "folder", section: "personal" };
    this.spaceName = options.spaceName ?? "Northwind";
    this.skinId = options.skinId ?? "paper";
    this.width = options.width ?? 1280;
    this.viewport = options.viewport ?? 800;
    bindFilesList(this.replica);
    this.replica.subscribe(() => {
      this.cache = null;
    });
  }

  setView(view: FilesView): void {
    this.view = view;
    this.scrollTop = 0;
    this.selected = [];
    this.anchor = null;
    this.quickId = null;
    this.share = null;
    this.menuFor = null;
    this.listQuery = null;
    this.listKey = "";
    this.cache = null;
  }

  setFrame(frame: { spaceName?: string; skinId?: string; width?: number; viewport?: number }): void {
    if (frame.spaceName) this.spaceName = frame.spaceName;
    if (frame.skinId) this.skinId = frame.skinId;
    if (frame.width) this.width = frame.width;
    if (frame.viewport) this.viewport = frame.viewport;
  }

  setLink(link: ListPaint["link"]): void {
    this.link = link;
  }

  setScroll(scrollTop: number): void {
    this.scrollTop = Math.max(0, scrollTop);
  }

  select(id: string, mods?: { shift?: boolean; meta?: boolean }): void {
    const order = this.all().entries.map((entry) => entry.id);
    if (mods?.shift && this.anchor) {
      const from = order.indexOf(this.anchor);
      const to = order.indexOf(id);
      if (from >= 0 && to >= 0) {
        const lo = Math.min(from, to);
        const hi = Math.max(from, to);
        this.selected = order.slice(lo, hi + 1);
        return;
      }
    }
    if (mods?.meta) {
      this.selected = this.selected.includes(id) ? this.selected.filter((item) => item !== id) : [...this.selected, id];
      this.anchor = id;
      return;
    }
    this.selected = [id];
    this.anchor = id;
  }

  hover(id: string | null): void {
    this.hovered = id;
    if (!id || !this.prefetch) return;
    const file = this.all().files.get(id);
    if (!file) return;
    this.prefetch("files.viewer", { fileId: file.fileId });
  }

  dragStart(fileIds?: readonly string[]): void {
    const chosen = fileIds ?? this.selected;
    const ids = chosen.filter((id) => this.all().files.has(id));
    this.drag = { fileIds: ids, overFolderId: null, overSince: 0 };
    this.sprung = null;
  }

  dragOver(folderId: string, now: number): void {
    if (!this.drag) this.dragStart();
    if (!this.drag) return;
    if (this.drag.overFolderId !== folderId) {
      this.drag = { fileIds: this.drag.fileIds, overFolderId: folderId, overSince: now };
      this.sprung = null;
    }
  }

  /** Opens the hovered folder once the spring-load delay has elapsed. The file stays in the drag. */
  tick(now: number): void {
    if (!this.drag?.overFolderId) return;
    if (this.sprung === this.drag.overFolderId) return;
    if (now - this.drag.overSince < SPRING_LOAD_MS) return;
    this.sprung = this.drag.overFolderId;
    this.openFolder(this.drag.overFolderId, true);
  }

  drop(folderId: string): void {
    const ids = this.drag?.fileIds ?? this.selected.filter((id) => this.all().files.has(id));
    for (const fileId of ids) {
      if (!applyMove(this.replica, fileId, folderId)) continue;
      this.emit("files.move", { fileId, toFolderId: folderId });
    }
    this.drag = null;
    this.sprung = null;
  }

  dragEnd(): void {
    this.drag = null;
    this.sprung = null;
  }

  openFolder(folderId: string, keepDrag = false): void {
    const section = this.all().folderSection.get(folderId);
    const next: FilesView = section ? { mode: "folder", folderId, section } : { mode: "folder", folderId };
    const dragging = this.drag;
    this.view = next;
    this.scrollTop = 0;
    this.listQuery = null;
    this.listKey = "";
    this.cache = null;
    this.quickId = null;
    if (keepDrag && dragging) this.drag = dragging;
    else this.drag = null;
  }

  quickLook(fileId?: string): void {
    const id = fileId ?? this.selected.find((item) => this.all().files.has(item)) ?? null;
    this.quickId = this.quickId === id ? null : id;
  }

  closeQuickLook(): void {
    this.quickId = null;
  }

  key(key: string): void {
    if (key === " " || key === "Space") {
      this.quickLook();
      return;
    }
    if (key === "Escape") {
      this.quickId = null;
      this.share = null;
      this.menuFor = null;
      this.drag = null;
      this.sprung = null;
    }
  }

  openMenu(id: string): void {
    this.menuFor = id;
  }

  openShare(target: { kind: "file" | "folder"; id: string }): void {
    const cached = this.all();
    const name = target.kind === "folder"
      ? cached.folders.get(target.id)?.name ?? target.id
      : cached.files.get(target.id)?.name ?? target.id;
    const props: ShareSheetProps = {
      resourceType: target.kind === "folder" ? "folder" : "file",
      resourceId: target.id,
      resourceName: name,
      target: target.kind === "folder" ? "folder" : "item",
      ownerName: "You",
      levels: ["view", "use", "edit", "manage"] as const,
      shares: [],
      allowExternal: false,
      density: this.width < 800 ? "compact" : "regular",
    };
    this.share = props;
  }

  confirmShare(subject: { kind: ShareSubjectKind; id: string }, level: ShareLevel): void {
    if (!this.share) return;
    if (this.share.target === "folder") {
      this.emit("access.share", {
        resource: { type: "folder", id: this.share.resourceId },
        subject,
        level,
      });
    } else {
      this.emit("files.share", { fileId: this.share.resourceId, subject, level });
    }
    this.share = null;
  }

  closeShare(): void {
    this.share = null;
  }

  html(): string {
    const cached = this.all();
    const springFolderId = this.drag?.overFolderId ?? null;
    let spring: ListPaint["spring"] = "idle";
    if (springFolderId && this.sprung === springFolderId) spring = "open";
    else if (springFolderId) spring = "arming";
    const quick = this.quickOf(cached);
    const paint: ListPaint = {
      spaceName: this.spaceName,
      skinId: this.skinId,
      width: this.width,
      viewport: this.viewport,
      scrollTop: this.scrollTop,
      mode: this.view.mode,
      title: this.title(cached),
      link: this.link,
      entries: cached.entries,
      selected: this.selected,
      hovered: this.hovered,
      springFolderId,
      spring,
      quickLook: quick,
      share: this.share,
      menuFor: this.menuFor,
    };
    if (this.view.mode === "folder" && this.view.section) paint.section = this.view.section;
    if (this.view.mode === "shared") paint.section = "shared";
    if (this.view.mode === "folder" && this.view.folderId) paint.folderId = this.view.folderId;
    return renderFilesList(paint);
  }

  private title(cached: Cache): string {
    if (this.view.mode === "recent") return "Recent";
    if (this.view.mode === "shared") return "Shared with me";
    if (this.view.mode === "trash") return "Trash";
    if (this.view.mode === "knowledge") return this.view.key === "graph" ? "Graph" : "Memory";
    if (this.view.folderId) return cached.folders.get(this.view.folderId)?.name ?? "Files";
    return "Files";
  }

  private quickOf(cached: Cache): QuickLook | null {
    if (!this.quickId) return null;
    const file = cached.files.get(this.quickId);
    if (!file) return null;
    return { fileId: file.fileId, name: file.name, kind: file.kind, size: file.size, mime: file.mime };
  }

  private all(): Cache {
    const version = this.replica.version();
    const key = viewKey(this.view);
    if (this.cache && this.cache.version === version && this.cache.key === key) return this.cache;
    const cache = this.load();
    this.cache = cache;
    return cache;
  }

  private load(): Cache {
    const listed = this.read();
    const stored = collect(this.replica);
    const via = new Map<string, Via>();
    for (const file of stored.files) via.set(file.fileId, file.via);
    const folderSection = new Map<string, Section>();
    for (const folder of stored.folders) folderSection.set(folder.folderId, folder.section);
    const files = new Map<string, FileOut>();
    const folders = new Map<string, FolderOut>();
    const entries: ListEntry[] = [];
    for (const folder of listed.folders) {
      folders.set(folder.folderId, folder);
      const storedFolder = stored.folders.find((row) => row.folderId === folder.folderId);
      entries.push({
        id: folder.folderId,
        entry: "folder",
        name: folder.name,
        note: "Folder",
        kind: "folder",
        size: 0,
        via: storedFolder?.via ?? "owner",
      });
    }
    for (const file of listed.files) {
      files.set(file.fileId, file);
      entries.push({
        id: file.fileId,
        entry: "file",
        name: file.name,
        note: file.kind,
        kind: file.kind,
        size: file.size,
        via: via.get(file.fileId) ?? "owner",
      });
    }
    return { version: this.replica.version(), key: viewKey(this.view), entries, files, folders, via, folderSection };
  }

  private read(): { files: FileOut[]; folders: FolderOut[] } {
    if (this.view.mode === "knowledge") return { files: EMPTY_FILES, folders: EMPTY_FOLDERS };
    if (this.view.mode === "recent") {
      if (!this.recentQuery) this.recentQuery = liveQuery(this.replica, "files.recent", { limit: 200 });
      const snap = this.recentQuery.getSnapshot();
      return snap.status === "ready" ? { files: snap.data.files, folders: EMPTY_FOLDERS } : { files: EMPTY_FILES, folders: EMPTY_FOLDERS };
    }
    if (this.view.mode === "trash") {
      if (!this.trashQuery) this.trashQuery = liveQuery(this.replica, "files.trash.list", {});
      const snap = this.trashQuery.getSnapshot();
      return snap.status === "ready" ? { files: snap.data.files, folders: snap.data.folders } : { files: EMPTY_FILES, folders: EMPTY_FOLDERS };
    }
    const key = viewKey(this.view);
    if (!this.listQuery || this.listKey !== key) {
      this.listKey = key;
      this.listQuery = liveQuery(this.replica, "files.list", queryFor(this.view));
    }
    const snap = this.listQuery.getSnapshot();
    return snap.status === "ready" ? { files: snap.data.files, folders: snap.data.folders } : { files: EMPTY_FILES, folders: EMPTY_FOLDERS };
  }

  private emit(cap: string, input: Record<string, unknown>): void {
    const call = { cap, input };
    this.calls.push(call);
    this.invoke?.(call);
  }
}
