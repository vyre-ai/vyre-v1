// Property: authorize on one record and scopeFor over the table agree (ARCH 4.5 "authorize on one row and scopeFor over a table MUST agree").
// 200 seeded worlds (roles, groups, folders, record types, owners, labels, holds, grants with row filters, time windows and expiry). For each world a random principal (sometimes acting for someone)
// asks at a random level. The check is three-way: authorize per record, the predicate evaluated per record, and the compiled SQL run in SQLite against an acl_index table.
import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { authorize, scopeFor, toSql, evalPred, aclRows } from "../src/authorize/index.ts";
import { buildWorld, rng, NOW, PERSONS, AGENT, SVC, LEVELS } from "../src/authorize/fixture.ts";
import type { Row } from "../src/authorize/fixture.ts";

const CASES = 200;

function load(rows: Row[]): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE deal (id TEXT PRIMARY KEY, owner_id TEXT, label INTEGER, holds INTEGER, stage TEXT, amount REAL, region TEXT)");
  db.exec("CREATE TABLE acl_index (person TEXT, entity_type TEXT, entity_id TEXT, level_rank INTEGER)");
  const ins = db.prepare("INSERT INTO deal VALUES (?, ?, ?, ?, ?, ?, ?)");
  for (const r of rows) ins.run(r.id, r.owner_id, r.label, r.holds, r.stage, r.amount, r.region);
  return db;
}

test(`scopeFor and authorize agree on ${CASES} seeded worlds (predicate and SQL)`, () => {
  let allowed = 0, denied = 0, viaAcl = 0, viaFilter = 0, empties = 0;
  for (let seed = 1; seed <= CASES; seed++) {
    const { snap, rows } = buildWorld(seed);
    const r = rng(seed * 7919);
    const principal = r.pick([...PERSONS, AGENT, SVC]);
    const actingFor = r.chance(0.5) ? r.pick(PERSONS) : undefined;
    const level = r.pick(LEVELS);
    const destructive = r.chance(0.2);
    const s = scopeFor(snap, { principal, actingFor, entityType: "deal", level, perm: "records.read", destructive, now: NOW });
    if (s.predicate.t === "false") empties++;
    const db = load(rows);
    try {
      const ins = db.prepare("INSERT INTO acl_index VALUES (?, ?, ?, ?)");
      for (const a of aclRows(s.predicate, "deal")) ins.run(a.person, a.entity_type, a.entity_id, a.level_rank);
      const q = toSql(s.predicate);
      const sqlIds = new Set((db.prepare(`SELECT id FROM deal WHERE ${q.sql}`).all(...q.params) as { id: string }[]).map((x) => x.id));
      for (const row of rows) {
        const d = authorize(snap, { principal, actingFor, action: { perm: "records.read", level, destructive }, resource: { type: "deal", id: row.id }, row, now: NOW });
        const want = d.effect === "allow";
        const ctx = `seed ${seed} principal ${principal} actingFor ${actingFor} level ${level} destructive ${destructive} record ${row.id} (${d.reason})`;
        assert.equal(evalPred(s.predicate, row as unknown as Record<string, unknown>), want, `predicate vs authorize: ${ctx}`);
        assert.equal(sqlIds.has(row.id), want, `sql vs authorize: ${ctx}`);
        if (want) allowed++; else denied++;
      }
      if (s.predicate.t !== "false" && JSON.stringify(s.predicate, (_k, v) => (v instanceof Set ? [...v] : v)).includes('"t":"acl"')) viaAcl++;
      if (JSON.stringify(s.predicate).includes('"t":"expr"')) viaFilter++;
    } finally { db.close(); }
  }
  // the generator must exercise every path, or the property proves nothing
  assert.ok(allowed >= 150, `allowed ${allowed}`);
  assert.ok(denied >= 400, `denied ${denied}`);
  assert.ok(viaAcl >= 20, `acl_index paths ${viaAcl}`);
  assert.ok(viaFilter >= 8, `row-filter paths ${viaFilter}`);
  assert.ok(empties >= 5 && empties < CASES, `empty scopes ${empties}`);
  console.log(`scopeFor agreement: ${CASES} worlds, ${allowed + denied} record checks (${allowed} allow, ${denied} deny), ${viaAcl} acl_index scopes, ${viaFilter} row-filter scopes, ${empties} empty`);
});

test("scopeFor with no access gives a false predicate; compiled SQL is valid for it", () => {
  const { snap } = buildWorld(3);
  const s = scopeFor(snap, { principal: "nobody", entityType: "deal", level: "view", now: NOW });
  assert.equal(s.predicate.t, "false");
  assert.equal(toSql(s.predicate).sql, "0");
});

test("toSql refuses an unsafe column name", () => {
  assert.throws(() => toSql({ t: "expr", e: { op: "eq", field: "x; DROP TABLE deal", value: 1 }, me: "p1" }));
});
