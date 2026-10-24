// Recent list folded from the file events. Handlers write the same row on the call.
// Replay is idempotent: a newer at wins, and a second pass leaves one row per actor and file.

export interface ProjTx {
  all(sql: string, ...args: unknown[]): unknown[];
  run(sql: string, ...args: unknown[]): { changes: number };
}

export interface ProjEvent {
  at: number;
  actor: string;
  payload: Uint8Array;
}

interface RecentRow { at?: unknown }

function fileIdOf(payload: Uint8Array): string | null {
  try {
    const parsed = JSON.parse(new TextDecoder().decode(payload)) as { fileId?: unknown };
    return typeof parsed.fileId === "string" && parsed.fileId.length > 0 ? parsed.fileId : null;
  } catch {
    return null;
  }
}

export function touchRecent(db: ProjTx, fileId: string, actor: string, at: number): void {
  const rows = db.all("SELECT * FROM files_recent WHERE actor = ? AND file_id = ?", actor, fileId) as RecentRow[];
  const current = rows[0];
  if (current) {
    const prev = typeof current.at === "number" ? current.at : 0;
    if (at >= prev) db.run("UPDATE files_recent SET at = ? WHERE actor = ? AND file_id = ?", at, actor, fileId);
    return;
  }
  db.run("INSERT INTO files_recent (actor, file_id, at) VALUES (?, ?, ?)", actor, fileId, at);
}

export function dropRecent(db: ProjTx, fileId: string): void {
  db.run("DELETE FROM files_recent WHERE file_id = ?", fileId);
}

function touch(tx: ProjTx, e: ProjEvent): void {
  const fileId = fileIdOf(e.payload);
  if (!fileId) return;
  touchRecent(tx, fileId, e.actor, e.at);
}

function drop(tx: ProjTx, e: ProjEvent): void {
  const fileId = fileIdOf(e.payload);
  if (!fileId) return;
  dropRecent(tx, fileId);
}

export const recentProjection = {
  name: "files.recent",
  version: 1,
  mode: "inline" as const,
  rebuild: "replay" as const,
  reset(tx: ProjTx): void {
    tx.run("DELETE FROM files_recent");
  },
  on: {
    "file.created": touch,
    "file.version_added": touch,
    "file.restored": touch,
    "file.deleted": drop,
    "file.purged": drop,
  },
};

export const inline = { "files.recent": recentProjection };
export const consumers = {};
