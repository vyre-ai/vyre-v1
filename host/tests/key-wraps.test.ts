// The server's sealed copies of members' keys for provider sign-ins (owner ruling 3 Nov, R62 amended; host/src/seams/key-wraps.ts): bound to the Space and the person, under a secret the database
// never holds; dropped, forgotten, and all gone when the policy is off.
import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { createKeyWraps } from "../src/seams/key-wraps.ts";

function rig(o: { on?: () => boolean; space?: string; secret?: Uint8Array } = {}) {
  const raw = new DatabaseSync(":memory:");
  const db = { run: (sql: string, ...a: unknown[]) => raw.prepare(sql).run(...(a as never[])), all: (sql: string, ...a: unknown[]) => raw.prepare(sql).all(...(a as never[])) as unknown[] };
  const secret = o.secret ?? new Uint8Array(32).fill(9);
  return { raw, db, w: createKeyWraps({ db: () => db, space: () => o.space ?? "spc_a", secret: () => secret, enabled: o.on ?? (() => true) }) };
}
const KEY = new Uint8Array(32).fill(5);

test("a kept key opens for its own person only, and the database holds no key and no secret", () => {
  const { raw, db, w } = rig();
  assert.equal(w.make("usr_a", KEY), true);
  assert.deepEqual(w.open("usr_a"), KEY);
  assert.equal(w.open("usr_b"), null);
  assert.equal(w.has("usr_a"), true);
  // moving the row to another person does not open: the box is bound to the person
  const box = (db.all("SELECT box FROM host_person_wrap WHERE person_id = 'usr_a'")[0] as { box: string }).box;
  db.run("INSERT INTO host_person_wrap (person_id, box, made_at) VALUES ('usr_b', ?, 0)", box);
  assert.equal(w.open("usr_b"), null);
  const dump = JSON.stringify(raw.prepare("SELECT * FROM host_person_wrap").all());
  for (const needle of [Buffer.from(KEY).toString("base64"), Buffer.from(KEY).toString("base64url"), Buffer.from(new Uint8Array(32).fill(9)).toString("hex")]) assert.ok(!dump.includes(needle));
});

test("another server's secret or another Space opens nothing", () => {
  const a = rig();
  a.w.make("usr_a", KEY);
  const box = (a.db.all("SELECT box FROM host_person_wrap")[0] as { box: string }).box;
  for (const o of [{ secret: new Uint8Array(32).fill(1) }, { space: "spc_b" }]) {
    const b = rig(o);
    b.db.run("CREATE TABLE IF NOT EXISTS host_person_wrap (person_id TEXT PRIMARY KEY, box TEXT NOT NULL, made_at INTEGER NOT NULL)");
    b.db.run("INSERT INTO host_person_wrap (person_id, box, made_at) VALUES ('usr_a', ?, 0)", box);
    assert.equal(b.w.open("usr_a"), null, JSON.stringify(Object.keys(o)));
  }
});

test("drop takes one away; forget also stops new ones until remember; the policy off drops every one and keeps none", () => {
  let on = true;
  const { w } = rig({ on: () => on });
  w.make("usr_a", KEY); w.make("usr_b", KEY);
  w.drop("usr_a");
  assert.equal(w.open("usr_a"), null);
  assert.equal(w.make("usr_a", KEY), true, "a password unlock keeps one again");
  w.forget("usr_a");
  assert.equal(w.open("usr_a"), null);
  assert.equal(w.make("usr_a", KEY), false, "forgotten: none is kept");
  assert.equal(w.forgotten("usr_a"), true);
  w.remember("usr_a");
  assert.equal(w.make("usr_a", KEY), true);
  on = false;
  assert.equal(w.open("usr_b"), null);
  assert.equal(w.has("usr_a"), false);
  assert.equal(w.make("usr_b", KEY), false);
  on = true;
  assert.equal(w.open("usr_a"), null, "turning it off deleted them; on again keeps new ones only");
  assert.equal(w.enforce(), 0);
});

test("with no Space database nothing is kept and nothing opens", () => {
  const w = createKeyWraps({ db: () => null, space: () => "-", secret: () => new Uint8Array(32), enabled: () => true });
  assert.equal(w.make("usr_a", KEY), false);
  assert.equal(w.open("usr_a"), null);
  assert.equal(w.has("usr_a"), false);
});
