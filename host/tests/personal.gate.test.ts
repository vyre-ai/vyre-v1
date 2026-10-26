// Host gate for a Personal Space (P-H_19, spec 2.1): invoke asks the Personal gate before anything else, so a team-only capability is refused with permission.needs_team in a Personal Space
// and answered normally once the Space is a Team Space. The matrix is personalMatrix (host/src/invoke.ts), which the daemon builds from the registry's teamOnly rows and the Space kind.
import test from "node:test";
import assert from "node:assert/strict";
import { AccessSnapshot, authorize } from "../../kernel/src/authorize/index.ts";
import { createInvoke, indexCapabilities, personalMatrix } from "../src/invoke.ts";
import { loadConfig } from "../src/daemon/config.ts";
import type { CtxSeed, InvokeDeps } from "../src/invoke.ts";
import { HostError } from "../src/routes/errors.ts";
import type { CapabilityDef } from "../../packages/contracts/src/types.ts";

const cap = (name: string): CapabilityDef => ({
  v: 1, name, summary: "s", input: { type: "object" }, output: { type: "object" }, errors: [], resource: { type: "record", id: "/id" }, permission: "records.edit", level: "edit",
  risk: "low", effects: "write", emits: [], idempotency: "natural", surfaces: {}, examples: [],
} as unknown as CapabilityDef);

let kind: "personal" | "team" = "personal";
const gate = personalMatrix({ kind: () => kind, caps: [{ name: "terminal.open", teamOnly: true }, { name: "records.update" }] }).gate;

function world() {
  const s = new AccessSnapshot();
  s.putRole({ id: "member", clearance: 2, perms: ["records.edit"], name: "Member" });
  s.putPrincipal({ id: "usr_dana", kind: "person", status: "active", name: "Dana" });
  s.addPrincipalRole({ holder: "usr_dana", role: "member" });
  s.putResource({ id: "root", type: "folder", parent_id: null, label: 0, owner_id: null, holds: 0 });
  s.putResource({ id: "rec_1", type: "record", parent_id: "root", label: 0, owner_id: null, holds: 0 });
  s.putGrant({ id: "g1", subject_kind: "actor", subject_id: "usr_dana", resource_type: "folder", resource_id: "root", level: "edit" });
  const ran: string[] = [], checked: string[] = [];
  const deps: InvokeDeps = {
    caps: indexCapabilities([cap("terminal.open"), cap("records.update")]),
    validateInput: (c) => { checked.push(c); return []; },
    authorize: (req) => authorize(s, req),
    handler: (c) => async () => { ran.push(c); return { ok: true }; },
    commit: async (b) => b.events.map((e, i) => ({ ...e, seq: i + 1 })),
    personal: { gate },
    now: () => 1_000,
  };
  return { invoke: createInvoke(deps), ran, checked };
}
const seed: CtxSeed = { space: "spc_1", principal: { kind: "person", id: "usr_dana" } };

test("a Personal Space refuses a team-only capability before validation and before any handler work", async () => {
  kind = "personal";
  const w = world();
  await assert.rejects(w.invoke("terminal.open", { id: "rec_1" }, seed), (e: unknown) => e instanceof HostError && e.error.code === "permission.needs_team" && e.http === 403 && e.error.traceId.length === 32 && e.error.next.length > 0);
  assert.deepEqual(w.checked, [], "refused before validation");
  assert.deepEqual(w.ran, [], "no handler ran");
});

test("a Personal Space serves a capability the matrix allows", async () => {
  kind = "personal";
  const w = world();
  const r = await w.invoke("records.update", { id: "rec_1" }, seed);
  assert.equal(r.status, "ok");
  assert.deepEqual(w.ran, ["records.update"]);
});

test("the same team-only call is served once the Space is a Team Space", async () => {
  kind = "team";
  const w = world();
  const r = await w.invoke("terminal.open", { id: "rec_1" }, seed);
  assert.equal(r.status, "ok");
  assert.deepEqual(w.ran, ["terminal.open"]);
});

test("the Space kind comes from --space-kind or VYRE_SPACE_KIND; anything else is refused; absent means a Team Space", () => {
  assert.equal(loadConfig(["--space-kind", "personal"], {}).spaceKind, "personal");
  assert.equal(loadConfig([], { VYRE_SPACE_KIND: "team" }).spaceKind, "team");
  assert.equal(loadConfig([], {}).spaceKind, undefined);
  assert.throws(() => loadConfig(["--space-kind", "solo"], {}), /personal or team/);
});
