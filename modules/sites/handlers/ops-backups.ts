// Backups of a site's own Postgres (r42-sites-run, slice 5): a gzipped dump kept on the server (ctx.blobs, readable by whoever can see the site), listed with its size, trimmed by ops/backups.ts, restorable.
// A backup runs in the background of the call that asked for it; the row says queued, running, then ready or failed with one sentence. After a restart a backup still marked running is failed (ops/backups.ts).
// The dump is made inside the Postgres container (pg_dump over its own socket, gzip) and read out of /tmp/vyre-backup.gz, so no password and no connection string leave the site's network.
import type { Ctx } from "../../../packages/contracts/src/ctx.ts";
import { fail, isNull, mustSite, nid, one, optBool, rec, reqStr, str } from "./deploy.ts";
import { siteRunner } from "./route.ts";
import { expired, stepBackup } from "../ops/backups.ts";
import type { Backup, BackupEvent } from "../ops/backups.ts";
import * as st from "../ops/store.ts";

type Db = Ctx["db"];
const DUMP = "/tmp/vyre-backup.gz";
const SIZE_CMD = ["psql", "-U", "app", "-d", "app", "-tAc", "select pg_database_size('app')"];
const DUMP_CMD = ["sh", "-c", `set -o pipefail 2>/dev/null; pg_dump -U app -d app --no-owner | gzip > ${DUMP}`];
const RESTORE_CMD = [
  "sh",
  "-c",
  `psql -U app -d postgres -v ON_ERROR_STOP=1 -q -c "DROP DATABASE IF EXISTS app WITH (FORCE)" -c "CREATE DATABASE app OWNER app" && gunzip -c /tmp/vyre-restore.gz | psql -U app -d app -v ON_ERROR_STOP=1 -q`,
];
/** A dump bigger than this is not kept here; the sentence says to dump it by hand. */
export const MAX_BACKUP_BYTES = 512 * 1024 * 1024;
const running = new Set<string>();

export interface BackupOut {
  backupId: string;
  siteId: string;
  state: string;
  by: string;
  at: number;
  endedAt?: number;
  bytes?: number;
  note?: string;
  pinned?: boolean;
}
const out = (b: Backup): BackupOut => ({
  backupId: b.id,
  siteId: b.siteId,
  state: b.state,
  by: b.by,
  at: b.at,
  ...(b.endedAt !== undefined ? { endedAt: b.endedAt } : {}),
  ...(b.bytes !== undefined ? { bytes: b.bytes } : {}),
  ...(b.note ? { note: b.note } : {}),
  ...(b.pinned ? { pinned: true } : {}),
});

function postgres(ctx: Ctx, siteId: string): string | null {
  const a = one(ctx, "SELECT * FROM sites_addon WHERE site_id = ? AND kind = ?", siteId, "postgres");
  return a && a.state === "ready" && !isNull(a.container_id) ? str(a.container_id) : null;
}

function move(db: Db, b: Backup, ev: BackupEvent): Backup {
  const s = stepBackup(b, ev);
  if (!s.ok || s.same) return b;
  st.saveBackup(db, s.backup, b.state);
  return s.backup;
}

const lastLine = (text: string): string =>
  text
    .trim()
    .split("\n")
    .slice(-1)[0]
    ?.replace(/^(pg_dump|psql|sh):\s*(error:\s*)?/i, "")
    .slice(0, 160) ?? "";

/** The work of one backup. Never throws: every end is a row. */
export async function runBackup(ctx: Ctx, b0: Backup, container: string): Promise<void> {
  const r = siteRunner();
  const db = ctx.db;
  let b = b0;
  const stop = async (note: string): Promise<void> => {
    move(db, b, { t: "fail", at: ctx.now(), note });
  };
  try {
    if (!r) return await stop("This server cannot reach the database.");
    if (!ctx.blobs) return await stop("This server cannot keep backups.");
    b = move(db, b, { t: "start", at: ctx.now() });
    const made = await r.exec(container, DUMP_CMD, {});
    if (made.code !== 0) return await stop(`The dump failed: ${lastLine(made.out) || "the database did not answer"}.`);
    const bytes = await r.getFile(container, DUMP);
    await r.exec(container, ["rm", "-f", DUMP], {}).catch(() => undefined);
    if (bytes.length > MAX_BACKUP_BYTES)
      return await stop(
        `The dump is ${Math.round(bytes.length / 1048576)} MB, more than the ${MAX_BACKUP_BYTES / 1048576} MB kept here. Dump it from the database's own address instead.`,
      );
    const blob = await ctx.blobs.put(bytes, "application/gzip", { resource: { type: "site", id: b.siteId } });
    move(db, b, { t: "done", at: ctx.now(), bytes: bytes.length, fileId: blob.id });
    // old ones go, never the newest
    const gone = expired(st.listBackups(db, b.siteId), ctx.now());
    await removeBackups(ctx, gone);
  } catch (e) {
    await stop(`The backup stopped: ${(e instanceof Error ? e.message : String(e)).slice(0, 160)}`);
  } finally {
    running.delete(b0.id);
  }
}

async function removeBackups(ctx: Ctx, ids: readonly string[]): Promise<void> {
  for (const id of ids) {
    const b = st.getBackup(ctx.db, id);
    if (b?.fileId) await ctx.blobs?.delete(b.fileId).catch(() => false);
  }
  st.deleteBackups(ctx.db, ids);
}

