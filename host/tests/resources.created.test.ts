// P-H_16: resources register themselves. A capability that creates an object of a resource type gets a `resource.created` event in the same commit, so the object is authorizable at once,
// for every module, with no per-module code.
import test from "node:test";
import assert from "node:assert/strict";
import { AccessSnapshot, authorize } from "../../kernel/src/authorize/index.ts";
import type { ResourceRow } from "../../kernel/src/authorize/index.ts";
import { createInvoke, indexCapabilities } from "../src/invoke.ts";
import type { CommitBatch, CtxSeed, Handler } from "../src/invoke.ts";
import { HostError } from "../src/routes/errors.ts";
import { createResourceRegistrar, idFits, KNOWN_TYPES, missingAgentResources } from "../src/gateway/resources.ts";
import type { SubjectDef } from "../src/gateway/resources.ts";
import { createPrincipalRegistrar } from "../src/gateway/principals.ts";
import { foldEvent } from "../src/daemon/access.ts";
import { registry } from "../../generated/registry.ts";
import type { CapabilityDef } from "../../packages/contracts/src/types.ts";
import type { EventEnvelope } from "../../packages/contracts/src/envelope.ts";

const REC = "rec_0123456789abcdef0123456789abcdef", REC2 = "rec_fedcba9876543210fedcba9876543210";
const EVENTS: SubjectDef[] = [
  { name: "record.created", subject: { type: "record", id: "/recordId" } },
  { name: "record.deleted", subject: { type: "record", id: "/recordId" } },
  { name: "schema.type_changed", subject: { type: "record_type", id: "/type" } },
  { name: "access.changed", subject: { type: "entity", id: "/epoch" } },
];
const cap = (o: Record<string, unknown> & { name: string }): CapabilityDef => ({
  v: 1, summary: "s", input: { type: "object" }, output: { type: "object" }, errors: [], resource: { type: "space" }, permission: null, level: "edit",
  risk: "low", effects: "write", emits: [], idempotency: "natural", surfaces: {}, examples: [], ...o,
} as unknown as CapabilityDef);
const ev = (type: string, payload: unknown) => ({ type, payload });

test("registrar: the first event about an object registers it, with the call's container as parent and the actor as owner", () => {
  const known = new Set(["spc_1", "rt_item"]);
  const r = createResourceRegistrar({ events: EVENTS, exists: (id) => known.has(id) });
  const rows = r.register({ cap: { name: "records.create", resource: { type: "record", create: true, parent: "/type" } }, input: { type: "rt_item" }, space: "spc_1", owner: "usr_dana", events: [ev("record.created", { recordId: REC, type: "rt_item" })] });
  assert.deepEqual(rows, [{ id: REC, type: "record", parent_id: "rt_item", label: 0, owner_id: "usr_dana", holds: 0 }]);
  const space = r.register({ cap: { name: "schema.apply", resource: { type: "space" } }, input: {}, space: "spc_1", owner: "usr_dana", events: [ev("schema.type_changed", { type: "company" })] });
  assert.deepEqual(space, [{ id: "company", type: "record_type", parent_id: "spc_1", label: 0, owner_id: "usr_dana", holds: 0 }], "a new record type is a resource under the Space");
});

test("registrar: known objects, deletions, entity subjects, malformed ids and repeats register nothing", () => {
  const known = new Set(["spc_1", REC]);
  const r = createResourceRegistrar({ events: EVENTS, exists: (id) => known.has(id) });
  const call = (events: { type: string; payload: unknown }[]) => r.register({ cap: { name: "x.y", resource: { type: "space" } }, input: {}, space: "spc_1", owner: "usr_dana", events });
  assert.deepEqual(call([ev("record.created", { recordId: REC })]), [], "already a resource");
  assert.deepEqual(call([ev("record.deleted", { recordId: REC2 })]), [], "an event that ends an object never births one");
  assert.deepEqual(call([ev("access.changed", { epoch: 4 })]), [], "an entity subject is not a resource type");
  assert.deepEqual(call([ev("record.created", { recordId: "not-an-id" }), ev("record.created", {}), ev("unknown.event", { recordId: REC2 })]), [], "a malformed or missing id, or an event the registry does not know");
  assert.equal(call([ev("record.created", { recordId: REC2 }), ev("record.created", { recordId: REC2 })]).length, 1, "two events about one new object register it once");
});

