// Host gate for a Personal Space (P-H_19, spec 2.1): invoke asks the Personal gate before anything else, so a team-only capability is refused with permission.needs_team in a Personal Space
// and answered normally once the Space is a Team Space. The matrix is personalMatrix (host/src/invoke.ts), which the daemon builds from the registry's teamOnly rows and the Space kind.
import test from "node:test";
import assert from "node:assert/strict";
import { AccessSnapshot, authorize } from "../../kernel/src/authorize/index.ts";
import { createInvoke, indexCapabilities, personalMatrix } from "../src/invoke.ts";
import { loadConfig } from "../src/daemon/config.ts";
import { ownsSubject } from "../src/daemon/own-subject.ts";
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

// ---- sharing with the person's own agents and automations (rc.14: "Needs a Team Space. vault.share works in a Team Space" on a key request card in a Personal Space)

const OWNERS: Record<string, string> = { agt_mine: "usr_dana", agt_theirs: "usr_zed", aut_daily: "usr_dana" };
const rows = {
  all(sql: string, id: unknown): unknown[] {
    const owner = OWNERS[String(id)];
    if (!owner) return [];
    if (/agents_agent/.test(sql) && String(id).startsWith("agt_")) return [{ ownerId: owner }];
    if (/automations_defs/.test(sql) && String(id).startsWith("aut_")) return [{ owner_id: owner }];
    return [];
  },
};

function shareWorld(spaceKind: "personal" | "team") {
  const s = new AccessSnapshot();
  s.putRole({ id: "member", clearance: 2, perms: ["records.edit"], name: "Member" });
  for (const id of ["usr_dana", "agt_mine"]) { s.putPrincipal({ id, kind: id.startsWith("agt_") ? "agent" : "person", status: "active", name: id }); s.addPrincipalRole({ holder: id, role: "member" }); }
  s.putResource({ id: "root", type: "folder", parent_id: null, label: 0, owner_id: null, holds: 0 });
  s.putResource({ id: "rec_1", type: "record", parent_id: "root", label: 0, owner_id: null, holds: 0 });
  s.putGrant({ id: "g1", subject_kind: "actor", subject_id: "usr_dana", resource_type: "folder", resource_id: "root", level: "edit" });
  s.putGrant({ id: "g2", subject_kind: "actor", subject_id: "agt_mine", resource_type: "folder", resource_id: "root", level: "edit" });
  const names = ["vault.share", "vault.unshare", "access.share", "access.unshare", "terminal.open"];
  const matrix = personalMatrix({ kind: () => spaceKind, caps: names.map((name) => ({ name, teamOnly: true })), owns: (subject, person) => ownsSubject(rows, subject, person) });
  const ran: string[] = [];
  const invoke = createInvoke({
    caps: indexCapabilities(names.map(cap)),
    validateInput: () => [],
    authorize: (req) => authorize(s, req),
    handler: (c) => async () => { ran.push(c); return { ok: true }; },
    commit: async (b) => b.events.map((e, i) => ({ ...e, seq: i + 1 })),
    personal: matrix,
    now: () => 1_000,
  });
  return { invoke, ran };
}
const refusal = async (p: Promise<unknown>): Promise<{ code: string; message: string }> => {
  try { await p; } catch (e) { if (e instanceof HostError) return { code: e.error.code, message: e.error.message ?? "" }; throw e; }
  throw new Error("it was not refused");
};
const share = (subject: { kind: string; id: string }) => ({ id: "rec_1", resource: { type: "vault_item", id: "vit_1" }, subject, level: "use" });

test("Personal: a person gives their own agent or automation Use on their item (vault.share, vault.unshare and the access.share under them)", async () => {
  const w = shareWorld("personal");
  for (const c of ["vault.share", "access.share", "vault.unshare", "access.unshare"]) assert.equal((await w.invoke(c, share({ kind: "agent", id: "agt_mine" }), seed)).status, "ok", c);
  assert.equal((await w.invoke("vault.share", share({ kind: "service", id: "svc_daily" }), seed)).status, "ok", "their own automation");
  assert.deepEqual(w.ran, ["vault.share", "access.share", "vault.unshare", "access.unshare", "vault.share"]);
});

