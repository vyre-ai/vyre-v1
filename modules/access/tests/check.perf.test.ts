// Budget authorize: at least 500k decisions per second per core on a warm access snapshot (ARCH 4.5).
// The timed loop reads the module projection once, then calls authorize. Step text stays off, as on the hot path.
import test from "node:test";
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { authorize } from "../../../kernel/src/authorize/index.ts";
import type { Level, Req } from "../../../kernel/src/authorize/index.ts";
import { AccessStore, pkey } from "../projections.ts";

function world(): { store: AccessStore; reqs: Req[] } {
  const store = new AccessStore();
  store.roles.set("member", {
    id: "member", name: "Member", builtIn: false, clearance: "confidential", assignableToAgents: true,
    permissions: ["records.read", "records.write", "files.read"],
  });
  store.roles.set("guest", {
    id: "guest", name: "Guest", builtIn: false, clearance: "internal", assignableToAgents: true,
    permissions: ["records.read"],
  });
  store.roles.set("owner", {
    id: "owner", name: "Owner", builtIn: false, clearance: "restricted", assignableToAgents: false,
    permissions: ["records.read", "records.write", "access.manage"],
  });
  const g1: { kind: "person"; id: string }[] = [];
  const g2: { kind: "person"; id: string }[] = [];
  for (let i = 0; i < 10; i++) {
    const id = `u${i}`;
    store.principals.set(id, { id, kind: "person", name: `User ${i}`, status: "active", createdAt: 1 });
    store.setRoles(id, [i === 0 ? "owner" : i % 3 === 0 ? "guest" : "member"]);
    (i % 2 ? g1 : g2).push({ kind: "person", id });
  }
  store.groups.set("g1", { id: "g1", name: "G1", builtIn: false, members: g1, managers: [] });
  store.groups.set("g2", { id: "g2", name: "G2", builtIn: false, members: g2, managers: [] });
  store.principals.set("ag1", { id: "ag1", kind: "agent", name: "Agent", owner: "u1", status: "active", createdAt: 1 });
  store.setRoles("ag1", ["member"]);
  store.resources.set("root", { id: "root", type: "folder", parentId: null, label: "public", ownerId: null, holds: 0 });
  for (let f = 0; f < 5; f++) {
    store.resources.set(`f${f}`, { id: `f${f}`, type: "folder", parentId: "root", label: "public", ownerId: `u${f}`, holds: 0 });
    store.resources.set(`rt${f}`, {
      id: `rt${f}`, type: "record_type", parentId: `f${f}`, label: f % 2 ? "internal" : "public", ownerId: null, holds: 0,
    });
    for (let k = 0; k < 20; k++) {
      store.resources.set(`r${f}_${k}`, {
        id: `r${f}_${k}`, type: "deal", parentId: `rt${f}`, label: k % 3 === 0 ? "internal" : "public",
        ownerId: `u${(f + k) % 10}`, holds: 0,
      });
    }
  }
  let g = 0;
  for (let f = 0; f < 5; f++) {
    const folderId = `gnt${g++}`;
    store.grants.set(folderId, {
      id: folderId, subject: { kind: "role", id: "member" }, resource: { type: "folder", id: `f${f}` },
      level: "edit", conditions: {}, by: "u0", createdAt: 1000,
    });
    const typeId = `gnt${g++}`;
    store.grants.set(typeId, {
      id: typeId, subject: { kind: "group", id: f % 2 ? "g1" : "g2" }, resource: { type: "record_type", id: `rt${f}` },
      level: "manage", conditions: {}, by: "u0", createdAt: 1000,
    });
    const rowId = `gnt${g++}`;
    store.grants.set(rowId, {
      id: rowId, subject: { kind: "person", id: `u${f + 3}` }, resource: { type: "deal", id: `r${f}_${f}` },
      level: "manage", conditions: {}, by: "u0", createdAt: 1000,
    });
  }
  store.grants.set("gnt_guest", {
    id: "gnt_guest", subject: { kind: "role", id: "guest" }, resource: { type: "deal", id: "*" },
    level: "view", by: "u0", createdAt: 1000,
    conditions: { rowFilter: { op: "or", args: [{ op: "eq", field: "stage", value: "won" }, { op: "owner_me" }] } },
  });
  store.grants.set("gnt_member", {
    id: "gnt_member", subject: { kind: "role", id: "member" }, resource: { type: "deal", id: "*" },
    level: "use", by: "u0", createdAt: 1000,
    conditions: { rowFilter: { op: "gt", field: "amount", value: 10 } },
  });
  const t = 1000;
  store.policies.set(pkey("p1", "space"), {
    key: "p1", scope: "space", kind: "provider_label", value: { allow: { local: 3, cloud: 1 } }, updatedAt: t,
  });
  store.policies.set(pkey("p2", "space"), {
    key: "p2", scope: "space", kind: "gate",
    value: { act: "email.send", approver: "role:owner", caps: ["email.send"] }, updatedAt: t,
  });
  const reqs: Req[] = [];
  const levels: readonly Level[] = ["view", "use", "edit", "manage"];
  for (let u = 0; u < 10; u++) for (let f = 0; f < 5; f++) for (let k = 0; k < 20; k += 3) {
    reqs.push({
      principal: `u${u}`,
      action: { perm: "records.read", level: levels[(u + k) % 4]! },
      resource: { type: "deal", id: `r${f}_${k}` },
      row: { stage: k % 2 ? "won" : "open", amount: k * 7 },
      provider: u % 2 ? "cloud" : "local",
      now: 1000,
    });
  }
  reqs.push({
    principal: "ag1", actingFor: "u1", action: { perm: "records.read", level: "view" },
    resource: { type: "deal", id: "r1_1" }, row: { stage: "won", amount: 50 }, now: 1000,
  });
  return { store, reqs };
}

test("authorize sustains at least 500k decisions per second per core through access projections", () => {
  const { store, reqs } = world();
  const snap = store.snapshot();
  let allow = 0;
  let deny = 0;
  let hold = 0;
  for (const r of reqs) {
    const effect = authorize(snap, r).effect;
    if (effect === "allow") allow++;
    else if (effect === "deny") deny++;
    else hold++;
  }
  assert.ok(allow > 20 && deny > 20, `the mix must contain both (allow ${allow}, deny ${deny}, hold ${hold})`);
  let sink = 0;
  const run = (n: number): number => {
    const t0 = performance.now();
    for (let i = 0; i < n; i++) {
      if (authorize(snap, reqs[i % reqs.length]!).effect === "allow") sink++;
    }
    return performance.now() - t0;
  };
  run(300_000);
  const N = 1_500_000;
  const best = Math.min(run(N), run(N), run(N));
  const perSec = N / (best / 1000);
  console.log(`authorize projection bench: ${N} decisions in ${best.toFixed(0)} ms best of 3 = ${(perSec / 1000).toFixed(0)}k/s (${(best * 1000 / N).toFixed(2)} us), ${allow} allow / ${deny} deny / ${hold} hold (sink ${sink})`);
  assert.ok(perSec >= 500_000, `${(perSec / 1000).toFixed(0)}k/s is under the 500k/s budget`);
});
