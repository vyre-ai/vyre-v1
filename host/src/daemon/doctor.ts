// `vyre-server doctor` (ARCH 7.10): works with the gateway down. It reads the data directory and nothing else: events.db opened read-only (hash chain re-verified), logs.db opened read-only, modules.db read-only for the Space's own domain (its Caddy route is checked),
// the pid file, the disk and the machine. It never starts, signals or writes anything, so it is safe to run on a broken server. Keys and next steps match the health module's checks
// (health.doctor answers the same findings from inside the gateway).
import fs from "node:fs";
import { genesis, hashOf } from "../../../kernel/src/log/index.ts";
import { hostOf, ingressHostOf, routesOf } from "../caddy/routes.ts";
import type { Envelope } from "../../../kernel/src/log/index.ts";
import { nodePlatform } from "../platform/index.ts";
import type { Platform } from "../platform/index.ts";
import * as probes from "../platform/probes.ts";
import type { FetchFn, ProbeResult } from "../platform/probes.ts";
import { alive, pathsFor, readInfo } from "./config.ts";
import { NEXT, OK } from "./doctor-next.ts";
import { openDb } from "./sqlite.ts";
import { askArtifactHost } from "./artifact-check.ts";
import { artifactHostOf, artifactMarkerOf } from "./public-origin.ts";

export interface Finding {
  key: string;
  state: "healthy" | "degraded" | "down";
  detail: string;
  next: string;
}
export interface DoctorReport {
  ok: boolean;
  dataDir: string;
  findings: Finding[];
}
export interface DoctorOptions {
  dataDir: string;
  /** device = no event log, Docker or Caddy to check */
  role?: "space" | "device";
  platform?: Platform;
  fetch?: FetchFn | null;
  caddyAdmin?: string;
  now?: () => number;
  /** replace the disk check (recorded-output version from P-L7b_04) */
  diskEncrypted?: () => Promise<ProbeResult>;
  /** what the person chose about disk encryption at install */
  diskChoice?: { kind: string; since?: string };
  /** Ask the Space's artifact address whether it reaches this Space (a request over the internet, so the container health check leaves it off). */
  artifactAddress?: boolean;
  /** Docker's data root as the host sees it: agent browser sign-ins live in Docker volumes there */
  dockerRoot?: { dir: string; state: string };
}

const finding = (key: string, r: ProbeResult, next: string): Finding => ({
  key,
  state: r.state,
  detail: r.detail ?? "",
  next: r.state === "healthy" ? OK : next,
});

/** The next step for the disk check: a recorded choice has its own (the person is not told to do what they decided not to, or to enable what they said is on). */
export function diskNext(detail: string | undefined): string {
  const d = detail ?? "";
  if (d.startsWith("Not verified: your provider's encryption")) return NEXT.diskProvider;
  if (d.startsWith("The data is NOT encrypted at rest")) return NEXT.diskPlain;
  return NEXT.disk;
}

/**
 * Docker's data root, as the host reported it: encrypted, plain, or unknown (the host cannot look at it: Docker in a virtual machine as on a Mac, or a root it cannot resolve). Agent browser sign-ins, the Chrome
 * profiles of agent computers and of the Space browser, are stored unsealed in Docker volumes there (nothing in this version seals them; the hook in modules/computers is not supplied), so only that disk's
 * encryption protects them. A finding of its own; it only reports.
 */
export function dockerRootFinding(
  root: { dir: string; state: string } | undefined,
  dataVerified: boolean,
  choice: string | undefined,
): Finding | null {
  if (!root) return null;
  const key = "host.docker_root";
  const unsealed =
    "Agent browser sign-ins (agent computers' and the Space browser's Chrome profiles) are stored unsealed in Docker volumes";
  if (root.state === "encrypted")
    return {
      key,
      state: "healthy",
      detail: `Docker's data root ${root.dir} is on an encrypted volume (verified by the host). ${unsealed} there; that disk's encryption protects them.`,
      next: OK,
    };
  if (root.state === "unknown")
    return {
      key,
      state: "degraded",
      detail: `Could not tell whether Docker's data root (${root.dir}) is encrypted: it is not a disk this server can look at (as when Docker runs in a virtual machine, as on a Mac, where FileVault covers that machine's disk image). ${unsealed} there.`,
      next: NEXT.dockerRootUnknown,
    };
  if (dataVerified)
    return {
      key,
      state: "degraded",
      detail: `Docker's data root (${root.dir}) is not on an encrypted volume, but the Space's data is. ${unsealed} there, so they are not encrypted at rest.`,
      next: NEXT.dockerRoot,
    };
  if (choice === "plain")
    return {
      key,
      state: "degraded",
      detail: `${unsealed} on Docker's disk (${root.dir}), which is not encrypted at rest (the plain-disk choice you made covers it).`,
      next: NEXT.dockerRoot,
    };
  if (choice === "provider")
    return {
      key,
      state: "degraded",
      detail: `Not verified: ${unsealed.charAt(0).toLowerCase()}${unsealed.slice(1)} on Docker's disk (${root.dir}). Your provider's encryption, as you stated, covers them only if Docker's data root is on that volume.`,
      next: NEXT.dockerRoot,
    };
  return {
    key,
    state: "degraded",
    detail: `${unsealed} on Docker's disk (${root.dir}), which is not verified encrypted.`,
    next: NEXT.dockerRoot,
  };
}