test("Personal: sharing with another person, someone else's agent or an unknown one is still refused, in plain words", async () => {
  const w = shareWorld("personal");
  for (const subject of [{ kind: "person", id: "usr_zed" }, { kind: "group", id: "grp_all" }, { kind: "agent", id: "agt_theirs" }, { kind: "agent", id: "agt_gone" }, { kind: "service", id: "svc_other" }, { kind: "actor", id: "usr_dana" }]) {
    const r = await refusal(w.invoke("vault.share", share(subject), seed));
    assert.equal(r.code, "permission.needs_team", JSON.stringify(subject));
    assert.equal(r.message, "Sharing with other people needs a Team Space. Create or join one to share this.");
    assert.ok(!/vault\.share|access\.share/.test(r.message), "never a capability name in the words a person reads");
  }
  const bare = await refusal(w.invoke("vault.share", { id: "rec_1" }, seed));
  assert.equal(bare.code, "permission.needs_team", "no subject, no exception");
  const other = await refusal(w.invoke("terminal.open", share({ kind: "agent", id: "agt_mine" }), seed));
  assert.equal(other.message, "Needs a Team Space. Create or join one to use this.", "the exception is for the share capabilities only");
  assert.deepEqual(w.ran, []);
});

test("Personal: only the person makes the grant; their agent cannot give itself Use", async () => {
  const w = shareWorld("personal");
  const r = await refusal(w.invoke("vault.share", share({ kind: "agent", id: "agt_mine" }), { space: "spc_1", principal: { kind: "agent", id: "agt_mine" }, actingFor: "usr_dana" }));
  assert.equal(r.code, "permission.needs_team");
  assert.deepEqual(w.ran, []);
});

test("Personal: without an owner lookup there is no exception", async () => {
  const gateOnly = personalMatrix({ kind: () => "personal", caps: [{ name: "vault.share", teamOnly: true }] }).gate;
  assert.throws(() => gateOnly("vault.share", "0".repeat(32), { input: share({ kind: "agent", id: "agt_mine" }), principal: { kind: "person", id: "usr_dana" } }), (e: unknown) => e instanceof HostError && e.error.code === "permission.needs_team");
});

test("Team: sharing with a person or an agent goes on as before", async () => {
  const w = shareWorld("team");
  assert.equal((await w.invoke("vault.share", share({ kind: "person", id: "usr_zed" }), seed)).status, "ok");
  assert.equal((await w.invoke("vault.share", share({ kind: "agent", id: "agt_theirs" }), seed)).status, "ok");
  assert.deepEqual(w.ran, ["vault.share", "vault.share"]);
});

test("ownsSubject reads the modules' own rows: an agent by agents_agent.ownerId, an automation (svc_<id>) by automations_defs.owner_id", () => {
  assert.equal(ownsSubject(rows, { kind: "agent", id: "agt_mine" }, "usr_dana"), true);
  assert.equal(ownsSubject(rows, { kind: "agent", id: "agt_theirs" }, "usr_dana"), false);
  assert.equal(ownsSubject(rows, { kind: "agent", id: "agt_gone" }, "usr_dana"), false);
  assert.equal(ownsSubject(rows, { kind: "service", id: "svc_daily" }, "usr_dana"), true);
  assert.equal(ownsSubject(rows, { kind: "service", id: "svc_" }, "usr_dana"), false);
  assert.equal(ownsSubject(rows, { kind: "person", id: "usr_dana" }, "usr_dana"), false);
  assert.equal(ownsSubject({ all: () => { throw new Error("no such table"); } }, { kind: "agent", id: "agt_mine" }, "usr_dana"), false);
});
