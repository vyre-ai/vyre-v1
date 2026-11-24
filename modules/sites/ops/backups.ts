// Backups of a site's database (r42-sites-run, slice 5): a Postgres dump kept in Files, listed with its size, restorable, and trimmed so a disk never fills.
// Pure code: the state machine and the retention rule. The dump itself runs through the runner (exec pg_dump in the site's Postgres) and is written by the handler.

export type BackupState = "queued" | "running" | "ready" | "failed";
export type BackupBy = "schedule" | "person";

export interface Backup {
  id: string;
  siteId: string;
  kind: "postgres";
  state: BackupState;
  by: BackupBy;
  at: number;
  endedAt?: number;
  bytes?: number;
  /** the file in Files once ready */
  fileId?: string;
  note?: string;
  /** a person kept it: retention never deletes it */
  pinned?: boolean | undefined;
  /** kept until this time whatever the clean-up rule says (a backup made before a restore) */
  keepUntil?: number | undefined;
}

export type BackupEvent =
  | { t: "start"; at: number }
  | { t: "done"; at: number; bytes: number; fileId: string }
  | { t: "fail"; at: number; note: string }
  /** the server restarted while it ran */
  | { t: "lost"; at: number };

export type BackupStepped = { ok: true; backup: Backup; same: boolean } | { ok: false; why: string };

export function stepBackup(b: Backup, ev: BackupEvent): BackupStepped {
  const ended = b.state === "ready" || b.state === "failed";
  if (ended) {
    const same =
      (ev.t === "done" && b.state === "ready") || ((ev.t === "fail" || ev.t === "lost") && b.state === "failed");
    return same ? { ok: true, backup: b, same: true } : { ok: false, why: "That backup has already ended." };
  }
  if (b.state === "queued") {
    if (ev.t === "start") return { ok: true, same: false, backup: { ...b, state: "running" } };
    if (ev.t === "fail")
      return { ok: true, same: false, backup: { ...b, state: "failed", endedAt: ev.at, note: ev.note } };
    return { ok: false, why: "That backup has not started." };
  }
  switch (ev.t) {
    case "start":
      return { ok: true, same: true, backup: b };
    case "done":
      return {
        ok: true,
        same: false,
        backup: { ...b, state: "ready", endedAt: ev.at, bytes: ev.bytes, fileId: ev.fileId },
      };
    case "fail":
      return { ok: true, same: false, backup: { ...b, state: "failed", endedAt: ev.at, note: ev.note } };
    case "lost":
      return {
        ok: true,
        same: false,
        backup: {
          ...b,
          state: "failed",
          endedAt: ev.at,
          note: "The server restarted while the backup ran. Back up again.",
        },
      };
  }
}

export interface Policy {
  /** the newest N ready backups kept */
  keep: number;
  /** and any ready backup younger than this many days */
  days: number;
}
export const POLICY: Policy = { keep: 7, days: 7 };
const DAY = 24 * 3_600_000;

/** The ids to delete: ready backups older than `days` and past the newest `keep`; pinned ones, queued, running and the newest ready backup are never deleted. Failed ones go after a day. */
export function expired(all: readonly Backup[], now: number, p: Policy = POLICY): string[] {
  const out: string[] = [];
  const ready = all.filter((b) => b.state === "ready").sort((a, b) => b.at - a.at);
  ready.forEach((b, i) => {
    if (i === 0 || b.pinned || (b.keepUntil !== undefined && b.keepUntil > now)) return;
    if (i >= p.keep && now - b.at > p.days * DAY) out.push(b.id);
  });
  for (const b of all) if (b.state === "failed" && !b.pinned && now - b.at > DAY) out.push(b.id);
  return out;
}

/** Whether a scheduled backup is due: none ready or running in the last `everyHours`. */
export function due(all: readonly Backup[], now: number, everyHours = 24): boolean {
  if (all.some((b) => b.state === "queued" || b.state === "running")) return false;
  // a backup that failed is not tried again at once, or a broken database is dumped every minute
  if (all.some((b) => b.state === "failed" && now - b.at < 3_600_000)) return false;
  const last = all.filter((b) => b.state === "ready").sort((a, b) => b.at - a.at)[0];
  return !last || now - last.at >= everyHours * 3_600_000;
}

/** The Files name of a dump: the site, the day and the time, so two never collide and they sort. */
export function fileName(siteSlug: string, at: number): string {
  const d = new Date(at).toISOString().replace(/[:]/g, "-").slice(0, 19);
  return `${siteSlug.replace(/[^a-z0-9-]/gi, "-").slice(0, 40) || "site"}-${d}.sql.gz`;
}

export const SAFETY_DAYS = 7;
