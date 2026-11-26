// A record is written by Records' own store (space.db, with its own log) and announced to the rest of the Space by a `record.created` event that the call commits at its end, in the Space log (events.db, a
// second file: host/src/invoke.ts step 7). One commit cannot span the two files, so a stop between them leaves a record that search, sync and Run undo never hear of, and that nobody can see (it was never registered
// as a resource). The record's own event carries what the announcement needs (who, on whose behalf, which Run, which trace, whether it is quiet, at what depth: `announce` in its payload, set by the handler that
// makes the announcement), so at the next start the missing announcements are made from it, through the same step that registers resources and grants (invoke.commitEvents). Only records whose own event says an
// announcement was coming are touched; anything else is for the doctor to report.
//
// Cost: a start reads only the record events newer than a high-water mark kept in a small file (the record log's seq up to which everything was found announced or was announced), a page at a time with a turn
// of the event loop between pages, and looks each candidate up by its entity id in the Space log (indexed). The first start after this feature has no mark and sets it to where the log is: no record made before it
// carries a marker. Records made after the daemon started are never candidates: their calls are alive and announce them.
//
// `at` is wall-clock: a clock stepped back across a restart can hide events from `at < startedAt` until the next start (harmless: they are looked at then).
// A record whose owner is gone (no actor, no person, no Space owner) stays skipped, with a log line, at every start and holds the mark: a person decides, the doctor finding names it.
// The first start after this feature only sets the mark: a record orphaned by a stop under the old build is for the doctor to report.
//
// The replay needs the access snapshot (who exists, who owns the Space), so it runs after the daemon serves.
import fs from "node:fs";
import { openDb } from "./sqlite.ts";
import { turns } from "../../../lib/yield-loop.ts";

export interface PendingAnnouncement {
  id: string;
  type: string;
  data: Record<string, unknown>;
  actor: string;
  onBehalf?: string;
  runId?: string;
  traceId: string;
  quiet: boolean;
  depth?: number;
  origin?: string;
  seq: number;
}

const dec = new TextDecoder();
const TYPE_NAME = /^[a-z][a-z0-9_]{0,62}$/;
const PAGE = 500;

export const readMark = (file: string): number | null => {
  try {
    const n = Number(fs.readFileSync(file, "utf8").trim());
    return Number.isInteger(n) && n >= 0 ? n : null;
  } catch {
    return null;
  }
};
const writeMark = (file: string, seq: number): void => {
  const tmp = `${file}.new`;
  fs.writeFileSync(tmp, `${seq}\n`);
  fs.renameSync(tmp, file);
};