export interface ChainResult {
  ok: boolean;
  seq: number;
  why?: string;
}

/** Re-verify the hash chain of an events.db opened read-only: contiguous seq, prev links, envelope hashes, and the head the last commit recorded. `tail` checks only the last that-many events, linked
 * from the hash of the event before them, so the container health check stays fast on a Space with a long history (a full pass over 400,000 events took 12 s and the check gives the doctor 8). */
export function verifyChainReadOnly(file: string, tail?: number): ChainResult {
  const db = openDb(file, { readOnly: true });
  try {
    const meta = (key: string): string | undefined =>
      (db.all("SELECT value FROM log_meta WHERE key = ?", key)[0] as { value?: string } | undefined)?.value;
    const space = meta("space");
    if (!space) return { ok: false, seq: 0, why: "the file has no Space id, so it is not an event log" };
    let prev = genesis(space),
      n = 0;
    if (tail !== undefined && tail > 0) {
      const head = Number((db.all("SELECT MAX(seq) AS n FROM events")[0] as { n: number | null } | undefined)?.n ?? 0);
      const from = Math.max(0, head - tail);
      if (from > 0) {
        const row = db.all("SELECT event FROM events WHERE seq = ?", from)[0] as { event: string } | undefined;
        if (!row) return { ok: false, seq: 0, why: `seq is not contiguous at ${from}` };
        try {
          prev = (JSON.parse(row.event) as Envelope).hash;
        } catch {
          return { ok: false, seq: from - 1, why: `event ${from} is not JSON` };
        }
        n = from;
      }
    }
    for (;;) {
      const rows = db.all("SELECT seq, event FROM events WHERE seq > ? ORDER BY seq LIMIT 500", n) as {
        seq: number;
        event: string;
      }[];
      if (!rows.length) break;
      for (const r of rows) {
        let e: Envelope;
        try {
          e = JSON.parse(r.event) as Envelope;
        } catch {
          return { ok: false, seq: n, why: `event ${r.seq} is not JSON` };
        }
        n++;
        if (r.seq !== n || e.seq !== n) return { ok: false, seq: n - 1, why: `seq is not contiguous at ${n}` };
        if (e.prev !== prev) return { ok: false, seq: n - 1, why: `event ${n} does not follow the one before it` };
        if (hashOf(e) !== e.hash) return { ok: false, seq: n - 1, why: `event ${n} was changed after it was written` };
        prev = e.hash;
      }
    }
    const recorded = Number(meta("head_seq") ?? 0);
    if (n < recorded) return { ok: false, seq: n, why: `the log has ${n} events but ${recorded} were recorded` };
    return { ok: true, seq: n };
  } finally {
    db.close();
  }
}

function eventsFinding(file: string, tail?: number): Finding {
  if (!fs.existsSync(file))
    return {
      key: "kernel.events_db",
      state: "degraded",
      detail: "There is no event log in this data directory yet.",
      next: "Start the server once so it creates the Space, or point --data-dir at the right folder.",
    };
  try {
    const r = verifyChainReadOnly(file, tail);
    return r.ok
      ? { key: "kernel.events_db", state: "healthy", detail: `Chain verifies through event ${r.seq}.`, next: OK }
      : {
          key: "kernel.events_db",
          state: "down",
          detail: `The event log failed verification: ${r.why ?? "unknown reason"}.`,
          next: NEXT.events,
        };
  } catch (e) {
    return {
      key: "kernel.events_db",
      state: "down",
      detail: `events.db cannot be opened read-only: ${e instanceof Error ? e.message : String(e)}`,
      next: NEXT.events,
    };
  }
}

/**
 * The ids of the records the Space log announces (events.db). The announcement is a `record.created` event whose entity is `record` and whose entity id is the record's id, both columns of the envelope, so an
 * erased or encrypted payload still names its record. `unreadable` counts announcements with no entity id: if there are any, the answer is "cannot check".
 */
