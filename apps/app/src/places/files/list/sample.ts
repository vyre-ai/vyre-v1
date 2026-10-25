// The sample Spaces behind the Files tests and the screenshots: Northwind (Personal, Shared with me and Space folders, files of every kind) and Harbor Studio, filled like the prototype's
// Files so a side by side reads the same. A fake replica holds the folders and files; every capability the tree and the list read is registered with a resolver over those rows, and the writes
// the list makes (move, delete, restore, rename) change the rows. `bulk` adds that many files to one folder: the long list the scroll probe runs over. The real replica is SQLite behind
// the same surface.
import { createFakeReplica, createScreenHooks, liveQuery } from "../../../../../../client/src/index.ts";
import type { FakeReplica, LiveQuery, QueryState, Row } from "../../../../../../client/src/index.ts";
import { screensById } from "../../../../../../generated/screens.ts";
import type { CapMap } from "../../../../../../generated/types.ts";
import type { FolderNode } from "../../../../../../ui/src/FolderTree/index.tsx";
import type { Connection, FilesData, FilesNav, LiveCap } from "../tree/data.tsx";
import type { FileKind, FileRow, FolderRow } from "../tree/model.ts";

export const SAMPLE_NOW = Date.UTC(2025, 9, 24, 10, 0, 0);
const HOUR = 3_600_000;
const DAY = 86_400_000;

export type Variant = "northwind" | "harbor";

interface FolderSeed { id: string; name: string; parent: string | null; section: "personal" | "shared" | "space"; shared?: boolean; knowledge?: boolean; git?: boolean }
interface FileSeed { id: string; name: string; folder: string; kind: FileKind; size: number; ago: number; by: string; source?: string; shared?: boolean; knowledge?: boolean }

interface ChangesetSeed { id: string; folder: string; by: string; files: number }

export interface SampleSpace { id: Variant; name: string; folders: FolderSeed[]; files: FileSeed[]; people: Record<string, string>; changesets?: ChangesetSeed[] }

const F = (id: string, name: string, parent: string | null, section: FolderSeed["section"], o: Partial<FolderSeed> = {}): FolderSeed => ({ id, name, parent, section, ...o });
const f = (id: string, name: string, folder: string, kind: FileKind, size: number, ago: number, by: string, o: Partial<FileSeed> = {}): FileSeed => ({ id, name, folder, kind, size, ago, by, ...o });

export const northwind: SampleSpace = {
  id: "northwind", name: "Northwind",
  people: { usr_irfad: "Irfad Imtiaz", usr_maya: "Maya Chen", usr_omar: "Omar Haddad", agt_docs: "Docs", agt_billing: "Billing" },
  folders: [
    F("fld_daily", "Daily", null, "personal"),
    F("fld_money", "Money", null, "personal"),
    F("fld_maya", "Maya's reports", null, "shared", { shared: true }),
    F("fld_sales", "Sales", null, "space"),
    F("fld_proposals", "Proposals", "fld_sales", "space"),
    F("fld_billing", "Billing", null, "space"),
    F("fld_intake", "Intake", null, "space"),
    F("fld_knowledge", "Knowledge", null, "space", { knowledge: true }),
  ],
  files: [
    f("fil_notes", "Notes 2025-10-24.md", "fld_daily", "markdown", 2_400, 0.5 * HOUR, "usr_irfad"),
    f("fil_budget", "Budget 2026.xlsx", "fld_money", "spreadsheet", 48_000, 5 * HOUR, "usr_irfad"),
    f("fil_q3", "Q3 report.pdf", "fld_maya", "pdf", 1_240_000, 26 * HOUR, "usr_maya", { shared: true }),
    f("fil_deck", "Pitch deck v4.pptx", "fld_sales", "presentation", 8_900_000, 2 * HOUR, "usr_omar"),
    f("fil_pricing", "Pricing sheet.xlsx", "fld_sales", "spreadsheet", 62_000, 30 * HOUR, "usr_omar"),
    f("fil_logo", "logo-northwind.png", "fld_sales", "image", 210_000, 9 * DAY, "usr_maya"),
    f("fil_rivera", "Rivera engagement letter.docx", "fld_proposals", "document", 31_000, 3 * HOUR, "agt_docs"),
    f("fil_harlow", "Harlow & Price worksheet.xlsx", "fld_proposals", "spreadsheet", 77_000, 2 * DAY, "usr_irfad", { source: "Google Drive" }),
    f("fil_inv", "Invoice 1042.pdf", "fld_billing", "pdf", 58_000, 6 * HOUR, "agt_billing"),
    f("fil_inv2", "Invoice 1041.pdf", "fld_billing", "pdf", 61_000, 30 * HOUR, "agt_billing"),
    f("fil_form", "Intake form.pdf", "fld_intake", "pdf", 184_000, 4 * DAY, "usr_maya"),
    f("fil_script", "sync-clients.ts", "fld_intake", "code", 5_100, 3 * DAY, "usr_omar"),
    f("fil_vyre", "VYRE.md", "fld_knowledge", "markdown", 3_800, 12 * HOUR, "usr_irfad", { knowledge: true }),
    f("fil_voice", "Brand voice.md", "fld_knowledge", "markdown", 6_100, 5 * DAY, "agt_docs", { knowledge: true }),
  ],
  // Docs staged three writes in Proposals and nothing is saved until they are approved (the prototype's Rivera matter banner)
  changesets: [{ id: "chg_docs", folder: "fld_proposals", by: "agt_docs", files: 3 }],
};

