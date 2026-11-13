// A real SQLite behind the host's own guard, with this module's migration applied and three stand-in kinds of thing (a conversation, a chat, a note) that differ only in what brings a done thing back.
// The stand-ins keep their entries in `fx_*` tables the way a real module keeps its messages; the seam reads them through the kind it was given.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { openDb } from "../../../host/src/daemon/sqlite.ts";
import type { HostDb } from "../../../host/src/daemon/sqlite.ts";
import { scopedDb } from "../../../host/src/ctx/db.ts";
import { registerStateKind, stateSeamOf } from "../../../host/src/seams/state.ts";
import type { StateKind } from "../../../host/src/seams/state.ts";
import type { Reopen } from "../../../lib/state.ts";
import type { StateCtx } from "../projections.ts";

export const NOW = 1_760_000_000_000;
export const TRACE = "0123456789abcdef0123456789abcdef";
export const MAYA = "usr_maya";
export const JONAS = "usr_jonas";
export const OMAR = "usr_omar";
export const HELPER = "agt_helper";
export const STRANGER = "outside@example.com";
export const MIGRATION = fileURLToPath(new URL("../migrations/0001_state.sql", import.meta.url));

const FIXTURE_TABLES = `
CREATE TABLE IF NOT EXISTS fx_thing (id TEXT PRIMARY KEY, kind TEXT NOT NULL, scope TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS fx_member (thing TEXT NOT NULL, person TEXT NOT NULL, PRIMARY KEY (thing, person));
CREATE TABLE IF NOT EXISTS fx_entry (thing TEXT NOT NULL, pos INTEGER NOT NULL, by TEXT, at INTEGER NOT NULL, PRIMARY KEY (thing, pos));
`;

/** The stand-in kind: its entries, members and scope are rows of fx_*. */
export const fixtureKind = (type: string, reopen: Reopen): StateKind => ({
  type,
  reopen,
  audience: (db, thing) => (db.all("SELECT person FROM fx_member WHERE thing = ?", thing) as { person: string }[]).map((r) => r.person),
  scope: (db, thing) => (db.all("SELECT scope FROM fx_thing WHERE id = ?", thing)[0] as { scope: string } | undefined)?.scope ?? "box:main",
  entries: (db, thing) => db.all("SELECT pos, by FROM fx_entry WHERE thing = ? ORDER BY pos", thing) as { pos: number; by: string | null }[],
  heads: (db) =>
    (
      db.all(
        "SELECT e.thing AS thing, MAX(e.pos) AS head, MAX(e.at) AS at FROM fx_entry e JOIN fx_thing t ON t.id = e.thing WHERE t.kind = ? GROUP BY e.thing",
        type,
      ) as { thing: string; head: number; at: number }[]
    ).map((r) => ({ thing: r.thing, head: r.head, at: r.at })),
});

export interface Fx {
  db: HostDb;
  /** a thing of a kind, with its members and the badge it counts in */
  make(type: string, id: string, members: string[], scope?: string): { type: string; id: string };
  /** the module's own insert: a new entry at the next position. No state is touched. */
  insert(thing: { type: string; id: string }, by: string | null, at?: number): number;
  /** the module's insert, then the seam call right after it, as a module does */
  post(thing: { type: string; id: string }, by: string | null, opts?: { at?: number; mentions?: string[] }): number;
  /** the module removes its newest entry (no state is touched) */
  removeNewest(thing: { type: string; id: string }): void;
  clock: { t: number };
}

export function openFx(file = ":memory:"): Fx {
  const db = openDb(file);
  db.exec(readFileSync(MIGRATION, "utf8"));
  db.exec(FIXTURE_TABLES);
  registerStateKind(db, fixtureKind("conversation", "new_entry"));
  registerStateKind(db, fixtureKind("chat", "mention"));
  registerStateKind(db, fixtureKind("note", "never"));
  return fxOn(db);
}

/** The same fixture on a database that is already open (a second connection to the same file, after a "crash"). */
export function fxOn(db: HostDb): Fx {
  const clock = { t: NOW };
  registerStateKind(db, fixtureKind("conversation", "new_entry"));
  registerStateKind(db, fixtureKind("chat", "mention"));
  registerStateKind(db, fixtureKind("note", "never"));
  const fx: Fx = {
    db,
    clock,
    make(type, id, members, scope = "box:main") {
      db.run("INSERT OR REPLACE INTO fx_thing (id, kind, scope) VALUES (?, ?, ?)", id, type, scope);
      db.run("DELETE FROM fx_member WHERE thing = ?", id);
      for (const m of members) db.run("INSERT INTO fx_member (thing, person) VALUES (?, ?)", id, m);
      return { type, id };
    },
    insert(thing, by, at) {
      const pos = ((db.all("SELECT COALESCE(MAX(pos), 0) AS p FROM fx_entry WHERE thing = ?", thing.id)[0] as { p: number }).p ?? 0) + 1;
      db.run("INSERT INTO fx_entry (thing, pos, by, at) VALUES (?, ?, ?, ?)", thing.id, pos, by, at ?? (clock.t += 1000));
      return pos;
    },
    post(thing, by, opts = {}) {
      const at = opts.at ?? (clock.t += 1000);
      const pos = fx.insert(thing, by, at);
      stateOf(fx).arrive(thing, { pos, by, at, ...(opts.mentions ? { mentions: opts.mentions } : {}) });
      return pos;
    },
    removeNewest(thing) {
      db.run("DELETE FROM fx_entry WHERE thing = ? AND pos = (SELECT MAX(pos) FROM fx_entry WHERE thing = ?)", thing.id, thing.id);
    },
  };
  return fx;
}

/** The seam as a module's handler gets it: from the module's guarded handle. */
export const stateOf = (fx: Fx) => stateSeamOf(scopedDb("state", fx.db, TRACE), () => fx.clock.t);

export interface Emitted {
  name: string;
  subject: string;
  payload: Record<string, unknown>;
}

export interface Harness {
  fx: Fx;
  emitted: Emitted[];
  calls: { cap: string; input: unknown }[];
  /** a ctx for a caller; `settings` answers `settings.get` for the agent switch */
  as(principal: StateCtx["principal"], opts?: { actingFor?: string; triage?: boolean | "unreadable" }): StateCtx;
  person(id: string): StateCtx;
}

export function harness(fx: Fx = openFx()): Harness {
  const emitted: Emitted[] = [];
  const calls: { cap: string; input: unknown }[] = [];
  const h: Harness = {
    fx,
    emitted,
    calls,
    as(principal, opts = {}) {
      return {
        space: "spc_test",
        principal,
        ...(opts.actingFor === undefined ? {} : { actingFor: opts.actingFor }),
        trace: { traceId: TRACE },
        now: () => fx.clock.t,
        db: scopedDb("state", fx.db, TRACE),
        emit(name, subject, payload) {
          emitted.push({ name, subject, payload: payload as Record<string, unknown> });
          return null;
        },
        async call(cap, input) {
          calls.push({ cap, input });
          if (cap !== "settings.get") throw new Error(`${cap} is not available`);
          if (opts.triage === "unreadable") throw new Error("settings are not available");
          return { row: { value: opts.triage === true } };
        },
        log: { warn() {} },
      };
    },
    person: (id) => h.as({ kind: "person", id }),
  };
  return h;
}

/** The error code of a call that must fail, or "none". */
export async function failure(f: () => unknown): Promise<string> {
  try {
    await f();
  } catch (e) {
    return (e as { error?: { code?: string } })?.error?.code ?? "unknown";
  }
  return "none";
}