export function recordEventIds(file: string): { ids: Set<string>; unreadable: number } {
  const db = openDb(file, fs.existsSync(`${file}-wal`) ? { readOnly: true } : { immutable: true });
  const ids = new Set<string>();
  let unreadable = 0;
  try {
    for (let after = 0; ; ) {
      const rows = db.all(
        "SELECT seq, entity_id FROM events WHERE type = 'record.created' AND entity = 'record' AND seq > ? ORDER BY seq LIMIT 5000",
        after,
      ) as { seq: number; entity_id: string | null }[];
      if (!rows.length) break;
      for (const r of rows) {
        if (typeof r.entity_id === "string" && r.entity_id) ids.add(r.entity_id);
        else unreadable++;
      }
      after = rows[rows.length - 1]!.seq;
    }
  } finally {
    db.close();
  }
  return { ids, unreadable };
}

/** A record this young may have its announcement still on its way (the call commits it at its end): never counted. */
const ANNOUNCE_GRACE_MS = 120_000;

/**
 * Records that exist in the record store (space.db, its own log) with no `record.created` event in the Space log (events.db). The record is written first and its announcement is committed at the end of the call
 * (host/src/invoke.ts), in another database file, so a stop between the two leaves a record that search, sync and Run undo never hear of.
 * Every record is made by records.create or records.bulk_upsert (an import, a sync pull, a kit's starters and an agent's work all call them), and both announce what they make, so a live record with no announcement is a
 * stop. Nothing else makes a record: a record type promoted from a site table is a type, not a record. Records are read first and the log second, so a record made between the two reads is never reported; one
 * younger than ANNOUNCE_GRACE_MS is not counted; and if any announcement cannot be read the answer is "not checked", never degraded. Read-only; names a few ids.
 */
export function recordEventsFinding(spaceDb: string, eventsDb: string, now: number = Date.now()): Finding {
  const key = "records.created_events";
  if (!fs.existsSync(spaceDb) || !fs.existsSync(eventsDb))
    return { key, state: "healthy", detail: "No records yet.", next: OK };
  try {
    const db = openDb(spaceDb, fs.existsSync(`${spaceDb}-wal`) ? { readOnly: true } : { immutable: true });
    const live: { id: string; at: number }[] = [];
    try {
      const tables = db.all(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'rt!_%' ESCAPE '!' AND name NOT LIKE '%!_!_fm' ESCAPE '!'",
      ) as { name: string }[];
      for (const t of tables)
        for (const r of db.all(`SELECT id, created_at FROM "${t.name}" WHERE deleted_at IS NULL`) as {
          id: string;
          created_at: number;
        }[])
          live.push({ id: r.id, at: Number(r.created_at) });
    } finally {
      db.close();
    }
    const { ids, unreadable } = recordEventIds(eventsDb);
    const missing = live.filter((r) => !ids.has(r.id) && r.at < now - ANNOUNCE_GRACE_MS).map((r) => r.id);
    if (!missing.length)
      return { key, state: "healthy", detail: `All ${live.length} records have their created event.`, next: OK };
    // an announcement that names no record may belong to any one record: it can hide as many missing records as there are such announcements, no more
    if (unreadable >= missing.length)
      return {
        key,
        state: "healthy",
        detail: `Not checked: ${unreadable} announcements in the log name no record, so it cannot be said which of the ${missing.length} records without a named announcement lack one.`,
        next: OK,
      };
    return {
      key,
      state: "degraded",
      detail: `${missing.length - unreadable} of ${live.length} records have no record.created event${unreadable ? ` (at least; ${unreadable} unreadable announcements may account for others)` : ""} (for example ${missing.slice(0, 3).join(", ")}), so search, sync and Run undo do not see them.`,
      next: NEXT.recordEvents,
    };
  } catch (e) {
    return {
      key,
      state: "healthy",
      detail: `Not checked: the records could not be compared with the log (${e instanceof Error ? e.message : String(e)}).`,
      next: OK,
    };
  }
}

/**
 * The records.computed consumer and the fills it makes (computed fields: formula, lookup, rollup). A fill that is not done and has not moved for an hour is stuck (the pump gives up on an event after five tries, so a
 * fill that keeps failing is left half done and its field keeps showing as updating); the consumer is behind when its cursor trails the head of the log by more than a thousand events. Counts, types and fields,
 * never a value; read-only.
 */
