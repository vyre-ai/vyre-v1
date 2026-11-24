// invoke.commitEvents: what a replay after a stop commits is what the call would have committed. Same objects registered as resources, same owner, the same grants (an agent working for a person gets exactly what an
// uninterrupted call of that agent gets, none more), the same stamps (actor, acted-for, Run, trace), and an event id that is fixed, so a second replay writes nothing new.
import test from "node:test";
import assert from "node:assert/strict";
import { AccessSnapshot, authorize } from "../../kernel/src/authorize/index.ts";
import type { ResourceRow } from "../../kernel/src/authorize/index.ts";
import { createInvoke, indexCapabilities } from "../src/invoke.ts";
import type { CommitBatch, CtxSeed } from "../src/invoke.ts";
import { createResourceRegistrar } from "../src/gateway/resources.ts";
import type { SubjectDef } from "../src/gateway/resources.ts";
import type { CapabilityDef } from "../../packages/contracts/src/types.ts";
import type { EventEnvelope } from "../../packages/contracts/src/envelope.ts";

const REC = "rec_0123456789abcdef0123456789abcdef";
const EVENTS: SubjectDef[] = [{ name: "record.created", subject: { type: "record", id: "/recordId" } }];
const cap = (o: Record<string, unknown> & { name: string }): CapabilityDef =>
  ({
    v: 1,
    summary: "s",
    input: { type: "object" },
    output: { type: "object" },
    errors: [],
    resource: { type: "space" },
    permission: null,
    level: "edit",
    risk: "low",
    effects: "write",
    emits: [],
    idempotency: "natural",
    surfaces: {},
    examples: [],
    ...o,
  }) as unknown as CapabilityDef;

function rig() {
  const snap = new AccessSnapshot();
  snap.putRole({ id: "member", clearance: 2, perms: ["records.create", "records.edit"], name: "Member" });
  for (const id of ["usr_dana", "agt_scout"]) snap.putPrincipal({ id, kind: id.startsWith("agt_") ? "agent" : "person", status: "active", name: id });
  snap.addPrincipalRole({ holder: "usr_dana", role: "member" });
  snap.addPrincipalRole({ holder: "agt_scout", role: "member" });
  snap.putResource({ id: "spc_1", type: "space", parent_id: null, label: 0, owner_id: null, holds: 0 });
  snap.putResource({ id: "rt_item", type: "record_type", parent_id: "spc_1", label: 0, owner_id: null, holds: 0 });
  for (const who of ["usr_dana", "agt_scout"])
    snap.putGrant({ id: `g_${who}`, subject_kind: "actor", subject_id: who, resource_type: "record_type", resource_id: "rt_item", level: "edit" });
  const commits: CommitBatch[] = [];
  const invoke = createInvoke({
    caps: indexCapabilities([
      cap({ name: "records.bulk_upsert", resource: { type: "record", create: true, parent: "/type" }, permission: "records.create", emits: ["record.created"] }),
    ]),
    validateInput: () => [],
    authorize: (r) => authorize(snap, r),
    handler: () => (ctx, i: { type: string; id: string }) => {
      ctx.emit("record.created" as never, `record/${i.id}`, { recordId: i.id, type: i.type, fields: { name: "A" }, quiet: true });
      return { created: 1 };
    },
    commit: async (b) => {
      commits.push(b);
      const stored = b.events.map((e, i) => ({ ...e, seq: commits.length * 10 + i }) as EventEnvelope);
      for (const e of stored) if (e.type === ("resource.created" as never)) snap.putResource(e.payload as ResourceRow);
      return stored;
    },
    resources: createResourceRegistrar({ events: EVENTS, exists: (id) => snap.resource(id) !== undefined }),
  });
  return { invoke, commits, snap };
}

/** What a commit made, without the ids and clocks that differ between two runs. */
const shape = (b: CommitBatch) =>
  b.events.map((e) => ({
    type: e.type,
    actor: e.actor,
    onBehalf: e.onBehalf,
    runId: e.runId,
    traceId: e.traceId,
    entity: e.entity,
    payload: e.type === ("resource.created" as never) ? e.payload : { ...(e.payload as object) },
  }));

const seeds: Record<string, CtxSeed> = {
  "a person": { space: "spc_1", principal: { kind: "person", id: "usr_dana" }, trace: { traceId: "a".repeat(32), spanId: "b".repeat(16) } },
  "an agent working for a person, in a Run": {
    space: "spc_1",
    principal: { kind: "agent", id: "agt_scout" },
    actingFor: "usr_dana",
    run: "run_0123456789abcdef",
    trace: { traceId: "c".repeat(32), spanId: "d".repeat(16) },
  },
};

for (const [who, seed] of Object.entries(seeds)) {
  test(`a replay commits what the call would have: ${who}`, async () => {
    const control = rig();
    await control.invoke("records.bulk_upsert", { type: "rt_item", id: REC }, seed);
    const replay = rig();
    const stored = await replay.invoke.commitEvents!(
      "records.bulk_upsert",
      { type: "rt_item" },
      seed,
      [{ name: "record.created" as never, subject: `record/${REC}`, payload: { recordId: REC, type: "rt_item", fields: { name: "A" }, quiet: true }, id: "evt_a0123456789abcdef0123456789abcdef" }],
    );
    assert.equal(replay.commits.length, 1, "one commit");
    assert.deepEqual(shape(replay.commits[0]!), shape(control.commits[0]!), "row for row the same events, owners and grants as the uninterrupted call");
    assert.equal(stored[0]!.id, "evt_a0123456789abcdef0123456789abcdef", "the announcement keeps its fixed id");
    const owner = replay.commits[0]!.events.find((e) => e.type === ("resource.created" as never))!.payload as ResourceRow;
    assert.equal(owner.owner_id, seed.actingFor ?? seed.principal.id, "owned as the call would have owned it");
    assert.equal(replay.commits[0]!.events.filter((e) => e.type === ("grant.created" as never)).length, control.commits[0]!.events.filter((e) => e.type === ("grant.created" as never)).length, "no grant the call would not have made");
    assert.equal(replay.commits[0]!.audit, null, "no audit row: the call is not made again");
  });
}
