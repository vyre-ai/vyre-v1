// What a reader of my_access keeps between calls (r34-appspeed, 17 Nov 2026: access.lists rebuilt every row of the Space on every call, 0.7 to 6 s on 45,000 resources). The host hands a new db handle on every
// call, so the keep is keyed on the database and the access tables' write counter. The one thing that may never happen: a person sees a thing after they lost access to it, or misses it after they got it.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { openDb } from "../../../host/src/daemon/sqlite.ts";
import type { HostDb } from "../../../host/src/daemon/sqlite.ts";
import { migrate } from "../../../host/src/daemon/hosttables.ts";
import { scopedDb } from "../../../host/src/ctx/db.ts";
import { hostCalls, readCounts } from "../consumers.ts";
import type { LogEvent } from "../consumers.ts";
import { handlers } from "../handlers/index.ts";
import { READ_VIEW_REFUSAL, storeOf } from "../projections.ts";
import type { AccessCtx, AccessStore } from "../projections.ts";
import { check, providerCheck } from "../handlers/check.ts";
import {
  grantsList,
  groupsGet,
  groupsList,
  principalsEffective,
  principalsGet,
  principalsList,
  rolesAssign,
  rolesGet,
  rolesList,
} from "../handlers/roles.ts";
import { reachBatch } from "../handlers/reach.ts";
import { agentsCanCallGet, deciders, recordMarks, sharesOf } from "../handlers/share.ts";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const NOW = 1_800_000_000_000;
const SPACE = "spc_rv";
const TRACE = "0123456789abcdef0123456789abcdef";
const sync = hostCalls["access.sync"] as unknown as (ctx: unknown, input: { events: LogEvent[] }) => unknown;

type Ctx = AccessCtx & {
  origin: string;
  depth: number;
  actingFor?: string;
  call(cap: string, input: unknown): Promise<unknown>;
  log: { warn(): void };
};
function ctxOf(raw: HostDb, principal = "usr_owner", kind = "person", actingFor?: string): Ctx {
  return {
    space: SPACE,
    principal: { kind, id: principal },
    trace: { traceId: TRACE },
    now: () => NOW,
    db: scopedDb("access", raw, TRACE),
    emit: () => undefined,
    origin: "gateway",
    depth: 0,
    ...(actingFor ? { actingFor } : {}),
    call: async () => null,
    log: { warn: () => undefined },
  };
}
function fresh(tag: string): { file: string; raw: HostDb } {
  const dir = fs.mkdtempSync(path.join(process.env["TMPDIR"] ?? os.tmpdir(), `access-rv-${tag}-`));
  const file = path.join(dir, "modules.db");
  const raw = openDb(file);
  migrate(raw, ROOT, () => NOW);
  return { file, raw };
}

let seq = 0;
const ev = (type: string, payload: unknown): LogEvent => ({ seq: ++seq, type, payload });
const res = (id: string, type: string, parent: string | null, label = 0, owner = "usr_owner"): LogEvent =>
  ev("resource.created", { id, type, parent_id: parent, label, owner_id: owner, holds: 0 });
function seed(raw: HostDb): void {
  sync(ctxOf(raw), {
    events: [
      res(SPACE, "space", null),
      ...["usr_owner", "usr_mia", "usr_noor"].map((id) =>
        ev("principal.created", { id, kind: "person", name: id.slice(4), status: "active" }),
      ),
      ev("principal.created", { id: "agt_mine", kind: "agent", name: "Helper", status: "active", owner: "usr_mia" }),
      ev("principal.role_set", { holder: "usr_owner", role: "rol_owner" }),
      ev("principal.role_set", { holder: "usr_mia", role: "rol_member" }),
      ev("principal.role_set", { holder: "agt_mine", role: "rol_member" }),
      ev("group.member_added", { group: "grp_everyone", member: "usr_mia" }),
      ev("agent.privacy_set", { agentId: "agt_mine", private: true, assistant: true }),
      res("contact", "record_type", SPACE),
      res("rec_1", "record", "contact", 1, "usr_mia"),
      res("rec_2", "record", "contact", 2),
      res("fld_1", "folder", SPACE),
      res("agt_mine", "agent", SPACE, 0, "usr_mia"),
      ev("grant.created", {
        id: "gr_noor",
        subject_kind: "actor",
        subject_id: "usr_noor",
        resource_type: "record",
        resource_id: "rec_2",
        level: "view",
        conditions: { hiddenFields: ["email"] },
        by: "usr_owner",
      }),
      ev("grant.created", {
        id: "gr_grp",
        subject_kind: "group",
        subject_id: "grp_everyone",
        resource_type: "folder",
        resource_id: "fld_1",
        level: "edit",
        by: "usr_owner",
      }),
    ],
  });
}