async function backupsList(
  ctx: Ctx,
  input: unknown,
): Promise<{ backups: BackupOut[]; database?: { bytes?: number }; hasDatabase: boolean }> {
  const o = rec(ctx, input);
  const site = mustSite(ctx, reqStr(ctx, o, "siteId"));
  const siteId = str(site.id);
  const list = st.listBackups(ctx.db, siteId);
  // a backup still marked running that this process is not running was cut off by a restart
  for (const b of list)
    if ((b.state === "running" || b.state === "queued") && !running.has(b.id))
      move(
        ctx.db,
        b,
        b.state === "queued"
          ? { t: "fail", at: ctx.now(), note: "The server restarted before it began. Back up again." }
          : { t: "lost", at: ctx.now() },
      );
  const container = postgres(ctx, siteId);
  let bytes: number | undefined;
  const r = siteRunner();
  if (container && r) {
    try {
      const size = await r.exec(container, SIZE_CMD, {});
      const n = Number(size.out.trim().split("\n").slice(-1)[0]);
      if (size.code === 0 && Number.isFinite(n)) bytes = n;
    } catch {
      /* the size is a nicety */
    }
  }
  return {
    backups: st.listBackups(ctx.db, siteId).map(out),
    hasDatabase: container !== null,
    ...(bytes !== undefined ? { database: { bytes } } : {}),
  };
}

async function backupCreate(ctx: Ctx, input: unknown): Promise<{ backup: BackupOut }> {
  const o = rec(ctx, input);
  const site = mustSite(ctx, reqStr(ctx, o, "siteId"));
  const siteId = str(site.id);
  const container = postgres(ctx, siteId);
  if (!container)
    fail(
      ctx,
      "validation.precondition_failed",
      "This site has no running Postgres to back up. Add one in Settings first.",
    );
  if (st.listBackups(ctx.db, siteId).some((b) => (b.state === "queued" || b.state === "running") && running.has(b.id)))
    fail(ctx, "validation.precondition_failed", "A backup is already running.");
  const b: Backup = { id: nid(ctx, "bkp"), siteId, kind: "postgres", state: "queued", by: "person", at: ctx.now() };
  st.insertBackup(ctx.db, b);
  running.add(b.id);
  void runBackup(ctx, b, container);
  return { backup: out(b) };
}

async function backupDelete(ctx: Ctx, input: unknown): Promise<{ removed: boolean }> {
  const o = rec(ctx, input);
  const site = mustSite(ctx, reqStr(ctx, o, "siteId"));
  const b = st.getBackup(ctx.db, reqStr(ctx, o, "backupId"));
  if (!b || b.siteId !== str(site.id)) fail(ctx, "validation.not_found", "That backup does not exist.");
  if (b.state === "running" || b.state === "queued")
    fail(ctx, "validation.precondition_failed", "It is still being made.");
  await removeBackups(ctx, [b.id]);
  return { removed: true };
}

async function backupPin(ctx: Ctx, input: unknown): Promise<{ backup: BackupOut }> {
  const o = rec(ctx, input);
  const site = mustSite(ctx, reqStr(ctx, o, "siteId"));
  const b = st.getBackup(ctx.db, reqStr(ctx, o, "backupId"));
  if (!b || b.siteId !== str(site.id)) fail(ctx, "validation.not_found", "That backup does not exist.");
  const pinned = optBool(ctx, o, "pinned") ?? true;
  st.setPinned(ctx.db, b.id, pinned);
  return { backup: out({ ...b, ...(pinned ? { pinned } : { pinned: undefined }) }) };
}

/** Put a backup back: the database is made again from the dump. Everything in it now is replaced, so a person asked for exactly this one. */
async function backupRestore(ctx: Ctx, input: unknown): Promise<{ ok: boolean; detail: string }> {
  const o = rec(ctx, input);
  const site = mustSite(ctx, reqStr(ctx, o, "siteId"));
  const siteId = str(site.id);
  const b = st.getBackup(ctx.db, reqStr(ctx, o, "backupId"));
  if (!b || b.siteId !== siteId) fail(ctx, "validation.not_found", "That backup does not exist.");
  if (b.state !== "ready" || !b.fileId)
    fail(ctx, "validation.precondition_failed", "Only a finished backup can be put back.");
  const container = postgres(ctx, siteId);
  const r = siteRunner();
  if (!container || !r)
    fail(ctx, "validation.precondition_failed", "This site has no running Postgres to put it back into.");
  const blob = await ctx.blobs?.get(b.fileId);
  if (!blob) fail(ctx, "validation.not_found", "The file of that backup is gone from this server.");
  await r.put(container, "/tmp", "vyre-restore.gz", blob.bytes);
  const done = await r.exec(container, RESTORE_CMD, {});
  await r.exec(container, ["rm", "-f", "/tmp/vyre-restore.gz"], {}).catch(() => undefined);
  if (done.code !== 0)
    return {
      ok: false,
      detail: `It stopped part way: ${lastLine(done.out) || "the database refused it"}. Back up what is there now, then try again.`,
    };
  return { ok: true, detail: "The database is back as it was." };
}

export const backupHandlers = {
  "sites.backups_list": (ctx: Ctx, input: unknown) => backupsList(ctx, input),
  "sites.backup_create": (ctx: Ctx, input: unknown) => backupCreate(ctx, input),
  "sites.backup_delete": (ctx: Ctx, input: unknown) => backupDelete(ctx, input),
  "sites.backup_pin": (ctx: Ctx, input: unknown) => backupPin(ctx, input),
  "sites.backup_restore": (ctx: Ctx, input: unknown) => backupRestore(ctx, input),
};
