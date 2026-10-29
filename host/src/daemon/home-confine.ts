// What a computer that joined may do in an agent's home, decided here and never by the computer. A job's token lets the node's home mirror call a few Files, agents and tasks capabilities as the agent;
// the agent can reach more than its home (shared client folders, other people's files), so a call is allowed only when everything it names is the agent's own home folder (Agents/<name>) or inside it.
// Ancestry is read from the Files tables on this server; nothing the node says about where a file lives is believed. Unknown shapes are refused.
import type { HostDb } from "./sqlite.ts";

const MAX_DEPTH = 64;
type In = Record<string, unknown>;
const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 && v.length <= 80 ? v : null);

export interface HomeScope { homeFolder: string; ownerId: string; agentId: string }

export function homeScopeOf(db: Pick<HostDb, "all">, agentId: string): HomeScope | null {
  const r = db.all("SELECT folderId, ownerId FROM agents_agent WHERE id = ? AND deletedAt IS NULL", agentId)[0] as { folderId?: string; ownerId?: string } | undefined;
  return r?.folderId && r.ownerId ? { homeFolder: r.folderId, ownerId: r.ownerId, agentId } : null;
}

/** Is this folder the home folder, or below it? Walks parents on this server, bounded. */
function folderInside(db: Pick<HostDb, "all">, scope: HomeScope, folderId: string | null): boolean {
  let at = folderId;
  for (let depth = 0; at !== null && depth < MAX_DEPTH; depth++) {
    if (at === scope.homeFolder) return true;
    const row = db.all("SELECT parent_id FROM files_folder WHERE id = ?", at)[0] as { parent_id?: string | null } | undefined;
    if (!row) return false;
    at = row.parent_id ?? null;
  }
  return false;
}
function fileInside(db: Pick<HostDb, "all">, scope: HomeScope, fileId: string | null): boolean {
  if (!fileId) return false;
  const row = db.all("SELECT folder_id FROM files_file WHERE id = ?", fileId)[0] as { folder_id?: string } | undefined;
  return !!row?.folder_id && folderInside(db, scope, row.folder_id);
}

/** True when this call, with this input, stays inside the agent's home. */
export function homeCallAllowed(db: Pick<HostDb, "all">, scope: HomeScope, cap: string, input: unknown): boolean {
  const i: In = input && typeof input === "object" && !Array.isArray(input) ? (input as In) : {};
  switch (cap) {
    case "files.list": return folderInside(db, scope, str(i["folder"]) ?? str(i["folderId"]));
    case "files.read": case "files.write": case "files.delete": return fileInside(db, scope, str(i["fileId"]));
    case "files.create": return folderInside(db, scope, str(i["folderId"]));
    case "files.folder.create": return folderInside(db, scope, str(i["parentId"]));
    case "files.upload_url": return true;   // a slot for bytes: it names no file; the write that uses it is checked above
    case "agents.get": case "agents.suggestion.propose": return i["agentId"] === scope.agentId;
    case "tasks.create": {
      const assigned = i["assigned"] as { kind?: unknown; id?: unknown } | undefined;
      const files = Array.isArray(i["fileIds"]) ? (i["fileIds"] as unknown[]) : [];
      return assigned?.kind === "person" && assigned.id === scope.ownerId && files.length <= 20 && files.every((f) => fileInside(db, scope, str(f)));
    }
    default: return false;
  }
}
