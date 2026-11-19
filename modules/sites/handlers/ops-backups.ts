// Backups of a site's own Postgres (r42-sites-run, slice 5): a gzipped dump kept on the server (ctx.blobs, readable by whoever can see the site), listed with its size, trimmed by ops/backups.ts, restorable.
// A backup runs in the background of the call that asked for it; the row says queued, running, then ready or failed with one sentence. After a restart a backup still marked running is failed (ops/backups.ts).
// The dump is made inside the Postgres container (pg_dump over its own socket, gzip) and read out of /tmp/vyre-backup.gz, so no password and no connection string leave the site's network.
import type { Ctx } from "../../../packages/contracts/src/ctx.ts";
import { fail, isNull, mustSite, nid, one, optBool, rec, reqStr, str } from "./deploy.ts";
import { siteRunner } from "./route.ts";
import { SAFETY_DAYS, expired, stepBackup } from "../ops/backups.ts";
import { TooBig } from "../ops/tarread.ts";
import type { Backup, BackupEvent } from "../ops/backups.ts";
import * as st from "../ops/store.ts";

type Db = Ctx["db"];
const DUMP = "/tmp/vyre-backup.gz";
const SIZE_CMD = ["psql", "-U", "app", "-d", "app", "-tAc", "select pg_database_size('app')"];
const DUMP_CMD = ["sh", "-c", `set -o pipefail 2>/dev/null; pg_dump -U app -d app --no-owner | gzip > ${DUMP}`];
const SQL = (...c: string[]): string[] => [
  "psql",
  "-U",
  "app",
  "-d",
  "postgres",
  "-v",
  "ON_ERROR_STOP=1",
  "-q",
  ...c.flatMap((x) => ["-c", x]),
];
/** Put back in three steps so a failure never costs the live database: a new one is made and filled; only when that worked are the names swapped (the old one stays as app_old until the next restore). */
const NEW_DB = SQL("DROP DATABASE IF EXISTS app_restore WITH (FORCE)", "CREATE DATABASE app_restore OWNER app");
const LOAD = ["sh", "-c", "gunzip -c /tmp/vyre-restore.gz | psql -U app -d app_restore -v ON_ERROR_STOP=1 -q"];
const DROP_NEW = SQL("DROP DATABASE IF EXISTS app_restore WITH (FORCE)");
const SWAP = SQL(
  "ALTER DATABASE app ALLOW_CONNECTIONS false",
  "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = 'app'",
  "DROP DATABASE IF EXISTS app_old WITH (FORCE)",
  "ALTER DATABASE app RENAME TO app_old",
  "ALTER DATABASE app_restore RENAME TO app",
  "ALTER DATABASE app ALLOW_CONNECTIONS true",
);
const UNDO_SWAP = [SQL("ALTER DATABASE app_old RENAME TO app"), SQL("ALTER DATABASE app ALLOW_CONNECTIONS true")];
/** A dump bigger than this is not kept here; the sentence says to dump it by hand. */
export const MAX_BACKUP_BYTES = 512 * 1024 * 1024;
const running = new Set<string>();
/** the database size is asked of Postgres at most once a minute per site */
const sizes = new Map<string, { at: number; bytes: number }>();

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
  keepUntil?: number;
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
  ...(b.keepUntil !== undefined ? { keepUntil: b.keepUntil } : {}),
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

const tooBig = (bytes: number): string =>
  `The dump is ${Math.round(bytes / 1048576)} MB, more than the ${MAX_BACKUP_BYTES / 1048576} MB kept here. Dump it from the database's own address instead.`;

/** Make one backup: dump in the container, check its size before copying it, copy it out with the cap applied as it arrives, keep it as a blob. Ends the row either way; returns the sentence on failure. Takes no lock. */
export async function dump(
  ctx: Ctx,
  b0: Backup,
  container: string,
): Promise<{ ok: true; backup: Backup } | { ok: false; note: string }> {
  const r = siteRunner();
  const db = ctx.db;
  let b = b0;
  const stop = (note: string): { ok: false; note: string } => {
    move(db, b, { t: "fail", at: ctx.now(), note });
    return { ok: false, note };
  };
  try {
    if (!r) return stop("This server cannot reach the database.");
    if (!ctx.blobs) return stop("This server cannot keep backups.");
    b = move(db, b, { t: "start", at: ctx.now() });
    const made = await r.exec(container, DUMP_CMD, {});
    if (made.code !== 0) return stop(`The dump failed: ${lastLine(made.out) || "the database did not answer"}.`);
    const size = await r.exec(container, ["stat", "-c", "%s", DUMP], {});
    const have = Number(size.out.trim().split("\n").slice(-1)[0]);
    if (size.code === 0 && have > MAX_BACKUP_BYTES) {
      await r.exec(container, ["rm", "-f", DUMP], {}).catch(() => undefined);
      return stop(tooBig(have));
    }
    let bytes: Uint8Array;
    try {
      bytes = await r.getFile(container, DUMP, MAX_BACKUP_BYTES);
    } catch (e) {
      if (e instanceof TooBig) return stop(tooBig(e.size));
      throw e;
    }
    await r.exec(container, ["rm", "-f", DUMP], {}).catch(() => undefined);
    const blob = await ctx.blobs.put(bytes, "application/gzip", { resource: { type: "site", id: b.siteId } });
    const done = move(db, b, { t: "done", at: ctx.now(), bytes: bytes.length, fileId: blob.id });
    return { ok: true, backup: done };
  } catch (e) {
    return stop(`The backup stopped: ${(e instanceof Error ? e.message : String(e)).slice(0, 160)}`);
  }
}

