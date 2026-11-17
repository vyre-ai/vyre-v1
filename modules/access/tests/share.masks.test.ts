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

// ---- the whole answer, not only my_access: a Space changed step by step, read through the kept path, answers every list exactly as a Space built from the same events in one go ----

const callAs = async (raw: HostDb, who: string, cap: string, input: unknown): Promise<unknown> => {
  try {
    return await (handlers[cap as keyof typeof handlers] as unknown as (c: unknown, i: unknown) => Promise<unknown>)(
      ctxOf(raw, who),
      input,
    );
  } catch (e) {
    return { refused: (e as { error?: { code?: string } }).error?.code ?? String(e) }; // a refusal is part of the answer
  }
};

// what this change touched: the lists that keep what they build (access.lists, folders.list) and the reads that now come from the kept view (policies, actors, exceptions, defaults)
async function everything(raw: HostDb, objects: { type: string; id: string }[]): Promise<string[]> {
  const out: unknown[] = [];
  for (const who of ["usr_owner", "usr_mia", "usr_noor"]) {
    for (const type of ["record", "folder", "file"]) out.push(await callAs(raw, who, "access.lists", { type }));
    out.push(await callAs(raw, who, "folders.list", { type: "file" }));
    out.push(await callAs(raw, who, "access.grants.list", {}));
    for (const cap of [
      "access.exceptions.list",
      "access.policies.list",
      "access.actors.list",
      "access.groups.defaults_get",
    ])
      out.push(await callAs(raw, who, cap, {}));
  }
  for (const o of objects) out.push(await callAs(raw, "usr_owner", "access.grants.list", { resource: o }));
  return out.map((o) => JSON.stringify(o));
}

/** Calls that look at the kept store the way the Console does between changes, and are not compared: the checker and the share list, which put the host's role grants on the snapshot they use. */
async function lookAround(raw: HostDb, objects: { type: string; id: string }[]): Promise<void> {
  for (const o of objects.slice(0, 6)) {
    await callAs(raw, "usr_owner", "access.shares_of", { resource: o });
    await callAs(raw, "usr_owner", "access.check", {
      principal: { kind: "person", id: "usr_mia" },
      action: { level: "view" },
      resource: o,
    });
  }
}

test("field masks: record, type and group and role grants with hidden fields answer the same kept as built in one go", async () => {
  const { raw } = fresh("masks");
  seed(raw);
  const log: LogEvent[] = [];
  const objects: { type: string; id: string }[] = [
    { type: "record", id: "rec_1" },
    { type: "record", id: "rec_2" },
    { type: "folder", id: "fld_1" },
  ];
  let x = 424242;
  const rnd = (n: number): number => {
    x = (x * 1103515245 + 12345) & 0x7fffffff;
    return x % n;
  };
  const masks = [["phone"], ["email"], ["phone", "email"], undefined];
  const grants: { id: string; at: string }[] = [];
  const check = async (what: string): Promise<void> => {
    await lookAround(raw, objects);
    const kept = await everything(raw, objects); // the kept path, after what came before it
    const { raw: rawB } = fresh("masks-b");
    seed(rawB);
    if (log.length) sync(ctxOf(rawB), { events: log.map((e) => ({ ...e, seq: ++seq })) });
    const full = await everything(rawB, objects);
    for (let i = 0; i < kept.length; i++) assert.equal(kept[i], full[i], `${what}: answer ${i} of ${kept.length}`);
  };
  for (let step = 0; step < 72; step++) {
    const pick = rnd(12);
    let events: LogEvent[] = [];
    if (pick < 3) {
      const id = `m_${step}`;
      const type = ["record", "folder", "file"][rnd(3)]!;
      events = [res(id, type, objects[rnd(objects.length)]!.id, rnd(3), ["usr_owner", "usr_mia", "usr_noor"][rnd(3)]!)];
      objects.push({ type, id });
    } else if (pick < 7) {
      const at = objects[rnd(objects.length)]!;
      const id = `gm_${step}`;
      const kind = rnd(4); // a person, a group, a role, a whole type
      const hidden = masks[rnd(masks.length)];
      events = [
        ev("grant.created", {
          id,
          subject_kind: kind === 1 ? "group" : kind === 2 ? "role" : "actor",
          subject_id: kind === 1 ? "grp_everyone" : kind === 2 ? "rol_member" : ["usr_mia", "usr_noor"][rnd(2)]!,
          resource_type: at.type,
          ...(kind === 3 ? {} : { resource_id: at.id }),
          level: ["view", "edit"][rnd(2)]!,
          ...(hidden ? { conditions: { hiddenFields: hidden } } : {}),
          by: "usr_owner",
        }),
      ];
      grants.push({ id, at: at.id });
    } else if (pick < 9 && grants.length) {
      const g = grants.splice(rnd(grants.length), 1)[0]!;
      events = [ev("grant.revoked", { grantId: g.id, resource: { type: "record", id: g.at } })];
    } else if (pick === 9)
      events = [ev("group.member_added", { group: "grp_everyone", member: ["usr_noor", "usr_mia"][rnd(2)]! })];
    else if (pick === 10)
      events = [
        ev("principal.role_set", {
          holder: ["usr_noor", "usr_mia"][rnd(2)]!,
          role: ["rol_member", "rol_guest"][rnd(2)]!,
        }),
      ];
    else events = [res(`n_${step}`, "record", "contact", rnd(3), "usr_owner")];
    sync(ctxOf(raw), { events });
    log.push(...events);
    if (step % 6 === 0) await check(`step ${step}`);
    else {
      await lookAround(raw, objects);
      await everything(raw, objects); // read too, so the kept state is carried through the steps in between
    }
  }
  await check("end");
});