/** The record events made before `before` (a daemon's start) with an announcement owed and no `record.created` in the Space log, after `mark`. `scannedTo` is the last record-log seq looked at. Read-only. */
export async function pendingAnnouncements(a: {
  spaceDb: string;
  eventsDb: string;
  mark: number;
  before: number;
}): Promise<{ pending: PendingAnnouncement[]; scannedTo: number }> {
  const out: PendingAnnouncement[] = [];
  if (!fs.existsSync(a.spaceDb) || !fs.existsSync(a.eventsDb)) return { pending: out, scannedTo: a.mark };
  const space = openDb(a.spaceDb, fs.existsSync(`${a.spaceDb}-wal`) ? { readOnly: true } : { immutable: true });
  const log = openDb(a.eventsDb, fs.existsSync(`${a.eventsDb}-wal`) ? { readOnly: true } : { immutable: true });
  const turn = turns();
  let scannedTo = a.mark;
  try {
    for (let after = a.mark; ; ) {
      // the marker is a key inside the payload's top level: a row without the text cannot carry it (a value holding it has its quotes escaped)
      const rows = space.all(
        "SELECT seq, event, payload FROM events WHERE type = 'record.created' AND seq > ? AND at < ? AND instr(payload, CAST('\"announce\":' AS BLOB)) > 0 ORDER BY seq LIMIT ?",
        after,
        a.before,
        PAGE,
      ) as { seq: number; event: string; payload: Uint8Array }[];
      if (!rows.length) {
        // nothing more to read: everything up to the last record event made before the start has been looked at
        const head = space.all(
          "SELECT max(seq) AS m FROM events WHERE type = 'record.created' AND at < ?",
          a.before,
        )[0] as { m: number | null };
        scannedTo = Math.max(scannedTo, head?.m ?? scannedTo);
        break;
      }
      for (const r of rows) {
        await turn();
        after = r.seq;
        scannedTo = r.seq;
        let env: { actor?: string; on_behalf?: string; run_id?: string; trace_id?: string };
        let p: {
          type?: string;
          id?: string;
          data?: Record<string, unknown>;
          announce?: { quiet?: boolean; depth?: number; origin?: string };
        };
        try {
          env = JSON.parse(r.event);
          p = JSON.parse(dec.decode(r.payload));
        } catch {
          continue; // an erased payload owes nothing
        }
        if (!p.announce || typeof p.id !== "string" || typeof p.type !== "string") continue;
        if (!TYPE_NAME.test(p.type) || typeof env.actor !== "string" || typeof env.trace_id !== "string") continue;
        // by the entity index (the type index would walk every announcement for each candidate), and the type is checked here
        const announced = (
          log.all("SELECT type FROM events INDEXED BY ev_entity WHERE entity = 'record' AND entity_id = ?", p.id) as {
            type: string;
          }[]
        ).some((e) => e.type === "record.created");
        if (announced) continue;
        // gone since (removed or its type dropped): nothing to announce
        let live = false;
        try {
          live =
            (space.all(`SELECT 1 AS x FROM "rt_${p.type}" WHERE id = ? AND deleted_at IS NULL`, p.id) as unknown[])
              .length > 0;
        } catch {
          live = false;
        }
        if (!live) continue;
        out.push({
          id: p.id,
          type: p.type,
          data: p.data ?? {},
          actor: env.actor,
          ...(env.on_behalf ? { onBehalf: env.on_behalf } : {}),
          ...(env.run_id ? { runId: env.run_id } : {}),
          traceId: env.trace_id,
          quiet: p.announce.quiet === true,
          ...(Number.isInteger(p.announce.depth) ? { depth: p.announce.depth as number } : {}),
          ...(typeof p.announce.origin === "string" ? { origin: p.announce.origin } : {}),
          seq: r.seq,
        });
      }
    }
  } finally {
    space.close();
    log.close();
  }
  return { pending: out, scannedTo };
}

/**
 * Records that exist with no `record.created` in the Space log and no marker in their own event to say one was owed: the ones an older build made (a sync pass that was stopped by an update before its call
 * committed its announcements, 26 Nov 2026: Meier's dv_event had 4,267 records and the owner saw 986), or any whose own event predates the marker. A record the log never heard of is not a resource, so nobody can see it.
 * Each is announced as the call that made it would have (quiet: no automation runs for a repair), for the actor its own event names, else the Space owner. Records younger than `before` only.
 * Cheap when nothing is wrong: the live records are counted against the announcements first, and the ids are compared only when the counts leave room for a missing one (or when `force` asks, once per repair version).
 */