const HELD: Record<string, string> = {
  backup: "A backup of this database is being made. Wait for it to finish.",
  restore: "A backup is being put back into this database. Wait for it to finish.",
};
/** One backup or restore at a time per site: the second is refused with the reason. */
function takeLock(ctx: Ctx, siteId: string, kind: string): void {
  const got = st.lockSite(ctx.db, siteId, kind, ctx.now());
  if (!got.ok)
    fail(ctx, "validation.precondition_failed", HELD[got.heldBy.kind] ?? "Another backup or restore is running.");
}

/** The work of one backup asked for by a person or a schedule: the dump, then the clean-up of old ones, then the lock is let go. Never throws. */
export async function runBackup(ctx: Ctx, b0: Backup, container: string): Promise<void> {
  try {
    const out = await dump(ctx, b0, container);
    if (out.ok) await removeBackups(ctx, expired(st.listBackups(ctx.db, b0.siteId), ctx.now()));
  } finally {
    running.delete(b0.id);
    st.unlockSite(ctx.db, b0.siteId);
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
  const cached = sizes.get(siteId);
  if (cached && ctx.now() - cached.at < 60_000) bytes = cached.bytes;
  else if (container && r) {
    try {
      const size = await r.exec(container, SIZE_CMD, {});
      const n = Number(size.out.trim().split("\n").slice(-1)[0]);
      if (size.code === 0 && Number.isFinite(n)) {
        bytes = n;
        sizes.set(siteId, { at: ctx.now(), bytes: n });
      }
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
  takeLock(ctx, siteId, "backup");
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

/** Put a backup back without ever losing what is there: a backup of the live database is made first (kept seven days, and the restore is refused if it cannot be made), the dump is loaded into a new database, and only when that worked are the names swapped. */
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
  takeLock(ctx, siteId, "restore");
  try {
    const safety: Backup = {
      id: nid(ctx, "bkp"),
      siteId,
      kind: "postgres",
      state: "queued",
      by: "person",
      at: ctx.now(),
      keepUntil: ctx.now() + SAFETY_DAYS * 86_400_000,
    };
    st.insertBackup(ctx.db, safety);
    const first = await dump(ctx, safety, container);
    if (!first.ok)
      return {
        ok: false,
        detail: `It was not put back: what is in the database now could not be backed up first (${first.note.replace(/\.$/, "")}). Nothing changed.`,
      };
    await r.put(container, "/tmp", "vyre-restore.gz", blob.bytes);
    try {
      const made = await r.exec(container, NEW_DB, {});
      if (made.code !== 0)
        return {
          ok: false,
          detail: `It was not put back: ${lastLine(made.out) || "a new database could not be made"}. The database was not touched.`,
        };
      const load = await r.exec(container, LOAD, {});
      if (load.code !== 0) {
        await r.exec(container, DROP_NEW, {}).catch(() => undefined);
        return {
          ok: false,
          detail: `It was not put back: the dump stopped part way (${lastLine(load.out) || "the database refused it"}). The database was not touched.`,
        };
      }
      const swap = await r.exec(container, SWAP, {});
      if (swap.code !== 0) {
        for (const c of UNDO_SWAP) await r.exec(container, c, {}).catch(() => undefined);
        await r.exec(container, DROP_NEW, {}).catch(() => undefined);
        return {
          ok: false,
          detail: `It was not put back: the switch to the new database failed (${lastLine(swap.out) || "the database refused it"}). The database was left as it was.`,
        };
      }
      return {
        ok: true,
        detail: `The database is back as it was. What was there before is kept for ${SAFETY_DAYS} days as a backup in the list.`,
      };
    } finally {
      await r.exec(container, ["rm", "-f", "/tmp/vyre-restore.gz"], {}).catch(() => undefined);
    }
  } finally {
    st.unlockSite(ctx.db, siteId);
  }
}

export const backupHandlers = {
  "sites.backups_list": (ctx: Ctx, input: unknown) => backupsList(ctx, input),
  "sites.backup_create": (ctx: Ctx, input: unknown) => backupCreate(ctx, input),
  "sites.backup_delete": (ctx: Ctx, input: unknown) => backupDelete(ctx, input),
  "sites.backup_pin": (ctx: Ctx, input: unknown) => backupPin(ctx, input),
  "sites.backup_restore": (ctx: Ctx, input: unknown) => backupRestore(ctx, input),
};
