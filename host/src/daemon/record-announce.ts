// A record is written by Records' own store (space.db, with its own log) and announced to the rest of the Space by a `record.created` event that the call commits at its end, in the Space log (events.db, a
// second file: host/src/invoke.ts step 7). One commit cannot span the two files, so a stop between them leaves a record that search, sync and Run undo never hear of. The record's own event carries what the
// announcement needs (who, on whose behalf, which Run, which trace, whether it is quiet: `announce` in its payload, set by the handler that makes the announcement), so at the next start the missing
// announcements are made from it, exactly as the call would have made them. Only records whose own event says an announcement was coming are touched; anything else is for the doctor to report.
import fs from "node:fs";
import { openDb } from "./sqlite.ts";
import { recordEventIds } from "./doctor.ts";

export interface PendingAnnouncement {
  id: string;
  type: string;
  data: Record<string, unknown>;
  actor: string;
  onBehalf?: string;
  runId?: string;
  traceId: string;
  quiet: boolean;
}

const dec = new TextDecoder();
const TYPE_NAME = /^[a-z][a-z0-9_]{0,62}$/;

/** Records made with an announcement owed and no `record.created` event in the Space log, oldest first. Read-only. */
export function pendingAnnouncements(spaceDb: string, eventsDb: string): PendingAnnouncement[] {
  if (!fs.existsSync(spaceDb) || !fs.existsSync(eventsDb)) return [];
  const announced = recordEventIds(eventsDb);
  const db = openDb(spaceDb, fs.existsSync(`${spaceDb}-wal`) ? { readOnly: true } : { immutable: true });
  const out: PendingAnnouncement[] = [];
  try {
    for (let after = 0; ; ) {
      const rows = db.all(
        "SELECT seq, event, payload FROM events WHERE seq > ? AND json_extract(event, '$.type') = 'record.created' ORDER BY seq LIMIT 2000",
        after,
      ) as { seq: number; event: string; payload: Uint8Array }[];
      if (!rows.length) break;
      for (const r of rows) {
        let env: { actor?: string; on_behalf?: string; run_id?: string; trace_id?: string };
        let p: { type?: string; id?: string; data?: Record<string, unknown>; announce?: { quiet?: boolean } };
        try {
          env = JSON.parse(r.event);
          p = JSON.parse(dec.decode(r.payload));
        } catch {
          continue; // an erased payload owes nothing
        }
        if (!p.announce || typeof p.id !== "string" || typeof p.type !== "string" || announced.has(p.id)) continue;
        if (!TYPE_NAME.test(p.type) || typeof env.actor !== "string" || typeof env.trace_id !== "string") continue;
        // gone since (removed or its type dropped): nothing to announce
        let live = false;
        try {
          live = (db.all(`SELECT 1 AS x FROM "rt_${p.type}" WHERE id = ? AND deleted_at IS NULL`, p.id) as unknown[]).length > 0;
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
        });
      }
      after = rows[rows.length - 1]!.seq;
    }
  } finally {
    db.close();
  }
  return out;
}

/** The event the call would have committed: the same type, subject and payload records.bulk_upsert and records.create give it. The id is fixed by the record, so making it twice writes it once. */
export function announcementSpec(p: PendingAnnouncement): { name: "record.created"; subject: string; payload: unknown; id: string } {
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
): {
  space: string;
  principal: { kind: "person" | "agent" | "service"; id: string };
  actingFor?: string;
  run?: string;
  trace: { traceId: string; spanId: string };
  preAuth: true;
  origin: string;
} {
  return {
    space,
    principal: { kind: p.actor.startsWith("agt_") ? "agent" : p.actor.startsWith("svc_") ? "service" : "person", id: p.actor },
    ...(p.onBehalf ? { actingFor: p.onBehalf } : {}),
    ...(p.runId ? { run: p.runId } : {}),
    trace: { traceId: p.traceId, spanId },
    preAuth: true,
    origin: p.actor.startsWith("agt_") ? `agent:${p.actor}` : "user",
  };
}

/** Make the missing announcements, in the order the records were made. Answers how many it made. */
export async function replayAnnouncements(a: {
  spaceDb: string;
  eventsDb: string;
  /** Commit the announcement through the pipeline (invoke.commitEvents), so the record is registered as a resource as the call would have registered it. */
  commit: (p: PendingAnnouncement) => Promise<unknown>;
  say?: (msg: string, attrs: Record<string, unknown>) => void;
}): Promise<number> {
  const pending = pendingAnnouncements(a.spaceDb, a.eventsDb);
  let made = 0;
  for (const p of pending) {
    try {
      await a.commit(p);
      made++;
    } catch (e) {
      a.say?.("records.announce_failed", { id: p.id, error: e instanceof Error ? e.message : String(e) });
    }
  }
  if (made) a.say?.("records.announced_after_stop", { made, of: pending.length });
  return made;
}