export const harbor: SampleSpace = {
  id: "harbor", name: "Harbor Studio",
  people: { usr_irfad: "Irfad Imtiaz", usr_ines: "Ines Costa" },
  folders: [F("fld_h_clients", "Clients", null, "space"), F("fld_h_assets", "Assets", null, "space")],
  files: [
    f("fil_h_logo", "Moreno logo round two.png", "fld_h_clients", "image", 540_000, 3 * HOUR, "usr_ines"),
    f("fil_h_copy", "Abel homepage copy.docx", "fld_h_clients", "document", 22_000, 27 * HOUR, "usr_irfad"),
    f("fil_h_type", "Typefaces.zip", "fld_h_assets", "archive", 12_500_000, 6 * DAY, "usr_ines"),
  ],
};

const fileRow = (s: FileSeed): FileRow & Row => ({
  id: s.id, fileId: s.id, folderId: s.folder, name: s.name, kind: s.kind, mime: "application/octet-stream", size: s.size, version: 1, label: 1, ownerId: s.by,
  createdAt: SAMPLE_NOW - s.ago - DAY, updatedAt: SAMPLE_NOW - s.ago, updatedBy: s.by, ...(s.source ? { source: { mountId: "mnt_1", provider: s.source } } : {}), thumb: s.kind === "image", holds: 0,
  ...({ shared: s.shared === true, knowledge: s.knowledge === true } as Record<string, unknown>),
});

const VIA: Record<FolderSeed["section"], FolderNode["via"]> = { personal: "owner", shared: "grant", space: "space" };

export interface SampleFiles {
  data: FilesData;
  replica: FakeReplica;
  /** every capability the list called, in order */
  calls: { cap: string; input: unknown }[];
  /** what the nav handlers were asked to open */
  opened: string[];
  /** every press of the pane toggle */
  paneToggles: number;
  setOnline(online: boolean): void;
}

type Seeded = FileRow & { deletedAt?: number; shared?: boolean; knowledge?: boolean };
type FolderSeedRow = FolderSeed & Row;

