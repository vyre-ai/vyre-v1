// The state seam (contract P2): the one place that writes a thing's row (`state_thing`), every person's row (`state_person`) and the badge counts (`state_count`).
// A module cannot write `state_*` through ctx.db (the guard in ctx/db.ts allows only `<module>_...`), so a module that has things with entries registers a kind here and calls the seam; the host
// reaches the module's raw connection with `rawDbOf` and does every write of one call inside ONE transaction (`HostDb.tx`), so a person's row and the count it feeds can never disagree after a crash.
// What is NOT atomic is the module's own insert and the seam call after it: a capability handler has no transaction around it (consumers.ts says so). That is made safe, not atomic:
//   1 `arrive` is idempotent on (thing, position): an entry at or below the head is ignored.
//   2 the module calls `arrive` right after its insert, before it returns.
//   3 `verify` compares the head with the module's real newest position (`kind.heads`) and replays a missing arrival; it runs at module start and in the doctor.
// So the worst outcome of a crash between the two commits is one entry not counted until the next verify, never a wrong number that stays.
// The arithmetic is lib/state.ts, the same functions a device replica runs. Nothing here emits events: the capabilities in modules/state do.
import {
  arrive as arriveRow,
  blank,
  changedFlags,
  delta,
  isMuted,
  unmuted,
  isZero,
  joinScope,
  merge as mergeRows,
  read as readRow,
  recount,
  set as setRow,
  splitScope,
  unreadOf,
} from "../../../lib/state.ts";
import type { Change, Entry, Flag, PersonState, Reopen } from "../../../lib/state.ts";
import { rawDbOf } from "../ctx/db.ts";
import type { RawDb } from "../ctx/db.ts";

/** The module's raw connection. `tx` is there on the real database; a hand-built test fake without it runs the writes one by one. */
export type StateDb = RawDb & { tx?<T>(fn: () => T): T };

export interface Thing {
  type: string;
  id: string;
}

/**
 * What the caller of the seam knows that a kind may need and a database cannot say: the Space's people, and whether one person may open a resource. The store is synchronous, so the caller
 * (a handler, which has `ctx`) reads these first (host/src/seams/state-env.ts) and hands them in. `NO_ENV` for a caller that has nothing to say; a kind that needs more says so by answering less.
 */
export interface StateEnv {
  /** every active person of the Space */
  people: readonly string[];
  /** may this person open this resource? An answer that cannot be had is no. */
  mayView(person: string, type: string, id: string): boolean;
}
export const NO_ENV: StateEnv = { people: [], mayView: () => false };

/** What a module says about its things, once. The functions read the module's own tables through the raw connection. */
export interface StateKind {
  /** the kind of thing: `conversation`, `chat`, `notice` */
  type: string;
  /** everyone who can see the thing now (people; an agent that follows it counts too) */
  audience(db: RawDb, thing: string, env: StateEnv): readonly string[];
  /** the badge the thing counts in: `mailbox:mbx_a`, `chats`, `notices:inbox` */
  scope(db: RawDb, thing: string): string;
  /** the thing's entries, in any order */
  entries(db: RawDb, thing: string): readonly Entry[];
  /** the newest position of every thing of this kind that has entries, in one query: what `verify` compares with the head it kept */
  heads(db: RawDb): readonly { thing: string; head: number; at?: number }[];
  reopen: Reopen;
  /** may this person see the thing? Absent: they are in the audience */
  visible?(db: RawDb, thing: string, person: string, env: StateEnv): boolean;
}

export class StateRefusal extends Error {
  readonly code: "not_found" | "bad_input";
  constructor(code: "not_found" | "bad_input", message: string) {
    super(message);
    this.name = "StateRefusal";
    this.code = code;
  }
}

// the kinds are kept per database, so two daemons in one process (the two-computer tests) never share them
const KINDS = new WeakMap<object, Map<string, StateKind>>();

export function registerStateKind(db: RawDb, kind: StateKind): void {
  const have = KINDS.get(db) ?? new Map<string, StateKind>();
  have.set(kind.type, kind);
  KINDS.set(db, have);
}

/** Register what each live module exports as `stateKinds` (an array of kinds). Called once at boot, before the first `verify`. */
export function bindStateKinds(db: RawDb, exportsByModule: ReadonlyMap<string, Record<string, unknown>>): string[] {
  const bound: string[] = [];
  for (const ns of exportsByModule.values()) {
    const list = ns["stateKinds"];
    if (!Array.isArray(list)) continue;
    for (const k of list as StateKind[]) {
      registerStateKind(db, k);
      bound.push(k.type);
    }
  }
  return bound;
}

