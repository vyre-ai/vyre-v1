// The seam (host/src/seams/state.ts) on a real SQLite: every call leaves rows and counts that agree, `arrive` is idempotent on position, a crash between a module's insert and its `arrive`
// is mended by `verify`, one person's read never touches another's, and the owner's rules for Done hold. @reads ../migrations/0001_state.sql
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../../../host/src/daemon/sqlite.ts";
import { MUTE_FOREVER } from "../../../lib/state.ts";
import { StateRefusal } from "../../../host/src/seams/state.ts";
import { JONAS, MAYA, OMAR, STRANGER, fxOn, openFx, stateOf } from "../fixtures/db.ts";
import type { Fx } from "../fixtures/db.ts";

const clean = (fx: Fx): void => {
  const r = stateOf(fx).verify({ deep: true });
  assert.deepEqual(r.problems, [], "stored heads, unread and counts equal what the entries and rows say");
};
const unreadOf = (fx: Fx, person: string, thing: { type: string; id: string }): number => stateOf(fx).stateOf(person, [thing])[0]!.unread;
const badge = (fx: Fx, person: string, scope = "box:main") => stateOf(fx).counts(person, [scope])[0]!;

test("an arrival leaves the thing row, a row for each person and their counts, and they agree", () => {
  const fx = openFx();
  const c = fx.make("conversation", "cnv_one", [MAYA, JONAS]);
  assert.equal(fx.post(c, STRANGER), 1);
  assert.equal(fx.post(c, STRANGER), 2);
  assert.deepEqual(fx.db.all("SELECT head, scope_type, scope_id FROM state_thing WHERE id = 'cnv_one'"), [{ head: 2, scope_type: "box", scope_id: "main" }]);
  assert.equal(unreadOf(fx, MAYA, c), 2);
  assert.equal(unreadOf(fx, JONAS, c), 2);
  assert.deepEqual(badge(fx, MAYA), { scope: "box:main", things: 1, entries: 2 });
  assert.deepEqual(badge(fx, JONAS), { scope: "box:main", things: 1, entries: 2 });
  clean(fx);
});

test("arrive is idempotent on position: the same or an older position changes nothing", () => {
  const fx = openFx();
  const c = fx.make("conversation", "cnv_one", [MAYA]);
  const pos = fx.post(c, STRANGER);
  const before = JSON.stringify([fx.db.all("SELECT * FROM state_person"), fx.db.all("SELECT * FROM state_count"), fx.db.all("SELECT * FROM state_thing")]);
  const again = stateOf(fx).arrive(c, { pos, by: STRANGER, at: fx.clock.t });
  assert.deepEqual(again, { applied: false, people: 0 });
  fx.post(c, STRANGER);
  assert.equal(stateOf(fx).arrive(c, { pos: 1, by: STRANGER, at: fx.clock.t }).applied, false, "an older position is ignored too");
  assert.equal(unreadOf(fx, MAYA, c), 2);
  assert.notEqual(before, "");
  clean(fx);
});

test("a person who gets a row later starts at the old head: what came before counts as read", () => {
  const fx = openFx();
  const c = fx.make("conversation", "cnv_one", [MAYA]);
  fx.post(c, STRANGER);
  fx.post(c, STRANGER);
  fx.make("conversation", "cnv_one", [MAYA, JONAS]);
  fx.post(c, STRANGER);
  assert.equal(unreadOf(fx, MAYA, c), 3);
  assert.equal(unreadOf(fx, JONAS, c), 1);
  clean(fx);
});

test("per person: Maya reading does not mark it read for Jonas", () => {
  const fx = openFx();
  const c = fx.make("conversation", "cnv_one", [MAYA, JONAS]);
  fx.post(c, STRANGER);
  fx.post(c, STRANGER);
  const r = stateOf(fx).read(MAYA, c, { upto: 2 });
  assert.equal(r.state.unread, 0);
  assert.deepEqual(r.changed, ["read"]);
  assert.equal(unreadOf(fx, MAYA, c), 0);
  assert.equal(unreadOf(fx, JONAS, c), 2, "Jonas still has both unread");
  assert.deepEqual(badge(fx, MAYA), { scope: "box:main", things: 0, entries: 0 });
  assert.deepEqual(badge(fx, JONAS), { scope: "box:main", things: 1, entries: 2 });
  clean(fx);
});