export function computedFieldsFinding(
  spaceDb: string,
  modulesDb: string,
  eventsDb: string,
  now: number = Date.now(),
): Finding {
  const key = "records.computed";
  const STUCK_MS = 60 * 60_000;
  const LAG = 1000;
  if (!fs.existsSync(spaceDb)) return { key, state: "healthy", detail: "No records yet.", next: OK };
  try {
    const db = openDb(spaceDb, fs.existsSync(`${spaceDb}-wal`) ? { readOnly: true } : { immutable: true });
    let jobs: {
      type: string;
      field: string;
      done: number;
      total: number;
      state: string;
      updated_at: number | null;
      error: string | null;
    }[] = [];
    try {
      const has =
        db.all("SELECT 1 AS x FROM sqlite_master WHERE type = 'table' AND name = 'records_computed_job'").length > 0;
      if (has)
        jobs = db.all(
          "SELECT type, field, done, total, state, updated_at, error FROM records_computed_job WHERE state <> 'done'",
        ) as typeof jobs;
    } finally {
      db.close();
    }
    const stuck = jobs.filter(
      (j) => j.state === "failed" || j.updated_at === null || now - Number(j.updated_at) > STUCK_MS,
    );
    let lag = 0;
    try {
      if (fs.existsSync(modulesDb) && fs.existsSync(eventsDb)) {
        const m = openDb(modulesDb, fs.existsSync(`${modulesDb}-wal`) ? { readOnly: true } : { immutable: true });
        const e = openDb(eventsDb, fs.existsSync(`${eventsDb}-wal`) ? { readOnly: true } : { immutable: true });
        try {
          const cur = m.all("SELECT seq FROM host_hook_cursor WHERE name = 'records.computed'")[0] as
            | { seq: number }
            | undefined;
          const head = (e.all("SELECT max(seq) AS s FROM events")[0] as { s: number | null } | undefined)?.s ?? 0;
          if (cur) lag = Math.max(0, Number(head) - Number(cur.seq));
        } finally {
          m.close();
          e.close();
        }
      }
    } catch {
      lag = 0;
    }
    if (!stuck.length && lag <= LAG)
      return {
        key,
        state: "healthy",
        detail: jobs.length
          ? `${jobs.length} computed fields are being filled and moving.`
          : "Computed fields are up to date.",
        next: OK,
      };
    const parts: string[] = [];
    if (stuck.length)
      parts.push(
        `${stuck.length} computed fields are stuck half filled (${stuck
          .slice(0, 5)
          .map((j) => `${j.type}.${j.field} ${j.done} of ${j.total}${j.state === "failed" ? ", failed" : ""}`)
          .join("; ")}): their values may be missing or old`,
      );
    if (lag > LAG) parts.push(`the consumer that keeps computed values is ${lag} events behind`);
    return { key, state: "degraded", detail: `${parts.join("; ")}.`, next: NEXT.computedFields };
  } catch (e) {
    return { key, state: "healthy", detail: `Not checked: ${e instanceof Error ? e.message : String(e)}.`, next: OK };
  }
}

/**
 * Runs of Automations on record changes whose kept history may hold a value their person's access hides (24 Nov 2026). Before this release the trigger of such a Run carried the whole record and every
 * step could read it, so a person whose grant hides a field (hiddenFields) could have a Run, its kept trigger and the inputs and outputs of its steps, with that field's value in them; new Runs never keep it.
 * Read-only, counts and ids only, never a value. A person's own grants are read (a grant given through a role or a group is not), so the answer is a lower bound; a field is counted when the kept trigger
 * of a Run names a hidden field of its owner, and a step when its kept input or output holds that field's value as text.
 */