import { shareKept } from "../handlers/share.ts";

const lists = (raw: HostDb, who: string) =>
  (handlers["access.lists"] as unknown as (c: unknown, i: unknown) => Promise<{ rows: { id: string }[] }>)(
    ctxOf(raw, who),
    { type: "folder" },
  ).then((r) => r.rows.map((x) => x.id).sort());

const everyone = (id: string): LogEvent =>
  ev("grant.created", {
    id,
    subject_kind: "group",
    subject_id: "grp_everyone",
    resource_type: "folder",
    resource_id: "fld_1",
    level: "edit",
    by: "usr_owner",
  });

test("a reader's my_access is kept across calls, and a grant or revoke is seen by the very next call", async () => {
  const { raw } = fresh("kept");
  seed(raw);
  assert.deepEqual(await lists(raw, "usr_mia"), ["fld_1"]);
  const hits = shareKept.hits;
  assert.deepEqual(await lists(raw, "usr_mia"), ["fld_1"]);
  assert.deepEqual(await lists(raw, "usr_noor"), []);
  assert.ok(shareKept.hits >= hits + 2, "the next calls reused what the first built");
  sync(ctxOf(raw), { events: [ev("grant.revoked", { grantId: "gr_grp", resource: { type: "folder", id: "fld_1" } })] });
  assert.deepEqual(await lists(raw, "usr_mia"), [], "a revoke is seen at once: nobody sees a thing after losing it");
  sync(ctxOf(raw), { events: [everyone("gr_grp2")] });
  assert.deepEqual(await lists(raw, "usr_mia"), ["fld_1"], "a grant is seen at once");
  sync(ctxOf(raw), { events: [res("fld_2", "folder", SPACE, 0, "usr_mia")] });
  assert.deepEqual(await lists(raw, "usr_mia"), ["fld_1", "fld_2"], "an object registered later is listed at once");
  raw.run("DELETE FROM access_grants WHERE id = ?", "gr_grp2"); // plain SQL moves the write counter too
  assert.deepEqual(await lists(raw, "usr_mia"), ["fld_2"], "a write with plain SQL is seen at once");
});

const grant = (id: string, rec: string): LogEvent =>
  ev("grant.created", {
    id,
    subject_kind: "actor",
    subject_id: "usr_mia",
    resource_type: "record",
    resource_id: rec,
    level: "view",
    by: "usr_owner",
  });

// ---- incremental: only what changed is worked out again, and the answer is the full rebuild's, row for row ----

import { readOnly } from "../projections.ts";
import { accessRowsFull, accessRowsNow } from "../handlers/share.ts";

const rowsKept = (raw: HostDb, now = NOW) =>
  readOnly(async (c: Ctx) => accessRowsNow(c as never))({ ...ctxOf(raw), now: () => now }, undefined as never);
const rowsFull = (raw: HostDb, now = NOW) =>
  readOnly(async (c: Ctx) => accessRowsFull(c as never))({ ...ctxOf(raw), now: () => now }, undefined as never);
async function same(raw: HostDb, what: string, now = NOW): Promise<void> {
  const kept = await rowsKept(raw, now); // before the full rebuild, which corrects the table
  assert.deepEqual(kept, await rowsFull(raw, now), what);
}