export function createSampleFiles(space: SampleSpace = northwind, o: { online?: boolean; bulk?: number } = {}): SampleFiles {
  const replica = createFakeReplica(space.id);
  const calls: { cap: string; input: unknown }[] = [];
  const opened: string[] = [];
  let online = o.online ?? true;
  const listeners = new Set<() => void>();

  replica.put("folders", space.folders.map((x): FolderSeedRow => ({ ...x, id: x.id })));
  replica.put("changesets", (space.changesets ?? []).map((c) => ({ id: c.id, changesetId: c.id, folderId: c.folder, state: "open", by: c.by, fileCount: c.files, added: c.files * 12, removed: 0, openedAt: SAMPLE_NOW - HOUR, pushPending: false }) as Row));
  const files: Row[] = space.files.map((x) => fileRow(x));
  if (o.bulk) {
    const target = space.folders.find((x) => x.section === "space")?.id ?? space.folders[0]!.id;
    for (let i = 0; i < o.bulk; i++) files.push(fileRow({ id: `bulk${i}`, name: `Scan ${String(i).padStart(5, "0")}.pdf`, folder: target, kind: i % 4 === 0 ? "image" : "pdf", size: 10_000 + (i * 37) % 900_000, ago: HOUR + i * 60_000, by: "usr_irfad" }));
  }
  replica.put("files", files);

  const allFiles = (): Seeded[] => replica.rows("files") as unknown as Seeded[];
  const allFolders = (): FolderSeedRow[] => replica.rows("folders") as unknown as FolderSeedRow[];
  const live = (x: Seeded): boolean => x.deletedAt === undefined;
  const folderRow = (x: FolderSeed): FolderRow => {
    const kids = allFolders().filter((k) => k.parent === x.id).length;
    const n = allFiles().filter((fl) => live(fl) && fl.folderId === x.id).length;
    return { folderId: x.id, ...(x.parent ? { parentId: x.parent } : {}), name: x.name, path: x.name, fileCount: n, folderCount: kids, scope: x.section === "space" ? "space" : "personal", label: 1, git: x.git === true, reviewChanges: false };
  };
  const strip = (x: Seeded): FileRow => { const { shared: _s, knowledge: _k, ...rest } = x as Seeded & Record<string, unknown>; void _s; void _k; return rest as unknown as FileRow; };

  replica.resolve("files.list", (_t, i) => {
    const parent = i.folder ?? null;
    const folders = allFolders().filter((x) => x.parent === parent).map(folderRow);
    const list = parent === null ? [] : allFiles().filter((x) => live(x) && x.folderId === parent && (!i.kind || x.kind === i.kind)).map(strip);
    return { files: list, folders, total: list.length + folders.length };
  });
  replica.resolve("files.recent", (_t, i) => ({ files: allFiles().filter(live).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, i.limit ?? 50).map(strip) }));
  replica.resolve("files.shared_with_me", () => ({
    files: allFiles().filter((x) => live(x) && x.shared === true).map(strip),
    folders: allFolders().filter((x) => x.shared === true).map(folderRow), total: 0,
  }));
  replica.resolve("files.knowledge", () => ({
    files: allFiles().filter((x) => live(x) && x.knowledge === true).map(strip),
    folders: allFolders().filter((x) => x.knowledge === true).map(folderRow), total: 0,
  }));
  replica.resolve("files.trash.list", () => ({ files: allFiles().filter((x) => !live(x)).map(strip), folders: [], total: 0 }));
  replica.resolve("changesets.list", (_t, i) => {
    const rows = replica.rows("changesets") as unknown as (CapMap["changesets.list"]["out"]["changesets"][number] & { id: string })[];
    const list = rows.filter((c) => (i.folderId === undefined || c.folderId === i.folderId) && (i.state === undefined || c.state === i.state)).map(({ id: _id, ...c }) => c);
    return { changesets: list, total: list.length };
  });
  replica.resolve("files.tree", () => ({
    roots: [
      { key: "recent", title: "Recent", kind: "virtual" as const, count: allFiles().filter(live).length },
      { key: "shared", title: "Shared with me", kind: "virtual" as const, count: allFiles().filter((x) => live(x) && x.shared === true).length },
      { key: "trash", title: "Trash", kind: "virtual" as const, count: allFiles().filter((x) => !live(x)).length },
      ...allFolders().filter((x) => x.parent === null).map((x) => ({ key: x.id, title: x.name, kind: "folder" as const, folderId: x.id, count: folderRow(x).fileCount })),
    ],
  }));

  // the folder tree comes from the local copy: every folder with its section, how it was reached and how many files it holds
  let cached: { at: number; snap: QueryState<readonly FolderNode[]> } = { at: -1, snap: { status: "loading" } };
  const folders: LiveQuery<readonly FolderNode[]> = {
    subscribe: (l) => replica.subscribe(l),
    getSnapshot() {
      if (cached.at === replica.version()) return cached.snap;
      const nodes: FolderNode[] = allFolders().map((x) => ({
        id: x.id, name: x.name, parentId: x.parent, count: allFiles().filter((fl) => live(fl) && fl.folderId === x.id).length, scope: x.section === "space" ? "space" : "personal", section: x.section, via: VIA[x.section], open: false,
      }));
      cached = { at: replica.version(), snap: { status: "ready", data: nodes } };
      return cached.snap;
    },
  };

  const patchFile = (id: string, patch: Partial<Seeded>): void => {
    const cur = allFiles().find((x) => x.fileId === id);
    if (!cur) throw new Error(`no such file ${id}`);
    replica.put("files", [{ ...cur, ...patch, id: cur.fileId, updatedAt: SAMPLE_NOW } as unknown as Row]);
  };
  const writes: Record<string, (i: never) => unknown> = {
    "files.move": (i: { fileId: string; toFolderId: string }) => { patchFile(i.fileId, { folderId: i.toFolderId }); return { file: allFiles().find((x) => x.fileId === i.fileId) }; },
    "files.rename": (i: { fileId: string; name: string }) => { patchFile(i.fileId, { name: i.name }); return { file: allFiles().find((x) => x.fileId === i.fileId) }; },
    "files.delete": (i: { fileId: string }) => { patchFile(i.fileId, { deletedAt: SAMPLE_NOW }); return { ok: true }; },
    "files.restore": (i: { fileId: string }) => {
      const cur = allFiles().find((x) => x.fileId === i.fileId);
      if (cur) { const { deletedAt: _d, ...rest } = cur; void _d; replica.remove("files", [cur.fileId]); replica.put("files", [{ ...rest, id: rest.fileId } as unknown as Row]); }
      return { ok: true };
    },
    "folders.move": (i: { folderId: string; parentId: string | null }) => {
      const cur = allFolders().find((x) => x.id === i.folderId);
      if (cur) replica.put("folders", [{ ...cur, parent: i.parentId }]);
      return { ok: true };
    },
    "folders.delete": (i: { folderId: string }) => { replica.remove("folders", [i.folderId]); return { ok: true }; },
    "changesets.approve": (i: { changesetId: string }) => {
      const cur = (replica.rows("changesets") as unknown as { id: string }[]).find((c) => c.id === i.changesetId);
      if (cur) replica.put("changesets", [{ ...cur, state: "approved" } as unknown as Row]);
      return { ok: true };
    },
  };

  const nav: FilesNav = {
    openFile: (id) => void opened.push(`file:${id}`),
    shareFolder: (id) => void opened.push(`share:${id}`),
    renameEntry: (kind, id) => void opened.push(`rename:${kind}:${id}`),
    newFolder: (scope, parent) => void opened.push(`new-folder:${scope}:${parent ?? "root"}`),
    openMemory: () => void opened.push("memory"),
    openGraph: () => void opened.push("graph"),
    upload: (folderId) => void opened.push(`upload:${folderId ?? "root"}`),
    reviewChanges: (id) => void opened.push(`review:${id}`),
  };
  const result: SampleFiles = { data: undefined as unknown as FilesData, replica, calls, opened, paneToggles: 0, setOnline(v) { online = v; for (const l of [...listeners]) l(); } };
  const connection: Connection = { get: () => (online ? "online" : "offline"), subscribe: (l) => { listeners.add(l); return () => void listeners.delete(l); } };

  const data: FilesData = {
    screens: createScreenHooks(replica, screensById),
    live<C extends LiveCap>(cap: C, input: CapMap[C]["in"]): LiveQuery<CapMap[C]["out"]> { return liveQuery(replica, cap, input); },
    folders,
    async call(cap, input) {
      calls.push({ cap, input });
      const w = writes[cap];
      if (!w) throw new Error(`unknown capability ${cap}`);
      return w(input as never);
    },
    connection, nav,
    pane: { open: true, toggle: () => { result.paneToggles += 1; } },
    clock: () => ({ now: SAMPLE_NOW, offsetMin: 0 }),
    nameOf: (id) => space.people[id] ?? id,
  };
  result.data = data;
  return result;
}