test("marking done hides it for one person only, and a done thing leaves the badge", () => {
  const fx = openFx();
  const c = fx.make("conversation", "cnv_one", [MAYA, JONAS]);
  fx.post(c, STRANGER);
  const r = stateOf(fx).set(MAYA, c, { done: true });
  assert.deepEqual(r.changed, ["done"]);
  assert.notEqual(r.state.done, null);
  assert.deepEqual(badge(fx, MAYA), { scope: "box:main", things: 0, entries: 0 });
  assert.deepEqual(badge(fx, JONAS), { scope: "box:main", things: 1, entries: 1 });
  assert.equal(stateOf(fx).list(MAYA, { flag: "unread", limit: 10 }).rows.length, 0);
  assert.equal(stateOf(fx).list(JONAS, { flag: "unread", limit: 10 }).rows.length, 1);
  assert.equal(stateOf(fx).list(MAYA, { flag: "done", limit: 10 }).rows.length, 1);
  assert.equal(stateOf(fx).list(JONAS, { flag: "done", limit: 10 }).rows.length, 0);
  clean(fx);
});

test("Done reopens on any new inbound item and not on the person's own reply", () => {
  const fx = openFx();
  const c = fx.make("conversation", "cnv_one", [MAYA, JONAS]);
  fx.post(c, STRANGER);
  stateOf(fx).read(MAYA, c, { upto: 1 });
  stateOf(fx).set(MAYA, c, { done: true });
  fx.post(c, MAYA); // her own reply
  assert.notEqual(stateOf(fx).stateOf(MAYA, [c])[0]!.done, null, "her own reply does not reopen her Done");
  assert.equal(unreadOf(fx, MAYA, c), 0);
  fx.post(c, STRANGER); // a new inbound item, a missed call included
  const after = stateOf(fx).stateOf(MAYA, [c])[0]!;
  assert.equal(after.done, null, "a new inbound item reopens it");
  assert.equal(after.unread, 1);
  assert.deepEqual(badge(fx, MAYA), { scope: "box:main", things: 1, entries: 1 });
  clean(fx);
});

test("a kind that reopens only on a mention (Chats): a plain message leaves it done, a mention brings it back; a kind that never reopens stays done", () => {
  const fx = openFx();
  const chat = fx.make("chat", "chn_general", [MAYA, JONAS]);
  fx.post(chat, JONAS);
  stateOf(fx).set(MAYA, chat, { done: true });
  fx.post(chat, JONAS);
  assert.notEqual(stateOf(fx).stateOf(MAYA, [chat])[0]!.done, null);
  assert.equal(unreadOf(fx, MAYA, chat), 2, "still unread, but archived");
  assert.deepEqual(badge(fx, MAYA), { scope: "box:main", things: 0, entries: 0 }, "an archived chat is not counted");
  fx.post(chat, JONAS, { mentions: [MAYA] });
  assert.equal(stateOf(fx).stateOf(MAYA, [chat])[0]!.done, null);
  const note = fx.make("note", "nte_one", [MAYA, JONAS]);
  fx.post(note, JONAS);
  stateOf(fx).set(MAYA, note, { done: true });
  fx.post(note, JONAS, { mentions: [MAYA] });
  assert.notEqual(stateOf(fx).stateOf(MAYA, [note])[0]!.done, null);
  clean(fx);
});

test("read only moves forward, unread and fromPos move back, and the count follows", () => {
  const fx = openFx();
  const c = fx.make("conversation", "cnv_one", [MAYA]);
  for (let i = 0; i < 4; i++) fx.post(c, STRANGER);
  stateOf(fx).read(MAYA, c, { upto: 4 });
  assert.equal(stateOf(fx).read(MAYA, c, { upto: 1 }).state.unread, 0, "upto never moves back");
  assert.equal(stateOf(fx).read(MAYA, c, { fromPos: 3 }).state.unread, 2);
  assert.deepEqual(badge(fx, MAYA), { scope: "box:main", things: 1, entries: 2 });
  assert.equal(stateOf(fx).read(MAYA, c, { unread: true }).state.unread, 1);
  stateOf(fx).read(MAYA, c, { upto: 99 });
  assert.equal(unreadOf(fx, MAYA, c), 0, "upto is held at the head");
  clean(fx);
});