export async function orphanAnnouncements(a: {
  spaceDb: string;
  eventsDb: string;
  before: number;
  force: boolean;
}): Promise<PendingAnnouncement[]> {
  const out: PendingAnnouncement[] = [];
  if (!fs.existsSync(a.spaceDb) || !fs.existsSync(a.eventsDb)) return out;
  const space = openDb(a.spaceDb, fs.existsSync(`${a.spaceDb}-wal`) ? { readOnly: true } : { immutable: true });
  const log = openDb(a.eventsDb, fs.existsSync(`${a.eventsDb}-wal`) ? { readOnly: true } : { immutable: true });
  const turn = turns();
  try {
    const tables = (
      space.all(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'rt!_%' ESCAPE '!' AND name NOT LIKE '%!_!_fm' ESCAPE '!'",
      ) as { name: string }[]
    ).map((t) => t.name);
    if (!tables.length) return out;
    if (!a.force) {
      let live = 0;
      for (const t of tables)
        live += Number(
          (
            space.all(`SELECT count(*) AS n FROM "${t}" WHERE deleted_at IS NULL AND created_at < ?`, a.before)[0] as {
              n: number;
            }
          ).n,
        );
      const heard = Number(
        (
          log.all("SELECT count(*) AS n FROM events WHERE type = 'record.created' AND entity = 'record'")[0] as {
            n: number;
          }
        ).n,
      );
      if (heard >= live) return out;
    }
    const heard = new Set<string>();
    for (let after = 0; ; ) {
      const rows = log.all(
        "SELECT seq, entity_id FROM events WHERE type = 'record.created' AND entity = 'record' AND seq > ? ORDER BY seq LIMIT 5000",
        after,
      ) as { seq: number; entity_id: string | null }[];
      if (!rows.length) break;
      for (const r of rows) if (typeof r.entity_id === "string") heard.add(r.entity_id);
      after = rows[rows.length - 1]!.seq;
      await turn();
    }
    for (const t of tables) {
      const type = t.slice(3);
      if (!TYPE_NAME.test(type)) continue;
      for (let after = ""; ; ) {
        const rows = space.all(
          `SELECT id, data FROM "${t}" WHERE deleted_at IS NULL AND created_at < ? AND id > ? ORDER BY id LIMIT ${PAGE}`,
          a.before,
          after,
        ) as { id: string; data: string }[];
        if (!rows.length) break;
        for (const r of rows) {
          after = r.id;
          if (heard.has(r.id)) continue;
          let data: Record<string, unknown> = {};
          try {
            data = JSON.parse(r.data) as Record<string, unknown>;
          } catch {
            /* a row that cannot be read is announced with no fields: it still becomes a resource */
          }
          // who made it: the record's own event, when it has one (by the entity index); else nobody, and the replay runs it as the Space owner
          let env: { actor?: string; on_behalf?: string; run_id?: string; trace_id?: string } = {};
          let seq = 0;
          try {
            const own = space.all(
              "SELECT seq, event FROM events WHERE type = 'record.created' AND entity = ? AND entity_id = ? LIMIT 1",
              type,
              r.id,
            )[0] as { seq: number; event: string } | undefined;
            if (own) {
              env = JSON.parse(own.event);
              seq = own.seq;
            }
          } catch {
            env = {};
          }
          out.push({
            id: r.id,
            type,
            data,
            actor: typeof env.actor === "string" ? env.actor : "",
            ...(env.on_behalf ? { onBehalf: env.on_behalf } : {}),
            ...(env.run_id ? { runId: env.run_id } : {}),
            traceId:
              typeof env.trace_id === "string" && /^[0-9a-f]{32}$/.test(env.trace_id) ? env.trace_id : "0".repeat(32),
            quiet: true,
            seq,
          });
        }
        await turn();
      }
    }
  } finally {
    space.close();
    log.close();
  }
  return out;
}

/** The event the call would have committed: the same type, subject and payload records.bulk_upsert and records.create give it. The id is fixed by the record, so making it twice writes it once. */
export function announcementSpec(p: PendingAnnouncement): {
  name: "record.created";
  subject: string;
  payload: unknown;
  id: string;
} {
  return {
    name: "record.created",
    subject: `record/${p.id}`,
    id: `evt_${p.id.replace(/^rec_/, "a")}`,
    payload: { recordId: p.id, type: p.type, fields: { ...p.data }, ...(p.quiet ? { quiet: true } : {}) },
  };
}

/** Who the call ran as, for the pipeline: the actor, whom it acted for, its Run and trace. The resource it registers is owned as the call would have owned it. */
export function announcementSeed(
  p: PendingAnnouncement,
  space: string,
  spanId: string,
  who: { actor: string; actingFor?: string },
): {
  space: string;
  principal: { kind: "person" | "agent" | "service"; id: string };
  actingFor?: string;
  run?: string;
  trace: { traceId: string; spanId: string };
  preAuth: true;
  origin: string;
} {
  const agent = who.actor.startsWith("agt_");
  return {
    space,
    principal: { kind: agent ? "agent" : who.actor.startsWith("svc_") ? "service" : "person", id: who.actor },
    ...(who.actingFor ? { actingFor: who.actingFor } : {}),
    ...(p.runId ? { run: p.runId } : {}),
    trace: { traceId: p.traceId, spanId },
    preAuth: true,
    origin: p.origin ?? (agent ? `agent:${who.actor}` : "user"),
  };
}

/** Who to run the replay as when the actor or the person it acted for is gone: never a principal that no longer exists. Null when nobody is left to own it. */
export function replayActors(
  p: PendingAnnouncement,
  exists: (id: string) => boolean,
  spaceOwner: string | null,
): { actor: string; actingFor?: string; changed: boolean } | null {
  const actorOk = exists(p.actor);
  const forOk = p.onBehalf !== undefined && exists(p.onBehalf);
  if (actorOk) {
    if (forOk || p.onBehalf === undefined)
      return { actor: p.actor, ...(forOk ? { actingFor: p.onBehalf! } : {}), changed: false };
    // the person it worked for is gone: the record belongs to the Space owner, as it would for any of their things left without one
    return { actor: p.actor, ...(spaceOwner && exists(spaceOwner) ? { actingFor: spaceOwner } : {}), changed: true };
  }
  const owner = forOk ? p.onBehalf! : spaceOwner && exists(spaceOwner) ? spaceOwner : null;
  return owner ? { actor: owner, changed: true } : null;
}

