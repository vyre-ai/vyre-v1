// Level 'member' (ruling 69): a capability bound to it is allowed for any person who holds a role or a grant in the Space, and refused for a stranger. The sync capabilities use it, so a person whose only
// grant is one folder can sync that folder; the handler then filters rows per resource.
// Authorize is the real kernel function over a real access snapshot (same rig as invoke.pipeline.test.ts).
import test from "node:test";
import assert from "node:assert/strict";
import { AccessSnapshot, authorize } from "../../kernel/src/authorize/index.ts";
import { createIdempotency } from "../../kernel/src/idempotency/index.ts";
import { createInvoke, createRateLimiter, indexCapabilities } from "../src/invoke.ts";
import type { CtxSeed, InvokeDeps } from "../src/invoke.ts";
import { isMemberOrGuest } from "../src/daemon/access.ts";
import { HostError } from "../src/routes/errors.ts";
import type { CapabilityDef } from "../../packages/contracts/src/types.ts";

const pull = { name: "sync.pull", v: 1, summary: "s", input: { type: "object" }, output: { type: "object" }, errors: [], resource: { type: "space" }, permission: null, level: "member", risk: "low", effects: "read", emits: [], idempotency: "natural", surfaces: {}, examples: [] } as unknown as CapabilityDef;
const viewOnly = { ...pull, name: "example.view", level: "view" } as unknown as CapabilityDef;

function world() {
  const s = new AccessSnapshot();
  s.putResource({ id: "spc_1", type: "space", parent_id: null, label: 0, owner_id: null, holds: 0 });
  s.putResource({ id: "fld_a", type: "folder", parent_id: "spc_1", label: 0, owner_id: null, holds: 0 });
  s.putRole({ id: "owner", clearance: 3, perms: [], name: "Owner" });
  s.putRole({ id: "member", clearance: 2, perms: [], name: "Member" });
  s.putGrant({ id: "g_o", subject_kind: "actor", subject_id: "usr_olivia", resource_type: "space", resource_id: "spc_1", level: "manage" });
  s.putGrant({ id: "g_m", subject_kind: "role", subject_id: "member", resource_type: "space", resource_id: "spc_1", level: "view" });
  for (const [id, role] of [["usr_olivia", "owner"], ["usr_noah", "member"]] as const) { s.putPrincipal({ id, kind: "person", status: "active", name: id }); s.addPrincipalRole({ holder: id, role }); }
  // Tess: no role, one grant on one folder. Zed: known to nobody. Rex: known, but no role and no grant.
  s.putPrincipal({ id: "usr_tess", kind: "person", status: "active", name: "Tess" });
  s.putGrant({ id: "g_t", subject_kind: "actor", subject_id: "usr_tess", resource_type: "folder", resource_id: "fld_a", level: "view" });
  s.putPrincipal({ id: "usr_rex", kind: "person", status: "active", name: "Rex" });
  return s;
}
function rig(withMembership = true) {
  const snap = world();
  const store = new Map<string, { hash: string; result: unknown }>();
  const deps: InvokeDeps = {
    caps: indexCapabilities([pull, viewOnly]),
    validateInput: () => [],
    authorize: (req) => authorize(snap, req),
    ...(withMembership ? { membership: (p: string, a?: string) => isMemberOrGuest(snap, p) && (a === undefined || isMemberOrGuest(snap, a)) } : {}),
    handler: () => async () => ({ ok: true }),
    commit: async (b) => b.events.map((e, i) => ({ ...e, seq: i + 1 })),
    idem: (() => { const i = createIdempotency({ get: (k) => store.get(k) ?? null, put: (k, _p, _c, rec) => { store.set(k, rec as { hash: string; result: unknown }); } }); return { once: (p: string, c: string, k: string, inp: unknown, run: () => Promise<unknown>) => i.once(p, c, k, inp, run as never) } as never; })(),
    rate: createRateLimiter(),
    log: { debug() {}, info() {}, warn() {}, error() {} },
    now: () => 1_000,
  };
  return createInvoke(deps);
}
const seed = (id: string): CtxSeed => ({ space: "spc_1", principal: { kind: "person", id } });
const refused = async (p: Promise<unknown>) => { try { await p; } catch (e) { assert.ok(e instanceof HostError); return e.error.code; } assert.fail("expected a refusal"); };

test("a member, an owner and a person whose only grant is one folder pass level 'member'", async () => {
  const invoke = rig();
  for (const id of ["usr_olivia", "usr_noah", "usr_tess"]) assert.equal((await invoke("sync.pull", {}, seed(id))).status, "ok", id);
});

test("a stranger and a known person with no role and no grant are refused", async () => {
  const invoke = rig();
  assert.match(await refused(invoke("sync.pull", {}, seed("usr_zed"))), /^(permission|auth)\./);
  assert.match(await refused(invoke("sync.pull", {}, seed("usr_rex"))), /^(permission|auth)\./);
});

test("an agent acts for a person: both must be members", async () => {
  const invoke = rig();
  const agent = (acting: string): CtxSeed => ({ space: "spc_1", principal: { kind: "person", id: "usr_noah" }, actingFor: acting });
  assert.equal((await invoke("sync.pull", {}, agent("usr_tess"))).status, "ok");
  assert.match(await refused(invoke("sync.pull", {}, agent("usr_zed"))), /^(permission|auth)\./);
});

test("a capability at level 'view' is as strict as before: Tess, with one folder grant, still cannot view the Space", async () => {
  const invoke = rig();
  assert.equal((await invoke("example.view", {}, seed("usr_noah"))).status, "ok");
  assert.match(await refused(invoke("example.view", {}, seed("usr_tess"))), /^(permission|auth)\./);
});

test("without a membership check, level 'member' falls back to view on the Space (a host that did not wire it is never more open)", async () => {
  const invoke = rig(false);
  assert.equal((await invoke("sync.pull", {}, seed("usr_noah"))).status, "ok");
  assert.match(await refused(invoke("sync.pull", {}, seed("usr_tess"))), /^(permission|auth)\./);
});
