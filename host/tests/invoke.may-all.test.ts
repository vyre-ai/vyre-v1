// ctx.mayAll (lib/audience.ts): a handler asks whether every person in a chat may open something, on each person's own grants and never the caller's or an agent's. Memory holds shared memory in a
// mixed chat to it, so a guest never hears what only a teammate may open. Authorize is the real kernel function over a real access snapshot (the rig of invoke.member-level.test.ts).
import test from "node:test";
import assert from "node:assert/strict";
import { AccessSnapshot, authorize } from "../../kernel/src/authorize/index.ts";
import { createInvoke, createRateLimiter, indexCapabilities } from "../src/invoke.ts";
import type { InvokeDeps } from "../src/invoke.ts";
import type { CapabilityDef, Ctx } from "../../packages/contracts/src/types.ts";

const probe = { name: "example.probe", v: 1, summary: "s", input: { type: "object" }, output: { type: "object" }, errors: [], resource: { type: "space" }, permission: null, level: "view", risk: "low", effects: "read", emits: [], idempotency: "natural", surfaces: {}, examples: [] } as unknown as CapabilityDef;

test("mayAll answers on each person's own grants: yes only when every one of them may open it", async () => {
  const s = new AccessSnapshot();
  s.putResource({ id: "spc_1", type: "space", parent_id: null, label: 0, owner_id: null, holds: 0 });
  s.putResource({ id: "fld_deal", type: "folder", parent_id: "spc_1", label: 0, owner_id: null, holds: 0 });
  s.putResource({ id: "fld_open", type: "folder", parent_id: "spc_1", label: 0, owner_id: null, holds: 0 });
  s.putRole({ id: "member", clearance: 2, perms: [], name: "Member" });
  s.putGrant({ id: "g_m", subject_kind: "role", subject_id: "member", resource_type: "space", resource_id: "spc_1", level: "view" });
  for (const id of ["usr_dana", "usr_gus"]) s.putPrincipal({ id, kind: "person", status: "active", name: id });
  s.addPrincipalRole({ holder: "usr_dana", role: "member" });
  // Gus is a guest: his one grant is the open folder; the deal folder is closed to him
  s.putGrant({ id: "g_g", subject_kind: "actor", subject_id: "usr_gus", resource_type: "folder", resource_id: "fld_open", level: "view" });
  let seen: Ctx | null = null;
  const deps: InvokeDeps = {
    caps: indexCapabilities([probe]), validateInput: () => [], authorize: (req) => authorize(s, req),
    handler: () => async (ctx: Ctx) => { seen = ctx; return {}; },
    commit: async (b) => b.events.map((e, i) => ({ ...e, seq: i + 1 })),
    idem: { once: (_p: string, _c: string, _k: string, _i: unknown, run: () => Promise<unknown>) => run() } as never,
    rate: createRateLimiter(), log: { debug() {}, info() {}, warn() {}, error() {} }, now: () => 1_000,
  };
  await createInvoke(deps)("example.probe", {}, { space: "spc_1", principal: { kind: "person", id: "usr_dana" } });
  const ctx = seen as unknown as Ctx;
  assert.equal(typeof ctx.mayAll, "function");
  const view = { perm: null, level: "view" as const };
  assert.equal(ctx.mayAll!(["usr_dana"], view, { type: "folder", id: "fld_deal" }), true, "Dana may open the folder");
  assert.equal(ctx.mayAll!(["usr_dana", "usr_gus"], view, { type: "folder", id: "fld_deal" }), false, "the answer is Gus's own, not Dana's: he may not open it");
  assert.equal(ctx.mayAll!(["usr_dana", "usr_gus"], view, { type: "folder", id: "fld_open" }), true, "both may open the open folder");
  assert.equal(ctx.mayAll!(["usr_dana", "usr_zed"], view, { type: "folder", id: "fld_deal" }), false, "a stranger in the list makes it no");
  assert.equal(ctx.mayAll!([], view, { type: "folder", id: "fld_deal" }), true, "nobody else: nothing to hold back");
});