/** A value shorter than this is not searched for in the steps: a hidden `5` or `Yes` would be "found" in nearly every step. */
const MIN_SEARCHED = 4;
export function hiddenRunDataFinding(modulesDb: string): Finding {
  const key = "automations.hidden_run_data";
  if (!fs.existsSync(modulesDb)) return { key, state: "healthy", detail: "No Automations yet.", next: OK };
  try {
    const db = openDb(modulesDb, fs.existsSync(`${modulesDb}-wal`) ? { readOnly: true } : { immutable: true });
    try {
      const has = (t: string): boolean =>
        db.all("SELECT 1 AS x FROM sqlite_master WHERE type = 'table' AND name = ?", t).length > 0;
      if (!has("automations_defs") || !has("automations_runs") || !has("access_grants"))
        return { key, state: "healthy", detail: "No Automation runs to check.", next: OK };
      const hiddenOf = new Map<string, Set<string>>();
      for (const g of db.all(
        `SELECT "subjectId" AS who, "conditions" AS c FROM access_grants WHERE deleted_at IS NULL AND "conditions" LIKE '%hiddenFields%'`,
      ) as { who: string | null; c: string | null }[]) {
        try {
          const fields = (JSON.parse(g.c ?? "{}") as { hiddenFields?: unknown }).hiddenFields;
          if (g.who && Array.isArray(fields))
            hiddenOf.set(
              g.who,
              new Set([...(hiddenOf.get(g.who) ?? []), ...fields.filter((f): f is string => typeof f === "string")]),
            );
        } catch {
          /* a grant that does not parse names no field */
        }
      }
      if (!hiddenOf.size) return { key, state: "healthy", detail: "No grant hides a field.", next: OK };
      const automations = new Set<string>();
      const runs: string[] = [];
      let steps = 0;
      const hasSteps = has("runs_steps");
      for (const a of db.all(
        `SELECT id, owner_id AS owner, definition FROM automations_defs WHERE deleted_at IS NULL AND definition LIKE '%record_change%'`,
      ) as { id: string; owner: string; definition: string }[]) {
        const hidden = hiddenOf.get(a.owner);
        if (!hidden) continue;
        for (const r of db.all(`SELECT run_id AS id, payload FROM automations_runs WHERE automation_id = ?`, a.id) as {
          id: string;
          payload: string;
        }[]) {
          let p: { record?: unknown; changed?: unknown };
          try {
            p = JSON.parse(r.payload) as typeof p;
          } catch {
            continue;
          }
          const held: string[] = [];
          for (const part of [p.record, p.changed])
            if (part && typeof part === "object" && !Array.isArray(part))
              for (const [f, v] of Object.entries(part as Record<string, unknown>))
                if (hidden.has(f) && (typeof v === "string" || typeof v === "number") && String(v) !== "")
                  held.push(String(v));
          if (!held.length) continue;
          automations.add(a.id);
          runs.push(r.id);
          if (hasSteps)
            for (const s of db.all(
              `SELECT input_json AS i, output_json AS o FROM runs_steps WHERE run_id = ?`,
              r.id,
            ) as {
              i: string | null;
              o: string | null;
            }[]) {
              const text = `${s.i ?? ""}\n${s.o ?? ""}`;
              if (held.some((v) => v.length >= MIN_SEARCHED && text.includes(v))) steps++;
            }
        }
      }
      if (!runs.length)
        return { key, state: "healthy", detail: "No kept Run holds a field its person's access hides.", next: OK };
      return {
        key,
        state: "degraded",
        detail: `${runs.length} kept Runs of ${automations.size} Automations on record changes hold a field their person's access hides in the kept trigger; ${steps} steps hold such a value in their input or output (values shorter than ${MIN_SEARCHED} characters are not searched, so the count is a lower bound). Runs: ${runs.slice(0, 10).join(", ")}${runs.length > 10 ? ", and more" : ""}.`,
        next: NEXT.hiddenRunData,
      };
    } finally {
      db.close();
    }
  } catch (e) {
    return {
      key,
      state: "healthy",
      detail: `Not checked: the kept Runs could not be read (${e instanceof Error ? e.message : String(e)}).`,
      next: OK,
    };
  }
}

/**
 * Search entries that carry text of fields a type no longer has: the dropped text stayed findable on a Space that dropped a field before the index followed schema changes. The one-time scrub on the first start of this
 * build (modules/search/handlers/scrub.ts) reads the records again and keeps its count in search_meta: `before` entries found carrying such text, `after` the ones that still do. Read only.
 */
export function searchRemovedTextFinding(modulesDb: string): Finding {
  const key = "search.removed_field_text";
  if (!fs.existsSync(modulesDb)) return { key, state: "healthy", detail: "No search index yet.", next: OK };
  try {
    const db = openDb(modulesDb, fs.existsSync(`${modulesDb}-wal`) ? { readOnly: true } : { immutable: true });
    try {
      if (db.all("SELECT 1 AS x FROM sqlite_master WHERE type = 'table' AND name = 'search_meta'").length === 0)
        return { key, state: "healthy", detail: "No search index yet.", next: OK };
      const row = db.all("SELECT v FROM search_meta WHERE k = 'scrub:removed_fields'")[0] as { v: string } | undefined;
      if (!row)
        return {
          key,
          state: "degraded",
          detail: "search entries carrying removed-field text: not counted yet, the one-time check has not run.",
          next: NEXT.searchRemovedText,
        };
      const s = JSON.parse(row.v) as {
        state?: string;
        before?: number;
        after?: number;
        scanned?: number;
        total?: number;
        unreadable?: number;
        retry?: { n: number };
      };
      const before = Number(s.before ?? 0),
        after = Number(s.after ?? 0);
      if (s.state !== "done")
        return {
          key,
          state: "degraded",
          detail: `search entries carrying removed-field text: ${before} found so far, the one-time check has read ${Number(s.scanned ?? 0)} of ${Number(s.total ?? 0)} entries${s.retry ? `; a record that could not be read is being tried again (try ${s.retry.n})` : ""}${Number(s.unreadable ?? 0) ? `; ${Number(s.unreadable)} removed because their records could not be read` : ""}.`,
          next: NEXT.searchRemovedText,
        };
      const lost = Number(s.unreadable ?? 0);
      return {
        key,
        state: after === 0 ? "healthy" : "degraded",
        detail: `search entries carrying removed-field text: ${after} (the one-time check found ${before} and rebuilt them${lost ? `; ${lost} were removed because their records could not be read, and come back when the record is next edited` : ""}).`,
        next: after === 0 ? OK : NEXT.searchRemovedText,
      };
    } finally {
      db.close();
    }
  } catch (e) {
    return {
      key,
      state: "healthy",
      detail: `Not checked: the search index could not be read (${e instanceof Error ? e.message : String(e)}).`,
      next: OK,
    };
  }
}