test("registrar: id shapes follow the contract prefixes", () => {
  assert.ok(idFits("record", REC) && !idFits("record", "usr_a1") && !idFits("record", "00000000-0000-4000-8000-000000000001"));
  assert.ok(idFits("record_type", "company") && !idFits("record_type", "Company") && idFits("kit", "kit_a1b2") && !idFits("nonsense", "x_1"));
});

test("registrar: every resource type a registry event names as its subject has an id check", () => {
  const types = new Set(registry.events.map((e) => e.subject.type).filter((t) => t !== "entity"));
  for (const t of types) assert.ok(KNOWN_TYPES.includes(t), `${t} has no id shape in host/src/gateway/resources.ts`);
});

function rig(withRegistrar: boolean) {
  const snap = new AccessSnapshot();
  snap.putRole({ id: "member", clearance: 2, perms: ["records.create", "records.edit"], name: "Member" });
  snap.putPrincipal({ id: "usr_dana", kind: "person", status: "active", name: "Dana" });
  snap.addPrincipalRole({ holder: "usr_dana", role: "member" });
  snap.putResource({ id: "spc_1", type: "space", parent_id: null, label: 0, owner_id: null, holds: 0 });
  snap.putResource({ id: "rt_item", type: "record_type", parent_id: "spc_1", label: 0, owner_id: null, holds: 0 });
  snap.putGrant({ id: "g1", subject_kind: "actor", subject_id: "usr_dana", resource_type: "record_type", resource_id: "rt_item", level: "edit" });
  const caps = [
    cap({ name: "records.create", resource: { type: "record", create: true, parent: "/type" }, permission: "records.create", emits: ["record.created"] }),
    cap({ name: "records.update", resource: { type: "record", id: "/recordId" }, permission: "records.edit", emits: [] }),
  ];
  const handlers: Record<string, Handler> = {
    "records.create": (ctx, i: { type: string }) => { ctx.emit("record.created" as never, `record/${REC}`, { recordId: REC, type: i.type }); return { id: REC }; },
    "records.update": () => ({ ok: true }),
  };
  const commits: CommitBatch[] = [];
  const invoke = createInvoke({
    caps: indexCapabilities(caps), validateInput: () => [], authorize: (r) => authorize(snap, r), handler: (c) => handlers[c],
    commit: async (b) => {
      commits.push(b);
      const stored = b.events.map((e, i) => ({ ...e, seq: commits.length * 10 + i }) as EventEnvelope);
      for (const e of stored) if (e.type === ("resource.created" as never)) snap.putResource(e.payload as ResourceRow);
      return stored;
    },
    ...(withRegistrar ? { resources: createResourceRegistrar({ events: EVENTS, exists: (id) => snap.resource(id) !== undefined }) } : {}),
  });
  return { snap, invoke, commits };
}
const seed: CtxSeed = { space: "spc_1", principal: { kind: "person", id: "usr_dana" } };

test("pipeline: the creator can use what a call created right after it returns, and resource.created rides in the same commit", async () => {
  const r = rig(true);
  await r.invoke("records.create", { type: "rt_item", fields: {} }, seed);
  assert.equal(r.commits.length, 1, "one commit for the call");
  assert.deepEqual(r.commits[0]!.events.map((e) => e.type), ["record.created", "resource.created"]);
  const made = r.commits[0]!.events[1]!;
  assert.equal(made.entity, "resource"); assert.equal(made.entityId, REC);
  assert.deepEqual(made.payload, { id: REC, type: "record", parent_id: "rt_item", label: 0, owner_id: "usr_dana", holds: 0 });
  assert.equal(made.actor, "usr_dana"); assert.equal(made.traceId, r.commits[0]!.events[0]!.traceId);
  assert.equal(r.snap.resource(REC)?.owner_id, "usr_dana");
  const res = await r.invoke("records.update", { recordId: REC }, seed);
  assert.equal(res.status, "ok", "the new record is authorizable at once");
});

