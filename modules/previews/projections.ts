// previews projections. The consumer of file.version_added only queues the version (a save is never held up by a preview); previews.render, or the first read of a preview, makes it and takes it off the queue.
// file.purged drops everything made for the file (its image blobs are listed in previews_gc for the next render pass). Replay is idempotent: a version is queued once.

export interface ProjTx {
  all(sql: string, ...args: unknown[]): unknown[];
  run(sql: string, ...args: unknown[]): { changes: number };
}

export interface ProjEvent {
  at: number;
  actor: string;
  payload: Uint8Array;
}

type Row = Record<string, unknown>;

function payloadOf(payload: Uint8Array): Row {
  try {
    const parsed: unknown = JSON.parse(new TextDecoder().decode(payload));
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? (parsed as Row) : {};
  } catch {
    return {};
  }
}

export function queueVersion(tx: ProjTx, fileId: string, version: number, at: number): void {
  if (fileId === "" || !Number.isInteger(version) || version < 1) return;
  const have = (tx.all("SELECT * FROM previews_queue WHERE file_id = ?", fileId) as Row[]).some((r) => r["version"] === version);
  const done = (tx.all("SELECT * FROM previews_file WHERE file_id = ?", fileId) as Row[]).some((r) => r["version"] === version && r["state"] === "ready");
  if (have || done) return;
  tx.run("INSERT INTO previews_queue (file_id, version, queued_at) VALUES (?, ?, ?)", fileId, version, at);
}

function onVersionAdded(tx: ProjTx, e: ProjEvent): void {
  const p = payloadOf(e.payload);
  queueVersion(tx, typeof p["fileId"] === "string" ? p["fileId"] : "", typeof p["n"] === "number" ? p["n"] : 0, e.at);
}

function onPurged(tx: ProjTx, e: ProjEvent): void {
  const fileId = payloadOf(e.payload)["fileId"];
  if (typeof fileId !== "string" || fileId === "") return;
  tx.run("DELETE FROM previews_queue WHERE file_id = ?", fileId);
  // the blobs cannot be deleted from a projection: their ids go to previews_gc and the next render pass collects them
  for (const r of tx.all("SELECT * FROM previews_image WHERE file_id = ?", fileId) as Row[]) {
    const id = r["blob_id"];
    if (typeof id !== "string" || id === "") continue;
    if ((tx.all("SELECT * FROM previews_gc WHERE blob_id = ?", id) as Row[]).length === 0) tx.run("INSERT INTO previews_gc (blob_id, queued_at) VALUES (?, ?)", id, e.at);
  }
  tx.run("DELETE FROM previews_image WHERE file_id = ?", fileId);
  tx.run("DELETE FROM previews_file WHERE file_id = ?", fileId);
}

export const versionConsumer = {
  name: "previews.versions",
  version: 1,
  mode: "async" as const,
  rebuild: "replay" as const,
  on: { "file.version_added": onVersionAdded, "file.purged": onPurged } as Record<string, (tx: ProjTx, e: ProjEvent) => void>,
};

export const inline = {};
export const consumers = { "previews.versions": versionConsumer };