/** Records that exist but had no search entry, put in by the same one-time job (`added` in its row). Read only. */
export function searchMissingRecordsFinding(modulesDb: string): Finding {
  const key = "search.missing_records";
  const none = (detail: string): Finding => ({ key, state: "healthy", detail, next: OK });
  if (!fs.existsSync(modulesDb)) return none("No search index yet.");
  try {
    const db = openDb(modulesDb, fs.existsSync(`${modulesDb}-wal`) ? { readOnly: true } : { immutable: true });
    try {
      if (db.all("SELECT 1 AS x FROM sqlite_master WHERE type = 'table' AND name = 'search_meta'").length === 0)
        return none("No search index yet.");
      const row = db.all("SELECT v FROM search_meta WHERE k = 'scrub:removed_fields'")[0] as { v: string } | undefined;
      if (!row)
        return {
          key,
          state: "degraded",
          detail: "records without a search entry: not counted yet, the one-time check has not run.",
          next: NEXT.searchRemovedText,
        };
      const s = JSON.parse(row.v) as { state?: string; added?: number };
      const added = Number(s.added ?? 0);
      return s.state === "done"
        ? none(`records without a search entry: 0 (the one-time check put in ${added} that had none).`)
        : {
            key,
            state: "degraded",
            detail: `records without a search entry: ${added} put in so far, the one-time check is still running.`,
            next: NEXT.searchRemovedText,
          };
    } finally {
      db.close();
    }
  } catch (e) {
    return none(`Not checked: the search index could not be read (${e instanceof Error ? e.message : String(e)}).`);
  }
}

/** A field or type was purged for good but the Space file could not hand its freed pages back (an older file without incremental vacuum): the values are zeroed, the pages stay until the planned compact. Read only. */
export function purgeOwedCompactFinding(spaceDb: string): Finding {
  const key = "schema.purge_owed_compact";
  if (!fs.existsSync(spaceDb)) return { key, state: "healthy", detail: "No Space file yet.", next: OK };
  try {
    const db = openDb(spaceDb, fs.existsSync(`${spaceDb}-wal`) ? { readOnly: true } : { immutable: true });
    try {
      if (db.all("SELECT 1 AS x FROM sqlite_master WHERE type = 'table' AND name = 'sc_purge_owed'").length === 0)
        return { key, state: "healthy", detail: "No purge is waiting for a compact.", next: OK };
      const r = db.all("SELECT count(*) AS n, max(bytes) AS b, max(at) AS at FROM sc_purge_owed")[0] as {
        n: number;
        b: number | null;
        at: number | null;
      };
      if (!r.n) return { key, state: "healthy", detail: "No purge is waiting for a compact.", next: OK };
      return {
        key,
        state: "degraded",
        detail: `${r.n} purged fields or types left freed pages in the Space file (${Math.round((r.b ?? 0) / 1048576)} MB): their values are zeroed, the pages are handed back by the planned compact.`,
        next: NEXT.purgeOwedCompact,
      };
    } finally {
      db.close();
    }
  } catch (e) {
    return {
      key,
      state: "healthy",
      detail: `Not checked: the Space file could not be read (${e instanceof Error ? e.message : String(e)}).`,
      next: OK,
    };
  }
}

/** The journal of the search index (modules.db-wal) could not be folded in after a purge, after every try: the removed text may still be in that file until the next start. Read only. */
export function journalNotFoldedFinding(modulesDb: string): Finding {
  const key = "host.journal_not_folded";
  if (!fs.existsSync(modulesDb)) return { key, state: "healthy", detail: "No modules database yet.", next: OK };
  try {
    const db = openDb(modulesDb, fs.existsSync(`${modulesDb}-wal`) ? { readOnly: true } : { immutable: true });
    try {
      if (db.all("SELECT 1 AS x FROM sqlite_master WHERE type = 'table' AND name = 'host_journal_owed'").length === 0)
        return { key, state: "healthy", detail: "No journal is waiting to be folded in.", next: OK };
      const n = Number((db.all("SELECT count(*) AS n FROM host_journal_owed")[0] as { n: number }).n);
      return n === 0
        ? { key, state: "healthy", detail: "No journal is waiting to be folded in.", next: OK }
        : {
            key,
            state: "degraded",
            detail: `${n} times the search index's journal could not be folded in after a purge (the removed text may still be in modules.db-wal).`,
            next: NEXT.journalNotFolded,
          };
    } finally {
      db.close();
    }
  } catch (e) {
    return {
      key,
      state: "healthy",
      detail: `Not checked: the modules database could not be read (${e instanceof Error ? e.message : String(e)}).`,
      next: OK,
    };
  }
}