test("a thing the person cannot see is not found", () => {
  const fx = openFx();
  const c = fx.make("conversation", "cnv_one", [MAYA]);
  fx.post(c, STRANGER);
  assert.throws(() => stateOf(fx).read(OMAR, c, { upto: 1 }), (e) => e instanceof StateRefusal && e.code === "not_found");
  assert.throws(() => stateOf(fx).set(OMAR, c, { star: true }), (e) => e instanceof StateRefusal && e.code === "not_found");
  assert.throws(() => stateOf(fx).set(OMAR, { type: "nothing", id: "x" }, { star: true }), (e) => e instanceof StateRefusal && e.code === "bad_input");
});

test("star, follow, alert and mute are separate flags; a mute leaves the badge and an ended mute comes back", () => {
  const fx = openFx();
  const c = fx.make("conversation", "cnv_one", [MAYA, JONAS]);
  fx.post(c, STRANGER);
  const r = stateOf(fx).set(MAYA, c, { star: true, follow: "following", alert: true, mute: { until: fx.clock.t + 60_000 } });
  assert.deepEqual(r.changed, ["star", "follow", "mute"]);
  assert.deepEqual(stateOf(fx).followersOf(c), [MAYA]);
  assert.deepEqual(badge(fx, MAYA), { scope: "box:main", things: 0, entries: 0 }, "muted");
  assert.deepEqual(stateOf(fx).list(MAYA, { flag: "muted", limit: 5 }).rows.map((x) => x.thing.id), ["cnv_one"]);
  fx.clock.t += 120_000;
  assert.equal(stateOf(fx).list(MAYA, { flag: "muted", limit: 5 }).rows.length, 0, "the mute ended");
  // the stored badge only learns of the end at the next verify, which repairs it
  const found = stateOf(fx).verify({ repair: true });
  assert.equal(found.problems.length, 1);
  assert.deepEqual(badge(fx, MAYA), { scope: "box:main", things: 1, entries: 1 });
  stateOf(fx).set(MAYA, c, { mute: { until: MUTE_FOREVER } });
  assert.deepEqual(badge(fx, MAYA), { scope: "box:main", things: 0, entries: 0 });
  stateOf(fx).set(MAYA, c, { mute: null, follow: "left", star: false });
  assert.deepEqual(stateOf(fx).followersOf(c), []);
  assert.deepEqual(stateOf(fx).list(MAYA, { flag: "starred", limit: 5 }).rows, []);
  clean(fx);
});

test("read_scope marks everything in one badge, or only what arrived before a time", () => {
  const fx = openFx();
  const a = fx.make("conversation", "cnv_a", [MAYA], "box:main");
  const b = fx.make("conversation", "cnv_b", [MAYA], "box:main");
  const other = fx.make("conversation", "cnv_c", [MAYA], "box:other");
  fx.post(a, STRANGER);
  const cut = fx.clock.t;
  fx.post(b, STRANGER);
  fx.post(other, STRANGER);
  const some = stateOf(fx).readScope(MAYA, "box:main", cut);
  assert.equal(some.marked, 1);
  assert.deepEqual(badge(fx, MAYA), { scope: "box:main", things: 1, entries: 1 });
  const rest = stateOf(fx).readScope(MAYA, "box:main");
  assert.equal(rest.marked, 1);
  assert.deepEqual(badge(fx, MAYA), { scope: "box:main", things: 0, entries: 0 });
  assert.deepEqual(badge(fx, MAYA, "box:other"), { scope: "box:other", things: 1, entries: 1 }, "another scope is untouched");
  clean(fx);
});

test("a list pages by keyset and keeps its order", () => {
  const fx = openFx();
  const ids = ["cnv_1", "cnv_2", "cnv_3", "cnv_4", "cnv_5"];
  for (const id of ids) fx.post(fx.make("conversation", id, [MAYA]), STRANGER);
  const first = stateOf(fx).list(MAYA, { flag: "unread", limit: 2 });
  assert.deepEqual(first.rows.map((r) => r.thing.id), ["cnv_5", "cnv_4"]);
  const second = stateOf(fx).list(MAYA, { flag: "unread", limit: 2, cursor: first.next! });
  assert.deepEqual(second.rows.map((r) => r.thing.id), ["cnv_3", "cnv_2"]);
  const last = stateOf(fx).list(MAYA, { flag: "unread", limit: 2, cursor: second.next! });
  assert.deepEqual(last.rows.map((r) => r.thing.id), ["cnv_1"]);
  assert.equal(last.next, undefined);
  assert.throws(() => stateOf(fx).list(MAYA, { flag: "unread", limit: 2, cursor: "nonsense" }), StateRefusal);
});