test("incremental: each kind of change gives the rows a full rebuild gives, and only the scoped ones are worked out again", async () => {
  const { raw } = fresh("incr");
  seed(raw);
  await same(raw, "first read");
  const inc = shareKept.incremental;
  sync(ctxOf(raw), { events: [res("rec_7", "record", "contact", 0, "usr_mia")] });
  await same(raw, "a new object");
  sync(ctxOf(raw), { events: [grant("gr_i1", "rec_2")] });
  await same(raw, "a grant");
  sync(ctxOf(raw), { events: [ev("grant.revoked", { grantId: "gr_i1", resource: { type: "record", id: "rec_2" } })] });
  await same(raw, "a revoke");
  sync(ctxOf(raw), { events: [res("rec_8", "record", "fld_1", 0, "usr_owner")] });
  sync(ctxOf(raw), { events: [everyone("gr_i2")] });
  await same(raw, "a grant on a folder reaches what is under it");
  assert.ok(shareKept.incremental >= inc + 4, "those were worked out incrementally, not rebuilt whole");
  const built = shareKept.built;
  // changes it cannot scope are a full rebuild, and still equal
  sync(ctxOf(raw), { events: [ev("group.member_added", { group: "grp_everyone", member: "usr_noor" })] });
  await same(raw, "a group membership");
  sync(ctxOf(raw), {
    events: [ev("principal.created", { id: "usr_new", kind: "person", name: "new", status: "active" })],
  });
  await same(raw, "a new person");
  sync(ctxOf(raw), { events: [ev("principal.role_set", { holder: "usr_noor", role: "rol_member" })] });
  await same(raw, "a role change");
  sync(ctxOf(raw), { events: [ev("principal.suspended", { principalId: "usr_mia" })] });
  await same(raw, "a suspension");
  assert.ok(shareKept.built >= built + 4, "those were full rebuilds");
  raw.run("DELETE FROM access_grants WHERE id = ?", "gr_i2"); // plain SQL
  await same(raw, "a plain SQL delete");
});

test("incremental: an expiring grant is gone when its time comes, with nothing else written", async () => {
  const { raw } = fresh("expiry");
  seed(raw);
  sync(ctxOf(raw), {
    events: [
      ev("grant.created", {
        id: "gr_exp",
        subject_kind: "actor",
        subject_id: "usr_noor",
        resource_type: "folder",
        resource_id: "fld_1",
        level: "edit",
        expires_at: NOW + 10_000,
        by: "usr_owner",
      }),
    ],
  });
  await same(raw, "before it expires");
  const before = (await rowsKept(raw)).filter((r) => r.person === "usr_noor" && r.id === "fld_1").length;
  const after = (await rowsKept(raw, NOW + 20_000)).filter((r) => r.person === "usr_noor" && r.id === "fld_1").length;
  assert.equal(before, 1);
  assert.equal(after, 0, "expired");
  await same(raw, "after it expired", NOW + 20_000);
});

test("incremental: random changes, 150 steps, equal to a full rebuild after every one", async () => {
  const { raw } = fresh("random");
  seed(raw);
  let x = 12345;
  const rnd = (n: number): number => {
    x = (x * 1103515245 + 12345) & 0x7fffffff;
    return x % n;
  };
  const people = ["usr_owner", "usr_mia", "usr_noor", "agt_mine"];
  const kinds = ["record", "folder", "file"];
  const objects = [SPACE, "contact", "fld_1", "rec_1", "rec_2", "agt_mine"];
  const grants: { id: string; at: string }[] = [];
  for (let step = 0; step < 150; step++) {
    const pick = rnd(10);
    let events: LogEvent[];
    if (pick < 4) {
      const id = `rnd_${step}`;
      const parent = objects[rnd(objects.length)]!;
      events = [res(id, kinds[rnd(3)]!, parent, rnd(3), people[rnd(3)]!)];
      objects.push(id);
    } else if (pick < 7) {
      const id = `gr_rnd_${step}`,
        at = objects[rnd(objects.length)]!;
      events = [
        ev("grant.created", {
          id,
          subject_kind: "actor",
          subject_id: people[rnd(3)]!,
          resource_type: kinds[rnd(3)]!,
          resource_id: at,
          level: ["view", "edit"][rnd(2)]!,
          by: "usr_owner",
        }),
      ];
      grants.push({ id, at });
    } else if (pick < 9 && grants.length) {
      const g = grants.splice(rnd(grants.length), 1)[0]!;
      events = [ev("grant.revoked", { grantId: g.id, resource: { type: "record", id: g.at } })];
    } else if (pick === 9 && step % 5 === 0) {
      events = [ev("group.member_added", { group: "grp_everyone", member: people[rnd(3)]! })];
    } else events = [res(`rnd_${step}`, "record", SPACE, 0, "usr_owner")];
    sync(ctxOf(raw), { events });
    if (step % 3 === 0) await same(raw, `step ${step}`); // some steps read after several changes: the changes then arrive together
  }
  await same(raw, "end");
  assert.ok(shareKept.incremental > 20, "most steps were worked out incrementally");
});