function logsFinding(file: string, now: number): Finding {
  if (!fs.existsSync(file)) return { key: "logs.errors", state: "healthy", detail: "No log file yet.", next: OK };
  try {
    // logs.db is WAL: with no -wal beside it the daemon closed it and nothing writes it, so it is read as it is and no journal files are made in the data directory
    const db = openDb(file, fs.existsSync(`${file}-wal`) ? { readOnly: true } : { immutable: true });
    try {
      const since = now - 86_400_000;
      const total = (db.all("SELECT COUNT(*) AS n FROM logs WHERE level >= 40 AND at >= ?", since)[0] as { n: number })
        .n;
      if (!total) return { key: "logs.errors", state: "healthy", detail: "No errors in the last 24 hours.", next: OK };
      const top = db.all(
        "SELECT msg, COUNT(*) AS n FROM logs WHERE level >= 40 AND at >= ? GROUP BY msg ORDER BY n DESC LIMIT 3",
        since,
      ) as { msg: string; n: number }[];
      return {
        key: "logs.errors",
        state: "degraded",
        detail: `${total} errors in the last 24 hours (${top.map((t) => `${t.msg} x${t.n}`).join(", ")}).`,
        next: NEXT.logs,
      };
    } finally {
      db.close();
    }
  } catch (e) {
    return {
      key: "logs.errors",
      state: "degraded",
      detail: `logs.db cannot be read: ${e instanceof Error ? e.message : String(e)}`,
      next: NEXT.logs,
    };
  }
}

/** The own-domain address the Space recorded in modules.db (network_config), or null for a relay Space, a Space with no address, or no modules.db yet. Read-only, like the rest. */
function ownDomain(file: string): string | null {
  if (!fs.existsSync(file)) return null;
  try {
    const db = openDb(file, fs.existsSync(`${file}-wal`) ? { readOnly: true } : { immutable: true });
    try {
      const row = db.all("SELECT address, mode FROM network_config WHERE id = 1")[0] as
        | { address?: string; mode?: string }
        | undefined;
      return row?.mode === "own_domain" ? ingressHostOf(row.address) : null;
    } finally {
      db.close();
    }
  } catch {
    return null;
  } // no network table yet: nothing to check
}

/** A Space with its own domain needs its route in Caddy, or https://<domain>/ refuses connections (the claim link included). */
async function ingressFinding(host: string, f: FetchFn | null, adminUrl: string): Promise<Finding> {
  const key = "host.ingress";
  if (!f)
    return {
      key,
      state: "degraded",
      detail: `Could not check the route for ${host}: no HTTP client to reach the Caddy admin API.`,
      next: NEXT.ingress,
    };
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 3000);
    timer.unref();
    const r = await f(`${adminUrl.replace(/\/$/, "")}/config/`, {
      signal: ctl.signal,
      headers: { origin: new URL(adminUrl).origin },
    }).finally(() => clearTimeout(timer));
    if (!r.ok)
      return {
        key,
        state: "degraded",
        detail: `Could not check the route for ${host}: Caddy admin answered ${r.status}.`,
        next: NEXT.caddy,
      };
    const text = (await r.text()).trim();
    const config = text && text !== "null" ? (JSON.parse(text) as Record<string, unknown>) : undefined;
    return routesOf(config).map(hostOf).includes(host)
      ? { key, state: "healthy", detail: `Caddy routes ${host} to vyred.`, next: OK }
      : {
          key,
          state: "down",
          detail: `Caddy has no route for ${host}, so https://${host}/ refuses connections.`,
          next: NEXT.ingress,
        };
  } catch {
    return {
      key,
      state: "degraded",
      detail: `Could not check the route for ${host}: the Caddy admin API does not answer. Caddy restarts by itself within a minute of vyred restarting; if it stays down, run vyre-server restart on the server.`,
      next: NEXT.caddy,
    };
  }
}