test("retract recounts from the entries after one is removed", () => {
  const fx = openFx();
  const c = fx.make("conversation", "cnv_one", [MAYA]);
  fx.post(c, STRANGER);
  fx.post(c, STRANGER);
  fx.removeNewest(c);
  stateOf(fx).retract(c);
  assert.equal(unreadOf(fx, MAYA, c), 1);
  assert.deepEqual(badge(fx, MAYA), { scope: "box:main", things: 1, entries: 1 });
  clean(fx);
});

test("merge keeps each person's flags and recounts the survivor", () => {
  const fx = openFx();
  const a = fx.make("conversation", "cnv_a", [MAYA, JONAS]);
  const b = fx.make("conversation", "cnv_b", [MAYA, JONAS]);
  fx.post(a, STRANGER);
  fx.post(b, STRANGER);
  stateOf(fx).set(MAYA, a, { star: true });
  stateOf(fx).read(JONAS, b, { upto: 1 });
  // the module moves a's entry into b, then tells the seam
  fx.db.run("UPDATE fx_entry SET thing = 'cnv_b', pos = 2 WHERE thing = 'cnv_a'");
  fx.db.run("DELETE FROM fx_thing WHERE id = 'cnv_a'");
  stateOf(fx).merge(a, b);
  assert.equal(stateOf(fx).stateOf(MAYA, [b])[0]!.starred !== null, true, "Maya's star came along");
  assert.equal(unreadOf(fx, MAYA, b), 2);
  assert.equal(unreadOf(fx, JONAS, b), 1, "Jonas had read the one in b; the one from a is new to him");
  assert.equal(fx.db.all("SELECT 1 FROM state_person WHERE id = 'cnv_a'").length, 0);
  assert.equal(fx.db.all("SELECT 1 FROM state_thing WHERE id = 'cnv_a'").length, 0);
  clean(fx);
});

test("losing access takes a scope out of lists and badges at once; gaining it back starts with nothing unread and keeps done and star", () => {
  const fx = openFx();
  const c = fx.make("conversation", "cnv_one", [MAYA, JONAS]);
  fx.post(c, STRANGER);
  stateOf(fx).set(MAYA, c, { star: true });
  assert.equal(stateOf(fx).lose(MAYA, "box:main"), 1);
  assert.deepEqual(badge(fx, MAYA), { scope: "box:main", things: 0, entries: 0 });
  assert.equal(stateOf(fx).list(MAYA, { flag: "starred", limit: 5 }).rows.length, 0, "hidden from lists");
  fx.make("conversation", "cnv_one", [JONAS]);
  fx.post(c, STRANGER);
  fx.make("conversation", "cnv_one", [MAYA, JONAS]);
  stateOf(fx).gain(MAYA, "box:main");
  assert.equal(unreadOf(fx, MAYA, c), 0, "a person who gains access starts with nothing unread");
  assert.equal(stateOf(fx).stateOf(MAYA, [c])[0]!.starred !== null, true, "the star came back");
  assert.equal(stateOf(fx).list(MAYA, { flag: "starred", limit: 5 }).rows.length, 1);
  // a person with no row at all gets one with nothing unread
  const fresh = fx.make("conversation", "cnv_two", [JONAS], "box:main");
  fx.post(fresh, STRANGER);
  assert.equal(stateOf(fx).gain(OMAR, "box:main"), 2);
  assert.equal(unreadOf(fx, OMAR, fresh), 0);
  clean(fx);
});

test("forget removes every row and count of a deleted thing", () => {
  const fx = openFx();
  const c = fx.make("conversation", "cnv_one", [MAYA, JONAS]);
  fx.post(c, STRANGER);
  stateOf(fx).forget(c);
  assert.deepEqual(fx.db.all("SELECT * FROM state_person"), []);
  assert.deepEqual(fx.db.all("SELECT * FROM state_thing"), []);
  assert.deepEqual(badge(fx, MAYA), { scope: "box:main", things: 0, entries: 0 });
});

