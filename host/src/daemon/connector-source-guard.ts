// The Files mutation guard for connector sources. A connector's editable source is a folder in Shared knowledge, and an ordinary Member inherits Space edit there, so Files permission alone would let
// any Member rewrite code that later runs with a connection's credentials. For every Files call that could change a mapped source folder, its subtree, or a folder above it (a move, rename or delete
// of an ancestor takes the source with it), this asks one more question on top of the normal Files authorization the pipeline already did: may the original caller edit that connector
// (connectors.manage at Edit on the connector)? Both must hold; neither replaces the other. The guard reads the Files and connector tables directly and decides nothing by name or path.
// While a connector is being created (its mapping exists, its row and resource do not yet) only the person who created the mapping may write, and only with connectors.manage Edit on the Space.
import type { Req as AuthReq } from "../../../kernel/src/authorize/index.ts";
import type { CtxSeed } from "../invoke.ts";

type Row = Record<string, unknown>;
export interface SourceGuardDeps {
  /** the Files tables (the module database) */
  db: { all(sql: string, ...args: unknown[]): unknown[] };
  /** the connector tables (cn_*), which live in the Space store, not beside the Files tables */
  connectors: { all(sql: string, ...args: unknown[]): unknown[] };
  authorize(req: AuthReq): { effect: string };
  space: string;
}

const FILE_CAPS = new Set(["files.write", "files.save", "files.rename", "files.delete", "files.restore", "files.purge", "files.restore_version", "files.name_version", "files.comments.add", "files.markup.save"]);
const FILE_TARGET: Record<string, string> = { "files.move": "toFolderId", "files.copy": "toFolderId", "files.restore": "toFolderId" };
const FOLDER_TARGET: Record<string, string> = { "files.create": "folderId", "files.folder.create": "parentId", "files.upload_url": "folderId" };
const FOLDER_CAPS = new Set(["files.folder.rename", "files.folder.delete", "files.folder.restore", "files.folder.settings"]);
const CHANGESET_CAPS = new Set(["changesets.approve", "changesets.discard", "changesets.revert_change", "changesets.edit", "changesets.request_changes"]);
const MAX_DEPTH = 64;

export const isGuardedCap = (cap: string): boolean => FILE_CAPS.has(cap) || cap in FILE_TARGET || cap in FOLDER_TARGET || FOLDER_CAPS.has(cap) || CHANGESET_CAPS.has(cap) || cap === "files.move" || cap === "files.folder.move" || cap === "files.trash.empty";

export interface SourceGuard { check(a: { cap: string; input: unknown; seed: CtxSeed; now: number }): { key: string; reason: string } | null }

export function createSourceGuard(d: SourceGuardDeps): SourceGuard {
  const rows = (sql: string, ...args: unknown[]): Row[] => { try { return d.db.all(sql, ...args) as Row[]; } catch { return []; } };
  const one = (sql: string, ...args: unknown[]): Row | undefined => rows(sql, ...args)[0];
  const cn = (sql: string, ...args: unknown[]): Row[] => { try { return d.connectors.all(sql, ...args) as Row[]; } catch { return []; } };
  const str = (v: unknown): string => (typeof v === "string" ? v : "");
  const field = (input: unknown, name: string): string => str((input as Record<string, unknown> | null)?.[name]);

  /** A folder and every folder above it, nearest first. A cycle or a runaway chain ends the walk. */
  const chain = (folderId: string): string[] => {
    const out: string[] = [];
    let cur: string | undefined = folderId;
    while (cur && out.length < MAX_DEPTH && !out.includes(cur)) {
      out.push(cur);
      const r = one("SELECT parent_id FROM files_folder WHERE id = ?", cur);
      cur = r ? str(r["parent_id"]) || undefined : undefined;
    }
    return out;
  };
  const folderOfFile = (fileId: string): string => str(one("SELECT folder_id FROM files_file WHERE id = ?", fileId)?.["folder_id"]);

  return {
    check({ cap, input, seed, now }) {
      if (!isGuardedCap(cap)) return null;
      const mapped = cn("SELECT key, folder_id, created_by FROM cn_source_folders");
      if (mapped.length === 0) return null;
      // what the call touches: folders it changes inside (writes), and folders it changes as a whole (structure: the folder and everything below it)
      const inside = new Set<string>(), whole = new Set<string>();
      const fileId = field(input, "fileId");
      if (FILE_CAPS.has(cap) || cap === "files.move" || cap === "files.copy") { const f = fileId ? folderOfFile(fileId) : ""; if (f) inside.add(f); }
      const toFile = FILE_TARGET[cap]; if (toFile) { const t = field(input, toFile); if (t) inside.add(t); }
      const toFolder = FOLDER_TARGET[cap]; if (toFolder) { const t = field(input, toFolder); if (t) inside.add(t); }
      if (FOLDER_CAPS.has(cap) || cap === "files.folder.move") { const f = field(input, "folderId"); if (f) whole.add(f); }
      if (cap === "files.folder.move") { const t = field(input, "toParentId"); if (t) inside.add(t); }
      if (CHANGESET_CAPS.has(cap)) { const f = str(one("SELECT folder_id FROM files_changeset WHERE id = ?", field(input, "changesetId"))?.["folder_id"]); if (f) inside.add(f); }
      const emptiesTrash = cap === "files.trash.empty";
      const hits: Row[] = [];
      for (const m of mapped) {
        const source = str(m["folder_id"]);
        const sourceChain = chain(source);
        const touched = [...inside].some((f) => chain(f).includes(source))                 // a write into the source or below it
          || [...whole].some((f) => chain(f).includes(source) || sourceChain.includes(f))   // a structural change to the source, below it, or a folder above it
          || (emptiesTrash && rows("SELECT id FROM files_folder WHERE deleted_at IS NOT NULL").some((r) => chain(str(r["id"])).includes(source)));
        if (touched) hits.push(m);
      }
      if (hits.length === 0) return null;
      const who = seed.actingFor ?? seed.principal.id;
      for (const m of hits) {
        const key = str(m["key"]);
        const decide = (resource: { type: string; id: string }): boolean => d.authorize({
          principal: seed.principal.id, actingFor: seed.actingFor, provider: seed.provider, action: { perm: "connectors.manage", level: "edit" }, resource, now, cap, input,
        } as AuthReq).effect === "allow";
        const initializing = cn("SELECT 1 AS x FROM cn_connectors WHERE key = ?", key).length === 0;
        const allowed = initializing
          ? str(m["created_by"]) === who && decide({ type: "space", id: d.space })
          : decide({ type: "connector", id: key });
        if (!allowed) return { key, reason: "connector_source" };
      }
      return null;
    },
  };
}