/** The Space's own artifact address (a.<address>) must resolve to this server and answer with this Space's marker, or artifact pages cannot open. Says which DNS record to add when it does not. */
async function artifactAddressFinding(domain: string, spaceId: string, f: FetchFn | null): Promise<Finding | null> {
  const host = artifactHostOf(domain, null);
  if (!host) return null;
  const key = "host.artifact_host";
  const record = `${host} (an A record to this server's public address, the same as ${domain})`;
  const next = `Add the DNS record ${record}, then run vyre-server doctor again. The server's own check passes within a minute of it and artifact pages open.`;
  if (!f) return { key, state: "degraded", detail: `Could not check ${host}: no HTTP client.`, next };
  try {
    const r = await askArtifactHost(f, host, "/.well-known/vyre-artifact-host");
    const body = r.body;
    if (r.ok && body === artifactMarkerOf(spaceId))
      return { key, state: "healthy", detail: `${host} reaches this Space.`, next: OK };
    return {
      key,
      state: "degraded",
      detail: r.ok
        ? `${host} answers, but not as this Space, so artifact pages cannot open.`
        : `${host} answered ${r.status}, not this Space, so artifact pages cannot open.`,
      next,
    };
  } catch {
    return {
      key,
      state: "degraded",
      detail: `${host} does not answer (no DNS record or no certificate yet), so artifact pages cannot open.`,
      next,
    };
  }
}

export async function runDoctor(o: DoctorOptions): Promise<DoctorReport> {
  const platform = o.platform ?? nodePlatform();
  const now = o.now ?? Date.now;
  const paths = pathsFor(o.dataDir);
  const space = (o.role ?? "space") === "space";
  const findings: Finding[] = [];

  const info = readInfo(paths);
  findings.push(
    info && alive(info.pid)
      ? { key: "daemon.process", state: "healthy", detail: `vyred runs as pid ${info.pid} on ${info.url}.`, next: OK }
      : { key: "daemon.process", state: "degraded", detail: "vyred is not running.", next: NEXT.process },
  );
  const disk = await (o.diskEncrypted ? o.diskEncrypted() : probes.diskEncrypted(platform, o.dataDir, o.diskChoice));
  findings.push(finding("host.disk_encrypted", disk, diskNext(disk.detail)));
  const root = dockerRootFinding(o.dockerRoot, o.diskChoice?.kind === "detected", o.diskChoice?.kind);
  if (root) findings.push(root);
  findings.push(finding("host.disk_space", probes.diskSpace(platform, o.dataDir), NEXT.space));
  if (space) {
    findings.push(eventsFinding(paths.events, o.chainTail));
    findings.push(recordEventsFinding(`${o.dataDir.replace(/\/$/, "")}/space.db`, paths.events));
    findings.push(hiddenRunDataFinding(paths.modules));
    findings.push(computedFieldsFinding(`${o.dataDir.replace(/\/$/, "")}/space.db`, paths.modules, paths.events));
    findings.push(searchRemovedTextFinding(paths.modules));
    findings.push(searchMissingRecordsFinding(paths.modules));
    findings.push(journalNotFoldedFinding(paths.modules));
    findings.push(purgeOwedCompactFinding(`${o.dataDir.replace(/\/$/, "")}/space.db`));
    findings.push(finding("host.docker", await probes.docker(platform), NEXT.docker));
    const f = o.fetch === undefined ? (typeof fetch === "function" ? (fetch as unknown as FetchFn) : null) : o.fetch;
    findings.push(
      finding(
        "host.caddy",
        f
          ? await probes.caddy(f, o.caddyAdmin ?? "http://127.0.0.1:2019", now)
          : { state: "down", detail: "No HTTP client to reach the Caddy admin API." },
        NEXT.caddy,
      ),
    );
    const domain = ownDomain(paths.modules);
    if (domain) findings.push(await ingressFinding(domain, f, o.caddyAdmin ?? "http://127.0.0.1:2019"));
    if (domain && o.artifactAddress) {
      let spaceId: string | undefined;
      try {
        const db = openDb(paths.events, { readOnly: true });
        try {
          spaceId = (db.all("SELECT value FROM log_meta WHERE key = 'space'")[0] as { value?: string } | undefined)
            ?.value;
        } finally {
          db.close();
        }
      } catch {
        /* no readable log: verifyChain says so */
      }
      const art = spaceId ? await artifactAddressFinding(domain, spaceId, f) : null;
      if (art) findings.push(art);
    }
  }
  findings.push(logsFinding(paths.logs, now()));
  return { ok: findings.every((x) => x.state === "healthy"), dataDir: o.dataDir, findings };
}

/** The text `vyre-server doctor` prints: one line per check, the next step under each one that is not healthy. */
export function formatDoctor(r: DoctorReport): string {
  const width = Math.max(...r.findings.map((f) => f.key.length));
  const lines = r.findings.flatMap((f) => [
    `${f.state.padEnd(8)} ${f.key.padEnd(width)}  ${f.detail}`,
    ...(f.state === "healthy" ? [] : [`${" ".repeat(9)}${" ".repeat(width)}  Next: ${f.next}`]),
  ]);
  return `${lines.join("\n")}\n${r.ok ? "Everything checks out." : "Some checks need attention."}\n`;
}