test("pipeline: without the registrar the same call leaves an unknown object, which is the bug this fixes", async () => {
  const r = rig(false);
  await r.invoke("records.create", { type: "rt_item", fields: {} }, seed);
  assert.deepEqual(r.commits[0]!.events.map((e) => e.type), ["record.created"]);
  await assert.rejects(r.invoke("records.update", { recordId: REC }, seed), (e: unknown) => e instanceof HostError && e.error.code === "permission.not_found");
});

test("registrar: a birth event that names an ownerId makes that person the owner, not the caller (agents.create for someone else); a malformed ownerId is ignored", () => {
  const events: SubjectDef[] = [{ name: "agent.created", subject: { type: "agent", id: "/agentId" } }];
  const r = createResourceRegistrar({ events, exists: (id) => id === "spc_1" });
  const call = (payload: unknown) => r.register({ cap: { name: "agents.create", resource: { type: "space" } }, input: {}, space: "spc_1", owner: "usr_admin", events: [ev("agent.created", payload)] });
  assert.equal(call({ agentId: "agt_a1b2c3", ownerId: "usr_mia" })[0]?.owner_id, "usr_mia");
  assert.equal(call({ agentId: "agt_a1b2c4" })[0]?.owner_id, "usr_admin", "no ownerId: the caller");
  assert.equal(call({ agentId: "agt_a1b2c5", ownerId: "not a person" })[0]?.owner_id, "usr_admin", "a malformed ownerId is ignored");
  // only types that opt in: a record whose event happens to carry an ownerId stays the caller's
  const rec = createResourceRegistrar({ events: [{ name: "record.created", subject: { type: "record", id: "/recordId" } }], exists: (id) => id === "spc_1" });
  assert.equal(rec.register({ cap: { name: "records.create", resource: { type: "space" } }, input: {}, space: "spc_1", owner: "usr_admin", events: [ev("record.created", { recordId: REC, ownerId: "usr_mia" })] })[0]?.owner_id, "usr_admin");
});

test("registrar: an agent follow-up event cannot claim an agent before agent.created does", () => {
  const events: SubjectDef[] = [
    { name: "agent.created", subject: { type: "agent", id: "/agentId" } },
    { name: "agent.config_changed", subject: { type: "agent", id: "/agentId" } },
  ];
  const r = createResourceRegistrar({ events, exists: () => false });
  const cap = { name: "host.hook.call.agents.config_watch", resource: { type: "space" } };
  const agentId = "agt_a1b2c3";

  assert.deepEqual(
    r.register({ cap, input: {}, space: "spc_1", owner: "svc_host", events: [ev("agent.config_changed", { agentId, fields: ["model"], by: "svc_host" })] }),
    [],
    "only agent.created may register an agent resource",
  );
  assert.equal(
    r.register({ cap: { name: "agents.create", resource: { type: "space" } }, input: {}, space: "spc_1", owner: "usr_mia", events: [ev("agent.created", { agentId, ownerId: "usr_mia" })] })[0]?.owner_id,
    "usr_mia",
  );
});

test("reconciliation: a historical agent birth missing resource.created is restored with its named owner", () => {
  const agentId = "agt_a1b2c3";
  assert.deepEqual(
    missingAgentResources({
      space: "spc_1",
      events: [
        ev("agent.created", { agentId, ownerId: "usr_mia", name: "Intake" }),
        ev("agent.config_changed", { agentId, fields: ["model"], by: "svc_host" }),
      ],
    }),
    [{ id: agentId, type: "agent", parent_id: "spc_1", label: 0, owner_id: "usr_mia", holds: 0 }],
  );
});

test("reconciliation: reads a stored import/replay payload and ignores malformed owner records", () => {
  const encode = (v: unknown): Uint8Array => new TextEncoder().encode(JSON.stringify(v));
  assert.deepEqual(
    missingAgentResources({ space: "spc_1", events: [{ type: "agent.created", payload: encode({ agentId: "agt_a1b2c3", ownerId: "usr_mia" }) }] }),
    [{ id: "agt_a1b2c3", type: "agent", parent_id: "spc_1", label: 0, owner_id: "usr_mia", holds: 0 }],
  );
  assert.deepEqual(
    missingAgentResources({ space: "spc_1", events: [{ type: "agent.created", payload: encode({ agentId: "agt_a1b2c4", ownerId: "svc_host" }) }] }),
    [],
    "a replay cannot invent an owner from a host follow-up identity",
  );
});