test("one seam call writes in one transaction: a failure part-way leaves no row and no count", () => {
  const fx = openFx();
  const c = fx.make("conversation", "cnv_one", [MAYA, JONAS]);
  // the second person's write fails; the first person's row, the thing row and the counts must not survive it
  fx.db.exec(`CREATE TRIGGER fx_refuse BEFORE INSERT ON state_person WHEN NEW.person = '${JONAS}' BEGIN SELECT RAISE(ABORT, 'refused'); END;`);
  fx.insert(c, STRANGER);
  assert.throws(() => stateOf(fx).arrive(c, { pos: 1, by: STRANGER, at: fx.clock.t }), /refused/);
  assert.deepEqual(fx.db.all("SELECT * FROM state_person"), []);
  assert.deepEqual(fx.db.all("SELECT * FROM state_thing"), []);
  assert.deepEqual(fx.db.all("SELECT * FROM state_count"), []);
  fx.db.exec("DROP TRIGGER fx_refuse");
  assert.equal(stateOf(fx).arrive(c, { pos: 1, by: STRANGER, at: fx.clock.t }).applied, true, "the position was not used up by the failed call");
  clean(fx);
});

test("the process dies between a module's insert and its arrive: verify repairs the missing arrival at the next start", () => {
  const dir = mkdtempSync(join(tmpdir(), "state-crash-"));
  const file = join(dir, "modules.db");
  try {
    const fx = openFx(file);
    const c = fx.make("conversation", "cnv_one", [MAYA, JONAS]);
    fx.post(c, STRANGER); // arrival 1 is whole
    stateOf(fx).set(MAYA, c, { done: true });
    fx.insert(c, STRANGER); // the module's own insert commits ...
    fx.insert(c, MAYA); // ... and so does a reply of Maya's ...
    fx.db.close(); // ... and the process dies before either arrive

    const next = fxOn(openDb(file)); // the next start: a new connection to the same file
    const found = stateOf(next).verify({});
    assert.deepEqual(found.problems.map((p) => p.kind), ["head"], "verify sees the head is behind the entries");
    assert.equal(unreadOf(next, JONAS, c), 1, "nothing is repaired until asked");
    const fixed = stateOf(next).verify({ repair: true });
    assert.equal(fixed.repaired, 1);
    assert.equal(fixed.problems[0]!.kind, "head");
    // exactly what the two arrivals would have done
    assert.equal(unreadOf(next, JONAS, c), 3, "Jonas: entry 1, 2 and Maya's 3");
    assert.equal(stateOf(next).stateOf(MAYA, [c])[0]!.done, null, "the new inbound item reopened Maya's Done");
    assert.equal(unreadOf(next, MAYA, c), 0, "her own reply is read");
    assert.equal(stateOf(next).stateOf(MAYA, [c])[0]!.readUpto, 3);
    assert.deepEqual(stateOf(next).verify({ deep: true }).problems, []);
    assert.deepEqual(stateOf(next).verify({ repair: true }), { problems: [], repaired: 0 }, "and a second run finds nothing");
    next.db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("verify finds and repairs a wrong badge, and a thing the module no longer has", () => {
  const fx = openFx();
  const c = fx.make("conversation", "cnv_one", [MAYA]);
  fx.post(c, STRANGER);
  fx.db.run("UPDATE state_count SET things = 4, entries = 9 WHERE person = ?", MAYA);
  const r = stateOf(fx).verify({ repair: true });
  assert.deepEqual(r.problems.map((p) => p.kind), ["count"]);
  assert.deepEqual(badge(fx, MAYA), { scope: "box:main", things: 1, entries: 1 });
  fx.db.run("DELETE FROM fx_entry WHERE thing = 'cnv_one'");
  assert.deepEqual(stateOf(fx).verify({ repair: true }).problems.map((p) => p.kind), ["head"]);
  assert.equal(unreadOf(fx, MAYA, c), 0);
  assert.deepEqual(stateOf(fx).verify({ deep: true }).problems, []);
});

// ---- a property test: random operations, and after every one the stored numbers equal what verify recounts

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

for (const seed of [1, 2, 3, 4, 5, 6]) {
  test(`property: random arrivals, reads, flags, retractions, merges, gains and losses keep every stored number equal to its recount (seed ${seed})`, () => {
    const r = rng(seed);
    const pick = <T>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)]!;
    const fx = openFx();
    const people = [MAYA, JONAS, OMAR];
    const scopes = ["box:main", "box:other", "chats"];
    const kinds = ["conversation", "chat", "note"] as const;
    const alive = new Map<string, { type: string; id: string; members: Set<string>; scope: string }>();
    let n = 0;
    const open = () => {
      const type = pick(kinds);
      const id = `th_${++n}`;
      const members = new Set(people.filter(() => r() < 0.7));
      if (members.size === 0) members.add(MAYA);
      const scope = pick(scopes);
      fx.make(type, id, [...members], scope);
      alive.set(id, { type, id, members, scope });
    };
    for (let i = 0; i < 4; i++) open();
    const st = stateOf(fx);
    for (let step = 0; step < 220; step++) {
      const t = pick([...alive.values()]);
      const ref = { type: t.type, id: t.id };
      const p = pick([...t.members]);
      const roll = r();
      if (roll < 0.34) fx.post(ref, r() < 0.2 ? pick([...t.members]) : STRANGER, { mentions: r() < 0.3 ? [pick(people)] : [] });
      else if (roll < 0.46) st.read(p, ref, { upto: Math.floor(r() * 12) });
      else if (roll < 0.52) st.read(p, ref, { fromPos: 1 + Math.floor(r() * 6) });
      else if (roll < 0.56) st.read(p, ref, { unread: true });
      else if (roll < 0.66) st.set(p, ref, { done: r() < 0.6 });
      else if (roll < 0.72) st.set(p, ref, { mute: r() < 0.5 ? { until: fx.clock.t + Math.floor(r() * 5000) } : null });
      else if (roll < 0.76) st.set(p, ref, { star: r() < 0.5, follow: pick(["following", "left", null] as const) });
      else if (roll < 0.8) {
        fx.removeNewest(ref);
        st.retract(ref);
      } else if (roll < 0.84 && alive.size > 1) {
        // merge: the module moves every entry of the other thing in after this one's newest, and members join
        const from = pick([...alive.values()].filter((x) => x.id !== t.id && x.type === t.type));
        if (from) {
          const top = (fx.db.all("SELECT COALESCE(MAX(pos), 0) AS p FROM fx_entry WHERE thing = ?", t.id)[0] as { p: number }).p;
          fx.db.run("UPDATE fx_entry SET thing = ?, pos = pos + ? WHERE thing = ?", t.id, top, from.id);
          for (const m of from.members) t.members.add(m);
          fx.make(t.type, t.id, [...t.members], t.scope);
          fx.db.run("DELETE FROM fx_thing WHERE id = ?", from.id);
          alive.delete(from.id);
          st.merge({ type: from.type, id: from.id }, ref);
        }
      } else if (roll < 0.88) {
        const who = pick(people);
        if (t.members.has(who) && t.members.size > 1) {
          t.members.delete(who);
          fx.make(t.type, t.id, [...t.members], t.scope);
          st.lose(who, t.scope);
          // losing a scope hides every thing of the scope for that person, so the model drops them from the others too
          for (const o of alive.values()) if (o.scope === t.scope && o.members.delete(who)) fx.make(o.type, o.id, [...o.members], o.scope);
        } else if (!t.members.has(who)) {
          // gaining a scope is access to everything in it
          for (const o of alive.values()) if (o.scope === t.scope && !o.members.has(who)) (o.members.add(who), fx.make(o.type, o.id, [...o.members], o.scope));
          st.gain(who, t.scope);
        }
      } else if (roll < 0.9 && alive.size > 2) {
        fx.db.run("DELETE FROM fx_entry WHERE thing = ?", t.id);
        fx.db.run("DELETE FROM fx_thing WHERE id = ?", t.id);
        alive.delete(t.id);
        st.forget(ref);
      } else if (roll < 0.94) open();
      else fx.clock.t += Math.floor(r() * 4000);
      // a mute that ended is the one thing a stored count learns only at a verify; take it as the doctor would
      const found = st.verify({ deep: true, repair: false }).problems.filter((x) => !(x.kind === "count" && x.person !== undefined && mutedSomewhere(fx, x.person)));
      assert.deepEqual(found, [], `seed ${seed}, step ${step}: ${JSON.stringify(found)}`);
    }
    assert.deepEqual(st.verify({ repair: true, deep: true }).problems.filter((x) => x.kind !== "count"), []);
    assert.deepEqual(st.verify({ deep: true }).problems, []);
  });
}

/** Does the person have a mute that has ended by now? */
function mutedSomewhere(fx: Fx, person: string): boolean {
  return fx.db.all("SELECT 1 FROM state_person WHERE person = ? AND muted_until IS NOT NULL AND muted_until <= ?", person, fx.clock.t).length > 0;
}