export interface Problem {
  kind: "head" | "unread" | "count";
  detail: string;
  person?: string;
  thing?: Thing;
  scope?: string;
}
export interface VerifyOptions {
  person?: string;
  scope?: string;
  /** fix what is found (replay a missing arrival, recount, rewrite a count) */
  repair?: boolean;
  /** recount every row of every thing from its entries (tests, release evidence), not only the things whose head differs */
  deep?: boolean;
}
export interface VerifyReport {
  problems: Problem[];
  repaired: number;
}

export interface ThingState {
  thing: Thing;
  readUpto: number;
  unread: number;
  done: number | null;
  starred: number | null;
  follow: "following" | "left" | null;
  alert: boolean;
  muted: number | null;
}

export type ListFlag = "starred" | "following" | "done" | "unread" | "muted";
export interface ListQuery {
  flag: ListFlag;
  type?: string;
  scope?: string;
  limit: number;
  cursor?: string;
}
export interface ListRow {
  thing: Thing;
  at: number;
  unread: number;
}

type Row = Record<string, unknown>;
const num = (v: unknown): number => (typeof v === "number" ? v : Number(v ?? 0));
const numOrNull = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

const STATE_COLS = "read_upto, unread, done_at, starred_at, follow, alert, muted_until, hidden, scope_type, scope_id";
function toState(r: Row): PersonState {
  return {
    readUpto: num(r["read_upto"]),
    unread: num(r["unread"]),
    doneAt: numOrNull(r["done_at"]),
    starredAt: numOrNull(r["starred_at"]),
    follow: r["follow"] === "following" || r["follow"] === "left" ? r["follow"] : null,
    alert: num(r["alert"]) === 1,
    mutedUntil: numOrNull(r["muted_until"]),
    hidden: num(r["hidden"]) === 1,
  };
}
const view = (thing: Thing, s: PersonState, at: number): ThingState => ({
  thing,
  readUpto: s.readUpto,
  unread: s.hidden ? 0 : s.unread,
  done: s.doneAt,
  starred: s.starredAt,
  follow: s.follow,
  alert: s.alert,
  muted: isMuted(s, at) ? s.mutedUntil : null,
});

export interface StateStore {
  /** a new entry reached a thing: raises the head, moves every audience member's row and badge in one transaction. Idempotent on position. */
  arrive(thing: Thing, a: { pos: number; by: string | null; at: number; mentions?: readonly string[] }): ArriveResult;
  /** an entry was removed: every row of the thing is recounted from its entries */
  retract(thing: Thing): void;
  /** `from` became part of `to` (the module already moved the entries): each person's flags are merged and the rows recounted */
  merge(from: Thing, to: Thing): void;
  /** a merge was undone (the module already moved the entries back to `to`, a thing that has none now): each person's row on `from` is copied to `to`, and both are recounted from their entries */
  split(from: Thing, to: Thing): void;
  /**
   * The start for a thing that has entries and no state yet (a module's one-time backfill): `reads` is each person's place in it. A person who already has a row is left alone, so running it twice
   * changes nothing. Answers how many rows it made.
   */
  seed(thing: Thing, at: number, reads: ReadonlyMap<string, number>): number;
  /** a person gets access to a scope: they start with nothing unread; flags they had before come back */
  gain(person: string, scope: string): number;
  /** a person loses access to a scope: its rows leave their lists and badge at once; done and star are kept */
  lose(person: string, scope: string): number;
  /** the thing was deleted or purged: every row and count of it goes */
  forget(thing: Thing): void;
  /** clear every mute whose time has passed, so those things count in a badge again; answers who and what */
  sweep(): { person: string; thing: Thing }[];
  verify(o?: VerifyOptions): VerifyReport;
  followersOf(thing: Thing): string[];
  stateOf(person: string, things: readonly Thing[]): ThingState[];
  canSee(person: string, thing: Thing): boolean;
  /** `trusted`: the caller has already decided the person may open the thing (the module's own guard ran), so the kind is not asked again */
  read(person: string, thing: Thing, req: ReadRequestIn, o?: { trusted?: boolean }): ChangeResult;
  readScope(person: string, scope: string, before?: number): { marked: number; things: Thing[] };
  set(person: string, thing: Thing, change: Change, o?: { trusted?: boolean }): ChangeResult;
  list(person: string, q: ListQuery): { rows: ListRow[]; next?: string };
  counts(person: string, scopes?: readonly string[]): { scope: string; things: number; entries: number }[];
}
export type ReadRequestIn = { upto: number } | { unread: true } | { fromPos: number };
export interface ArriveResult {
  applied: boolean;
  people: number;
}
export interface ChangeResult {
  state: ThingState;
  changed: Flag[];
}

