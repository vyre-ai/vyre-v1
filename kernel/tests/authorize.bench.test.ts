// Budget authorize: at least 500k decisions per second per core on a warm cache (packet P-PR_14; ARCH 4.5 "Properties").
// A realistic Space: 3 roles, 2 groups, 30 grants (type-wide with row filters, folder flow-down, record-level), records three levels deep, two policies, a mix of allow and deny.
import test from "node:test";
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { authorize, AccessSnapshot } from "../src/authorize/index.ts";
import type { Req } from "../src/authorize/index.ts";

function world() {
  const s = new AccessSnapshot();
  s.putRole({ id: "member", clearance: 2, perms: ["records.read", "records.write", "files.read"], name: "Member" });
  s.putRole({ id: "guest", clearance: 1, perms: ["records.read"], name: "Guest" });
  s.putRole({ id: "owner", clearance: 3, perms: ["records.read", "records.write", "access.manage"], name: "Owner" });
  for (let i = 0; i < 10; i++) {
    s.putPrincipal({ id: `u${i}`, kind: "person", status: "active", name: `User ${i}` });
    s.addPrincipalRole({ holder: `u${i}`, role: i === 0 ? "owner" : i % 3 === 0 ? "guest" : "member" });
    s.addMember({ group: i % 2 ? "g1" : "g2", member: `u${i}` });
  }
  s.putPrincipal({ id: "ag1", kind: "agent", owner: "u1", status: "active", name: "Agent" });
  s.addPrincipalRole({ holder: "ag1", role: "member" });
  s.putResource({ id: "root", type: "folder", parent_id: null, label: 0, owner_id: null, holds: 0 });
  for (let f = 0; f < 5; f++) {
    s.putResource({ id: `f${f}`, type: "folder", parent_id: "root", label: 0, owner_id: `u${f}`, holds: 0 });
    s.putResource({ id: `rt${f}`, type: "record_type", parent_id: `f${f}`, label: f % 2, owner_id: null, holds: 0 });
    for (let k = 0; k < 20; k++) s.putResource({ id: `r${f}_${k}`, type: "deal", parent_id: `rt${f}`, label: k % 3 === 0 ? 1 : 0, owner_id: `u${(f + k) % 10}`, holds: 0 });
  }
  let g = 0;
  for (let f = 0; f < 5; f++) {
    s.putGrant({ id: `g${g++}`, subject_kind: "role", subject_id: "member", resource_type: "folder", resource_id: `f${f}`, level: "edit" });
    s.putGrant({ id: `g${g++}`, subject_kind: "group", subject_id: f % 2 ? "g1" : "g2", resource_type: "record_type", resource_id: `rt${f}`, level: "manage" });
    s.putGrant({ id: `g${g++}`, subject_kind: "actor", subject_id: `u${f + 3}`, resource_type: "deal", resource_id: `r${f}_${f}`, level: "manage" });
  }
  s.putGrant({ id: `g${g++}`, subject_kind: "role", subject_id: "guest", resource_type: "deal", resource_id: null, level: "view", conditions: { rowFilter: { op: "or", args: [{ op: "eq", field: "stage", value: "won" }, { op: "owner_me" }] } } });
  s.putGrant({ id: `g${g++}`, subject_kind: "role", subject_id: "member", resource_type: "deal", resource_id: null, level: "use", conditions: { rowFilter: { op: "gt", field: "amount", value: 10 } } });
  s.setPolicies([
    { key: "p1", kind: "provider_label", allow: { local: 3, cloud: 1 } },
    { key: "p2", kind: "gate", act: "email.send", approver: "role:owner", caps: ["email.send"] },
  ]);
  return s;
}

test("authorize sustains at least 500k decisions per second per core", () => {
  const snap = world();
  const reqs: Req[] = [];
  const levels = ["view", "use", "edit", "manage"] as const;
  for (let u = 0; u < 10; u++) for (let f = 0; f < 5; f++) for (let k = 0; k < 20; k += 3) {
    reqs.push({ principal: `u${u}`, action: { perm: "records.read", level: levels[(u + k) % 4]! }, resource: { type: "deal", id: `r${f}_${k}` }, row: { stage: k % 2 ? "won" : "open", amount: k * 7 }, provider: u % 2 ? "cloud" : "local", now: 1000 });
  }
  reqs.push({ principal: "ag1", actingFor: "u1", action: { perm: "records.read", level: "view" }, resource: { type: "deal", id: "r1_1" }, row: { stage: "won", amount: 50 }, now: 1000 });
  let allow = 0, deny = 0, hold = 0;
  for (const r of reqs) { const e = authorize(snap, r).effect; if (e === "allow") allow++; else if (e === "deny") deny++; else hold++; }
  assert.ok(allow > 20 && deny > 20, `the mix must contain both (allow ${allow}, deny ${deny}, hold ${hold})`);
  let sink = 0;
  const run = (n: number): number => {
    const t0 = performance.now();
    for (let i = 0; i < n; i++) { if (authorize(snap, reqs[i % reqs.length]!).effect === "allow") sink++; }
    return performance.now() - t0;
  };
  run(300_000);   // warm the JIT and the caches
  const N = 1_500_000;
  const best = Math.min(run(N), run(N), run(N));
  const perSec = N / (best / 1000);
  console.log(`authorize microbench: ${N} decisions in ${best.toFixed(0)} ms best of 3 = ${(perSec / 1000).toFixed(0)}k decisions/s per core (${(best * 1000 / N).toFixed(2)} us each), ${reqs.length} request shapes, ${allow} allow / ${deny} deny / ${hold} hold (sink ${sink})`);
  assert.ok(perSec >= 500_000, `${(perSec / 1000).toFixed(0)}k/s is under the 500k/s budget`);
});