test("reconciliation: existing resources are retained, and a restored historical agent is repaired", () => {
  const agentId = "agt_a1b2c3";
  const birth = ev("agent.created", { agentId, ownerId: "usr_mia", name: "Intake" });
  assert.deepEqual(
    missingAgentResources({ space: "spc_1", events: [birth, ev("resource.created", { id: agentId, type: "agent", parent_id: "spc_1", owner_id: "usr_mia", label: 0, holds: 0 })] }),
    [],
    "the normal create commit already has the resource",
  );
  assert.deepEqual(
    missingAgentResources({ space: "spc_1", events: [birth, ev("agent.deleted", { agentId }), ev("agent.restored", { agentId })] }),
    [{ id: agentId, type: "agent", parent_id: "spc_1", label: 0, owner_id: "usr_mia", holds: 0 }],
    "restore repairs a missing historical resource",
  );
});

test("pipeline: agent creation registers its named owner resource before the agent access principal", async () => {
  const snap = new AccessSnapshot();
  snap.putRole({ id: "rol_owner", clearance: 4, perms: ["agents.create"], name: "Owner" });
  snap.putPrincipal({ id: "usr_admin", kind: "person", status: "active", name: "Admin" });
  snap.putPrincipal({ id: "usr_mia", kind: "person", status: "active", name: "Mia" });
  snap.addPrincipalRole({ holder: "usr_admin", role: "rol_owner" });
  snap.addPrincipalRole({ holder: "usr_mia", role: "rol_owner" });
  snap.putResource({ id: "spc_1", type: "space", parent_id: null, label: 0, owner_id: "usr_admin", holds: 0 });
  snap.putGrant({ id: "g_admin", subject_kind: "actor", subject_id: "usr_admin", resource_type: "space", resource_id: "spc_1", level: "manage", by: "usr_admin" });
  snap.putGrant({ id: "g_mia", subject_kind: "actor", subject_id: "usr_mia", resource_type: "space", resource_id: "spc_1", level: "manage", by: "usr_admin" });
  const agentId = "agt_a1b2c3";
  const commits: CommitBatch[] = [];
  const invoke = createInvoke({
    caps: indexCapabilities([cap({ name: "agents.create", resource: { type: "space" }, permission: "agents.create", emits: ["agent.created"] })]), validateInput: () => [], authorize: (r) => authorize(snap, r),
    handler: () => (ctx) => { ctx.emit("agent.created" as never, `agent/${agentId}`, { agentId, name: "Intake", ownerId: "usr_mia", folderId: "fld_home" }); return { agentId }; },
    resources: createResourceRegistrar({ events: [{ name: "agent.created", subject: { type: "agent", id: "/agentId" } }], exists: (id) => snap.resource(id) !== undefined }),
    principals: createPrincipalRegistrar({ exists: (id) => snap.info(id) !== null, levelOf: () => "edit" }),
    commit: async (batch) => {
      commits.push(batch);
      const stored = batch.events.map((e, i) => ({ ...e, seq: i + 1 }) as EventEnvelope);
      for (const e of stored) foldEvent(snap, e);
      return stored;
    },
  });
  await invoke("agents.create", { name: "Intake" }, { space: "spc_1", principal: { kind: "person", id: "usr_admin" } });
  assert.deepEqual(commits[0]!.events.map((e) => e.type), ["agent.created", "resource.created", "principal.created", "principal.role_set", "grant.created", "grant.created", "grant.created"]);
  assert.equal(snap.resource(agentId)?.owner_id, "usr_mia");
  assert.equal(snap.info(agentId)?.p.kind, "agent");
  assert.equal(authorize(snap, { principal: agentId, actingFor: "usr_mia", action: { perm: null, level: "view" }, resource: { type: "agent", id: agentId } }).effect, "allow");
});