export function createStateStore(db: StateDb, now: () => number, env: StateEnv = NO_ENV): StateStore {
  const kinds = KINDS.get(db) ?? new Map<string, StateKind>();
  const tx = <T>(fn: () => T): T => (db.tx ? db.tx(fn) : fn());
  const kindOf = (type: string): StateKind => {
    const k = (KINDS.get(db) ?? kinds).get(type);
    if (!k) throw new StateRefusal("bad_input", `Nothing keeps state for ${type}.`);
    return k;
  };

  const headRow = (t: Thing): { head: number; headAt: number | null; scope: string } | null => {
    const r = db.all(
      "SELECT head, head_at, scope_type, scope_id FROM state_thing WHERE type = ? AND id = ?",
      t.type,
      t.id,
    )[0] as Row | undefined;
    return r
      ? {
          head: num(r["head"]),
          headAt: numOrNull(r["head_at"]),
          scope: joinScope(String(r["scope_type"]), String(r["scope_id"])),
        }
      : null;
  };
  const rowOf = (person: string, t: Thing): PersonState | null => {
    const r = db.all(
      `SELECT ${STATE_COLS} FROM state_person WHERE person = ? AND type = ? AND id = ?`,
      person,
      t.type,
      t.id,
    )[0] as Row | undefined;
    return r ? toState(r) : null;
  };
  const bump = (person: string, scope: string, d: { things: number; entries: number }): void => {
    if (isZero(d)) return;
    const s = splitScope(scope);
    db.run(
      `INSERT INTO state_count (person, scope_type, scope_id, things, entries) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (person, scope_type, scope_id) DO UPDATE SET things = things + excluded.things, entries = entries + excluded.entries`,
      person,
      s.type,
      s.id,
      d.things,
      d.entries,
    );
  };
  /** write one person's row and move their badge by what changed, together */
  const put = (person: string, t: Thing, scope: string, before: PersonState | null, after: PersonState): void => {
    const s = splitScope(scope);
    const at = now();
    db.run(
      `INSERT INTO state_person (person, type, id, read_upto, unread, done_at, starred_at, follow, alert, muted_until, scope_type, scope_id, hidden, version, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
       ON CONFLICT (person, type, id) DO UPDATE SET read_upto = excluded.read_upto, unread = excluded.unread, done_at = excluded.done_at, starred_at = excluded.starred_at,
         follow = excluded.follow, alert = excluded.alert, muted_until = excluded.muted_until, scope_type = excluded.scope_type, scope_id = excluded.scope_id,
         hidden = excluded.hidden, version = version + 1, updated_at = excluded.updated_at`,
      person,
      t.type,
      t.id,
      after.readUpto,
      after.unread,
      after.doneAt,
      after.starredAt,
      after.follow,
      after.alert ? 1 : 0,
      after.mutedUntil,
      s.type,
      s.id,
      after.hidden ? 1 : 0,
      at,
    );
    bump(person, scope, delta(before, after));
  };
  const drop = (person: string, t: Thing, scope: string, before: PersonState): void => {
    db.run("DELETE FROM state_person WHERE person = ? AND type = ? AND id = ?", person, t.type, t.id);
    bump(person, scope, delta(before, null));
  };

  /** who an entry reaches: everyone who can see the thing now. An author from outside (a sender with no account) has no row. */
  const people = (k: StateKind, t: Thing): string[] => [...new Set(k.audience(db, t.id, env))];

  /** the arrival itself; `thingRow` is what the head was before it */
  const applyArrival = (
    t: Thing,
    k: StateKind,
    a: { pos: number; by: string | null; at: number; mentions?: readonly string[] },
    headBefore: number,
    scope: string,
  ): number => {
    db.run(
      `INSERT INTO state_thing (type, id, head, head_at, scope_type, scope_id) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (type, id) DO UPDATE SET head = excluded.head, head_at = excluded.head_at, scope_type = excluded.scope_type, scope_id = excluded.scope_id`,
      t.type,
      t.id,
      a.pos,
      a.at,
      splitScope(scope).type,
      splitScope(scope).id,
    );
    const who = people(k, t);
    for (const person of who) {
      const before = rowOf(person, t);
      const after = arriveRow(before, {
        headBefore,
        pos: a.pos,
        person,
        by: a.by,
        mentioned: a.mentions?.includes(person) ?? false,
        reopen: k.reopen,
      });
      put(person, t, scope, before, after);
    }
    return who.length;
  };

  const arrive: StateStore["arrive"] = (t, a) =>
    tx(() => {
      const k = kindOf(t.type);
      const have = headRow(t);
      if (have && a.pos <= have.head) return { applied: false, people: 0 };
      return { applied: true, people: applyArrival(t, k, a, have?.head ?? 0, k.scope(db, t.id)) };
    });

  /** every row of the thing, recounted from the entries the module holds now */
  /** make or move a thing's row: its head is the newest entry at or below `cap` */
  const upsertThing = (t: Thing, cap: number, at: number, scope: string, k: StateKind): void => {
    const head = k.entries(db, t.id).reduce((m, e) => (e.pos <= cap ? Math.max(m, e.pos) : m), 0);
    db.run(
      `INSERT INTO state_thing (type, id, head, head_at, scope_type, scope_id) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (type, id) DO UPDATE SET head = excluded.head, head_at = excluded.head_at, scope_type = excluded.scope_type, scope_id = excluded.scope_id`,
      t.type,
      t.id,
      head,
      at,
      splitScope(scope).type,
      splitScope(scope).id,
    );
  };

  /**
   * Every row of the thing, recounted from the entries the module holds now. `cap`: entries after this position are not counted and the head stays at or below it (a merge or a split must not
   * count an entry whose arrival has not been made yet; `arrive` does that, with its rules for who it reaches and what it reopens).
   */
  const recountThing = (t: Thing, k: StateKind, cap?: number): void => {
    const all = k.entries(db, t.id);
    const entries = cap === undefined ? all : all.filter((e) => e.pos <= cap);
    const head = entries.reduce((m, e) => Math.max(m, e.pos), 0);
    const have = headRow(t);
    const scope = have?.scope ?? k.scope(db, t.id);
    if (have && have.head !== head) {
      db.run("UPDATE state_thing SET head = ? WHERE type = ? AND id = ?", head, t.type, t.id);
    }
    for (const r of db.all(
      "SELECT person, " + STATE_COLS + " FROM state_person WHERE type = ? AND id = ?",
      t.type,
      t.id,
    ) as Row[]) {
      const person = String(r["person"]);
      const before = toState(r);
      const after = recount({ ...before, readUpto: Math.min(before.readUpto, head) }, entries, person);
      if (after.unread !== before.unread || after.readUpto !== before.readUpto) put(person, t, scope, before, after);
    }
  };

  const retract: StateStore["retract"] = (t) => tx(() => recountThing(t, kindOf(t.type)));

  const forget: StateStore["forget"] = (t) =>
    tx(() => {
      for (const r of db.all(
        "SELECT person, " + STATE_COLS + " FROM state_person WHERE type = ? AND id = ?",
        t.type,
        t.id,
      ) as Row[]) {
        const before = toState(r);
        drop(String(r["person"]), t, joinScope(String(r["scope_type"]), String(r["scope_id"])), before);
      }
      db.run("DELETE FROM state_thing WHERE type = ? AND id = ?", t.type, t.id);
    });

  const merge: StateStore["merge"] = (from, to) =>
    tx(() => {
      const k = kindOf(to.type);
      const scope = k.scope(db, to.id);
      for (const r of db.all(
        "SELECT person, " + STATE_COLS + " FROM state_person WHERE type = ? AND id = ?",
        from.type,
        from.id,
      ) as Row[]) {
        const person = String(r["person"]);
        const a = toState(r);
        const b = rowOf(person, to);
        drop(person, from, joinScope(String(r["scope_type"]), String(r["scope_id"])), a);
        put(person, to, scope, b, b ? mergeRows(a, b) : a);
      }
      const gone = headRow(from);
      db.run("DELETE FROM state_thing WHERE type = ? AND id = ?", from.type, from.id);
      const have = headRow(to);
      const cap = Math.max(have?.head ?? 0, gone?.head ?? 0);
      upsertThing(to, cap, Math.max(have?.headAt ?? 0, gone?.headAt ?? 0) || now(), scope, k);
      recountThing(to, k, cap);
    });

  const split: StateStore["split"] = (from, to) =>
    tx(() => {
      const k = kindOf(to.type);
      const scope = k.scope(db, to.id);
      const cap = headRow(from)?.head ?? 0;
      upsertThing(to, cap, headRow(from)?.headAt ?? now(), scope, k);
      // each person carries what they had read, and their flags, back onto the revived thing: a position means the same on both
      for (const r of db.all(
        "SELECT person, " + STATE_COLS + " FROM state_person WHERE type = ? AND id = ?",
        from.type,
        from.id,
      ) as Row[]) {
        const person = String(r["person"]);
        if (!rowOf(person, to)) put(person, to, scope, null, toState(r));
      }
      recountThing(from, k, cap);
      recountThing(to, k, cap);
    });

  const seed: StateStore["seed"] = (t, at, reads) =>
    tx(() => {
      const k = kindOf(t.type);
      const scope = k.scope(db, t.id);
      upsertThing(t, Number.MAX_SAFE_INTEGER, at, scope, k);
      const entries = k.entries(db, t.id);
      let made = 0;
      for (const [person, readUpto] of reads) {
        if (rowOf(person, t)) continue;
        put(person, t, scope, null, recount({ ...blank(readUpto) }, entries, person));
        made += 1;
      }
      return made;
    });

  const gain: StateStore["gain"] = (person, scope) =>
    tx(() => {
      const s = splitScope(scope);
      const at = now();
      // rows that were hidden come back with their flags and nothing unread; nothing counted before and nothing counted now, so no badge moves
      const back = db.run(
        `UPDATE state_person SET hidden = 0, unread = 0, version = version + 1, updated_at = ?,
           read_upto = COALESCE((SELECT head FROM state_thing t WHERE t.type = state_person.type AND t.id = state_person.id), read_upto)
         WHERE person = ? AND scope_type = ? AND scope_id = ? AND hidden = 1`,
        at,
        person,
        s.type,
        s.id,
      ).changes;
      const made = db.run(
        `INSERT INTO state_person (person, type, id, read_upto, unread, scope_type, scope_id, version, updated_at)
         SELECT ?, t.type, t.id, t.head, 0, t.scope_type, t.scope_id, 1, ? FROM state_thing t
         WHERE t.scope_type = ? AND t.scope_id = ?
           AND NOT EXISTS (SELECT 1 FROM state_person p WHERE p.person = ? AND p.type = t.type AND p.id = t.id)`,
        person,
        at,
        s.type,
        s.id,
        person,
      ).changes;
      return back + made;
    });

  const lose: StateStore["lose"] = (person, scope) =>
    tx(() => {
      const s = splitScope(scope);
      const at = now();
      const gone = db.all(
        `SELECT COUNT(*) AS things, COALESCE(SUM(unread), 0) AS entries FROM state_person
         WHERE person = ? AND scope_type = ? AND scope_id = ? AND hidden = 0 AND unread > 0 AND done_at IS NULL AND muted_until IS NULL`,
        person,
        s.type,
        s.id,
      )[0] as Row;
      const n = db.run(
        `UPDATE state_person SET hidden = 1, version = version + 1, updated_at = ? WHERE person = ? AND scope_type = ? AND scope_id = ? AND hidden = 0`,
        at,
        person,
        s.type,
        s.id,
      ).changes;
      bump(person, scope, { things: -num(gone["things"]), entries: -num(gone["entries"]) });
      return n;
    });

  const followersOf: StateStore["followersOf"] = (t) =>
    (
      db.all(
        "SELECT person FROM state_person WHERE type = ? AND id = ? AND follow = 'following' AND hidden = 0",
        t.type,
        t.id,
      ) as Row[]
    ).map((r) => String(r["person"]));

  const stateOf: StateStore["stateOf"] = (person, things) => {
    // one query per kind of thing and 400 ids, not two per thing: a list of a page of rows asks once
    const rows = new Map<string, PersonState>();
    const heads = new Map<string, number>();
    const byType = new Map<string, string[]>();
    for (const t of things) byType.set(t.type, [...(byType.get(t.type) ?? []), t.id]);
    for (const [type, ids] of byType) {
      for (let i = 0; i < ids.length; i += 400) {
        const part = ids.slice(i, i + 400);
        const marks = part.map(() => "?").join(", ");
        for (const r of db.all(
          `SELECT id, ${STATE_COLS} FROM state_person WHERE person = ? AND type = ? AND id IN (${marks})`,
          person,
          type,
          ...part,
        ) as Row[])
          rows.set(`${type}\u0000${String(r["id"])}`, toState(r));
        for (const r of db.all(
          `SELECT id, head FROM state_thing WHERE type = ? AND id IN (${marks})`,
          type,
          ...part,
        ) as Row[])
          heads.set(`${type}\u0000${String(r["id"])}`, num(r["head"]));
      }
    }
    return things.map((t) => {
      const key = `${t.type}\u0000${t.id}`;
      return view(t, rows.get(key) ?? blank(heads.get(key) ?? 0), now());
    });
  };

  const canSee: StateStore["canSee"] = (person, t) => {
    const k = kindOf(t.type);
    return k.visible ? k.visible(db, t.id, person, env) : k.audience(db, t.id, env).includes(person);
  };
  const mustSee = (person: string, t: Thing): StateKind => {
    const k = kindOf(t.type);
    if (!canSee(person, t)) throw new StateRefusal("not_found", "That is not here, or you cannot see it.");
    return k;
  };

  const result = (t: Thing, before: PersonState | null, after: PersonState, head: number): ChangeResult => ({
    state: view(t, after, now()),
    changed: changedFlags(before, after, head),
  });

  const read: StateStore["read"] = (person, t, req, o) =>
    tx(() => {
      const k = o?.trusted ? kindOf(t.type) : mustSee(person, t);
      const entries = k.entries(db, t.id);
      const head = Math.max(headRow(t)?.head ?? 0, ...entries.map((e) => e.pos));
      const before = rowOf(person, t);
      const after = readRow(before, head, entries, person, req);
      if (after === null) return result(t, before, before ?? blank(head), head);
      if (before === null || JSON.stringify(before) !== JSON.stringify(after))
        put(person, t, k.scope(db, t.id), before, after);
      return result(t, before, after, head);
    });

  const set: StateStore["set"] = (person, t, change, o) =>
    tx(() => {
      const k = o?.trusted ? kindOf(t.type) : mustSee(person, t);
      const head = headRow(t)?.head ?? 0;
      const before = rowOf(person, t);
      const after = setRow(before, head, change, now());
      if (before === null || JSON.stringify(before) !== JSON.stringify(after))
        put(person, t, k.scope(db, t.id), before, after);
      return result(t, before, after, head);
    });

  const readScope: StateStore["readScope"] = (person, scope, before) =>
    tx(() => {
      const s = splitScope(scope);
      const at = now();
      const rows = db.all(
        `SELECT p.type AS type, p.id AS id, p.unread AS unread, p.done_at AS done_at, p.muted_until AS muted_until FROM state_person p
         JOIN state_thing t ON t.type = p.type AND t.id = p.id
         WHERE p.person = ? AND p.scope_type = ? AND p.scope_id = ? AND p.hidden = 0 AND p.unread > 0 AND (? IS NULL OR t.head_at <= ?)`,
        person,
        s.type,
        s.id,
        before ?? null,
        before ?? null,
      ) as Row[];
      let things = 0,
        entries = 0;
      for (const r of rows) {
        if (r["done_at"] === null && r["muted_until"] === null) {
          things += 1;
          entries += num(r["unread"]);
        }
      }
      db.run(
        `UPDATE state_person SET unread = 0, version = version + 1, updated_at = ?,
           read_upto = COALESCE((SELECT head FROM state_thing t WHERE t.type = state_person.type AND t.id = state_person.id), read_upto)
         WHERE person = ? AND scope_type = ? AND scope_id = ? AND hidden = 0 AND unread > 0
           AND (? IS NULL OR (SELECT head_at FROM state_thing t WHERE t.type = state_person.type AND t.id = state_person.id) <= ?)`,
        at,
        person,
        s.type,
        s.id,
        before ?? null,
        before ?? null,
      );
      bump(person, scope, { things: -things, entries: -entries });
      return { marked: rows.length, things: rows.map((r) => ({ type: String(r["type"]), id: String(r["id"]) })) };
    });

  const FLAGS: Record<ListFlag, { where: string; at: string; args: (now: number) => unknown[] }> = {
    starred: { where: "p.starred_at IS NOT NULL", at: "p.starred_at", args: () => [] },
    following: { where: "p.follow = 'following'", at: "COALESCE(t.head_at, p.updated_at)", args: () => [] },
    done: { where: "p.done_at IS NOT NULL", at: "p.done_at", args: () => [] },
    unread: {
      where: "p.unread > 0 AND p.done_at IS NULL AND (p.muted_until IS NULL OR p.muted_until <= ?)",
      at: "COALESCE(t.head_at, p.updated_at)",
      args: (now) => [now],
    },
    muted: { where: "p.muted_until IS NOT NULL AND p.muted_until > ?", at: "p.updated_at", args: (now) => [now] },
  };

  const list: StateStore["list"] = (person, q) => {
    const f = FLAGS[q.flag];
    const when = f.args(now());
    const where = ["p.person = ?", "p.hidden = 0", f.where];
    const args: unknown[] = [person, ...when];
    if (q.type) {
      where.push("p.type = ?");
      args.push(q.type);
    }
    if (q.scope) {
      const s = splitScope(q.scope);
      where.push("p.scope_type = ?", "p.scope_id = ?");
      args.push(s.type, s.id);
    }
    if (q.cursor) {
      const [at, type, id] = q.cursor.split("|");
      if (at === undefined || type === undefined || id === undefined || !Number.isFinite(Number(at)))
        throw new StateRefusal("bad_input", "That page marker is not one of ours.");
      where.push(`(${f.at} < ? OR (${f.at} = ? AND (p.type > ? OR (p.type = ? AND p.id > ?))))`);
      args.push(Number(at), Number(at), type, type, id);
    }
    const rows = db.all(
      `SELECT p.type AS type, p.id AS id, p.unread AS unread, ${f.at} AS at FROM state_person p
       LEFT JOIN state_thing t ON t.type = p.type AND t.id = p.id
       WHERE ${where.join(" AND ")} ORDER BY at DESC, p.type ASC, p.id ASC LIMIT ?`,
      ...args,
      q.limit + 1,
    ) as Row[];
    const page = rows.slice(0, q.limit);
    const last = page[page.length - 1];
    return {
      rows: page.map((r) => ({
        thing: { type: String(r["type"]), id: String(r["id"]) },
        at: num(r["at"]),
        unread: num(r["unread"]),
      })),
      ...(rows.length > q.limit && last
        ? { next: `${num(last["at"])}|${String(last["type"])}|${String(last["id"])}` }
        : {}),
    };
  };

  const counts: StateStore["counts"] = (person, scopes) => {
    const all = (
      db.all("SELECT scope_type, scope_id, things, entries FROM state_count WHERE person = ?", person) as Row[]
    ).map((r) => ({
      scope: joinScope(String(r["scope_type"]), String(r["scope_id"])),
      things: num(r["things"]),
      entries: num(r["entries"]),
    }));
    if (!scopes) return all.filter((c) => c.things !== 0 || c.entries !== 0);
    return scopes.map((scope) => all.find((c) => c.scope === scope) ?? { scope, things: 0, entries: 0 });
  };

  /** the numbers the counts should hold, read from the people's rows: one grouped scan */
  const truth = (o: VerifyOptions): Map<string, { person: string; scope: string; things: number; entries: number }> => {
    const where = ["hidden = 0", "unread > 0", "done_at IS NULL", "muted_until IS NULL"];
    const args: unknown[] = [];
    if (o.person) {
      where.push("person = ?");
      args.push(o.person);
    }
    if (o.scope) {
      const s = splitScope(o.scope);
      where.push("scope_type = ?", "scope_id = ?");
      args.push(s.type, s.id);
    }
    const out = new Map<string, { person: string; scope: string; things: number; entries: number }>();
    for (const r of db.all(
      `SELECT person, scope_type, scope_id, COUNT(*) AS things, SUM(unread) AS entries FROM state_person WHERE ${where.join(" AND ")} GROUP BY person, scope_type, scope_id`,
      ...args,
    ) as Row[]) {
      const scope = joinScope(String(r["scope_type"]), String(r["scope_id"]));
      out.set(`${String(r["person"])}\u0000${scope}`, {
        person: String(r["person"]),
        scope,
        things: num(r["things"]),
        entries: num(r["entries"]),
      });
    }
    return out;
  };

  const sweep: StateStore["sweep"] = () =>
    tx(() => {
      const cleared: { person: string; thing: Thing }[] = [];
      for (const r of db.all(
        `SELECT person, type, id, ${STATE_COLS} FROM state_person WHERE muted_until IS NOT NULL AND muted_until <= ?`,
        now(),
      ) as Row[]) {
        const before = toState(r);
        const thing = { type: String(r["type"]), id: String(r["id"]) };
        put(
          String(r["person"]),
          thing,
          joinScope(String(r["scope_type"]), String(r["scope_id"])),
          before,
          unmuted(before),
        );
        cleared.push({ person: String(r["person"]), thing });
      }
      return cleared;
    });

  const verify: StateStore["verify"] = (o = {}) =>
    tx(() => {
      if (o.repair) sweep();
      const problems: Problem[] = [];
      let repaired = 0;
      // 1 heads: what the module holds against what the seam kept
      for (const [type, k] of KINDS.get(db) ?? kinds) {
        const real = new Map(k.heads(db).map((h) => [h.thing, h]));
        const kept = new Map(
          (db.all("SELECT id, head FROM state_thing WHERE type = ?", type) as Row[]).map((r) => [
            String(r["id"]),
            num(r["head"]),
          ]),
        );
        const ids = new Set([...real.keys(), ...kept.keys()]);
        for (const id of ids) {
          const t = { type, id };
          const want = real.get(id)?.head ?? 0;
          const have = kept.get(id) ?? 0;
          if (want !== have) {
            problems.push({ kind: "head", thing: t, detail: `head is ${have}, the entries say ${want}` });
            if (o.repair) {
              if (want > have) {
                // a missing arrival: replay what the head never saw, in order, as arrive would have
                const scope = k.scope(db, id);
                for (const e of [...k.entries(db, id)].filter((x) => x.pos > have).sort((a, b) => a.pos - b.pos))
                  applyArrival(t, k, { pos: e.pos, by: e.by, at: real.get(id)?.at ?? now() }, have, scope);
              } else recountThing(t, k);
              repaired += 1;
            }
          }
          if (!o.deep) continue;
          // every row against the entries (a row whose person lost access is not kept up, and is reset when they gain it back)
          const entries = k.entries(db, id);
          for (const r of db.all(
            "SELECT person, " + STATE_COLS + " FROM state_person WHERE type = ? AND id = ?",
            type,
            id,
          ) as Row[]) {
            const person = String(r["person"]);
            const s = toState(r);
            if (s.hidden || (o.person && o.person !== person)) continue;
            const recounted = unreadOf(entries, s.readUpto, person);
            if (recounted === s.unread) continue;
            problems.push({
              kind: "unread",
              person,
              thing: t,
              detail: `unread is ${s.unread}, the entries say ${recounted}`,
            });
            if (o.repair) {
              put(person, t, joinScope(String(r["scope_type"]), String(r["scope_id"])), s, { ...s, unread: recounted });
              repaired += 1;
            }
          }
        }
      }
      // 2 counts: what is stored against what the people's rows add up to
      const want = truth(o);
      const stored = new Map<string, { person: string; scope: string; things: number; entries: number }>();
      const cw = ["1 = 1"];
      const ca: unknown[] = [];
      if (o.person) {
        cw.push("person = ?");
        ca.push(o.person);
      }
      if (o.scope) {
        const s = splitScope(o.scope);
        cw.push("scope_type = ?", "scope_id = ?");
        ca.push(s.type, s.id);
      }
      for (const r of db.all(
        `SELECT person, scope_type, scope_id, things, entries FROM state_count WHERE ${cw.join(" AND ")}`,
        ...ca,
      ) as Row[]) {
        const scope = joinScope(String(r["scope_type"]), String(r["scope_id"]));
        stored.set(`${String(r["person"])}\u0000${scope}`, {
          person: String(r["person"]),
          scope,
          things: num(r["things"]),
          entries: num(r["entries"]),
        });
      }
      for (const key of new Set([...want.keys(), ...stored.keys()])) {
        const w = want.get(key);
        const s = stored.get(key);
        const person = (w ?? s)!.person;
        const scope = (w ?? s)!.scope;
        const wt = w?.things ?? 0,
          we = w?.entries ?? 0;
        if ((s?.things ?? 0) === wt && (s?.entries ?? 0) === we) continue;
        problems.push({
          kind: "count",
          person,
          scope,
          detail: `${s?.things ?? 0} things and ${s?.entries ?? 0} entries are kept, the rows add up to ${wt} and ${we}`,
        });
        if (o.repair) {
          const sp = splitScope(scope);
          db.run(
            "DELETE FROM state_count WHERE person = ? AND scope_type = ? AND scope_id = ?",
            person,
            sp.type,
            sp.id,
          );
          if (wt !== 0 || we !== 0)
            db.run(
              "INSERT INTO state_count (person, scope_type, scope_id, things, entries) VALUES (?, ?, ?, ?, ?)",
              person,
              sp.type,
              sp.id,
              wt,
              we,
            );
          repaired += 1;
        }
      }
      return { problems, repaired };
    });

  return {
    arrive,
    retract,
    merge,
    split,
    seed,
    gain,
    lose,
    forget,
    sweep,
    verify,
    followersOf,
    stateOf,
    canSee,
    read,
    readScope,
    set,
    list,
    counts,
  };
}

/**
 * The seam for a module's handler: built from the module's own `ctx.db`. Throws when the handle was not made by the host's scopedDb (a hand-built test fake), because a seam on a connection the host
 * does not know would write nowhere the other modules can see.
 */
export function stateSeamOf(ctxDb: unknown, now: () => number, env: StateEnv = NO_ENV): StateStore {
  const raw = rawDbOf(ctxDb);
  if (!raw) throw new StateRefusal("bad_input", "This handle has no host connection to keep state on.");
  return createStateStore(raw as StateDb, now, env);
}

/**
 * A SQL fragment for a list handler that joins a person's state into its page query, so it never asks per row: `LEFT JOIN` on (person, type, id). `idExpr` is the module's own id column.
 * Only a query run on the raw connection can use it (ctx.db refuses `state_person`); the Inbox step runs its page query through the seam for that reason.
 */
export function withState(person: string, type: string, idExpr: string): { join: string; args: unknown[] } {
  return {
    join: `LEFT JOIN state_person sp ON sp.person = ? AND sp.type = ? AND sp.id = ${idExpr} AND sp.hidden = 0`,
    args: [person, type],
  };
}