/** Make the missing announcements, in the order the records were made, then move the mark. Answers how many it made. */
export async function replayAnnouncements(a: {
  spaceDb: string;
  eventsDb: string;
  markFile: string;
  /** when the daemon started: records made since are alive calls' business */
  startedAt: number;
  /** Commit the announcement through the pipeline (invoke.commitEvents), so the record is registered as a resource as the call would have registered it. */
  commit: (p: PendingAnnouncement, who: { actor: string; actingFor?: string }) => Promise<unknown>;
  exists: (id: string) => boolean;
  spaceOwner: () => string | null;
  say?: (msg: string, attrs: Record<string, unknown>) => void;
  /** Turns the repair of records no announcement ever named on. The file says the full repair was done (once per version); with it present the repair runs only when the counts show a record short. */
  repairFile?: string;
}): Promise<number> {
  const marked = await replayMarked(a);
  const repaired = a.repairFile === undefined ? 0 : await repairOrphans(a);
  return marked + repaired;
}

/** The records an older build left without an announcement: announced now, so they are resources and visible. The repair file is written when every one was made. */
async function repairOrphans(a: Parameters<typeof replayAnnouncements>[0]): Promise<number> {
  const done = fs.existsSync(a.repairFile!);
  const pending = await orphanAnnouncements({
    spaceDb: a.spaceDb,
    eventsDb: a.eventsDb,
    before: a.startedAt,
    force: !done,
  });
  let made = 0;
  let failed = 0;
  for (const p of pending) {
    const owner = a.spaceOwner();
    const who = p.actor
      ? replayActors(p, a.exists, owner)
      : owner && a.exists(owner)
        ? { actor: owner, changed: true }
        : null;
    if (!who) {
      failed++;
      a.say?.("records.announce_skipped", { id: p.id, why: "no actor and no Space owner exists" });
      continue;
    }
    try {
      await a.commit(p, who);
      made++;
    } catch (e) {
      failed++;
      a.say?.("records.announce_failed", { id: p.id, error: e instanceof Error ? e.message : String(e) });
    }
  }
  if (made) a.say?.("records.announced_by_repair", { made, of: pending.length });
  if (!failed && !done) fs.writeFileSync(a.repairFile!, `${Date.now()}\n`);
  return made;
}

async function replayMarked(a: Parameters<typeof replayAnnouncements>[0]): Promise<number> {
  let mark = readMark(a.markFile);
  if (mark === null) {
    // the first start with this feature: no record made before it carries a marker, so there is nothing to look for; the mark goes to where the record log is now
    if (!fs.existsSync(a.spaceDb)) return 0;
    const db = openDb(a.spaceDb, fs.existsSync(`${a.spaceDb}-wal`) ? { readOnly: true } : { immutable: true });
    try {
      const m =
        (db.all("SELECT max(seq) AS m FROM events WHERE at < ?", a.startedAt)[0] as { m: number | null }).m ?? 0;
      writeMark(a.markFile, m);
    } finally {
      db.close();
    }
    return 0;
  }
  const { pending, scannedTo } = await pendingAnnouncements({
    spaceDb: a.spaceDb,
    eventsDb: a.eventsDb,
    mark,
    before: a.startedAt,
  });
  let made = 0;
  let failed = 0;
  for (const p of pending) {
    const who = replayActors(p, a.exists, a.spaceOwner());
    if (!who) {
      failed++;
      a.say?.("records.announce_skipped", {
        id: p.id,
        why: "neither the actor nor the person it acted for nor the Space owner exists",
      });
      continue;
    }
    if (who.changed) a.say?.("records.announce_owner_changed", { id: p.id, actor: p.actor, as: who.actor });
    try {
      await a.commit(p, who);
      made++;
    } catch (e) {
      failed++;
      a.say?.("records.announce_failed", { id: p.id, error: e instanceof Error ? e.message : String(e) });
    }
  }
  if (made) a.say?.("records.announced_after_stop", { made, of: pending.length });
  // the mark moves only when everything it covers is announced: a failure is looked at again at the next start
  if (!failed && scannedTo > mark) writeMark(a.markFile, scannedTo);
  return made;
}
