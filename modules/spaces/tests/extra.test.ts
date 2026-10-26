// The eight spaces capabilities without a packet of their own (P-L7_07b; spec 2.1, 3.13): profile, update, the Personal matrix, export, leave, transfer, delete, address.

import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { VyreErr } from "../../../packages/contracts/src/errors.ts";
import { NOW, world } from "../handlers/extra/memdb.ts";
import type { World } from "../handlers/extra/memdb.ts";
import { configureSpaceAdmin, extraHandlers } from "../handlers/extra/index.ts";
import { TEAM_LINE, TEAM_ONLY } from "../handlers/extra/core.ts";
import type { ExtraCtx } from "../handlers/extra/core.ts";

type Fn = (ctx: ExtraCtx, input: never) => Promise<unknown>;
const call = (name: string, ctx: ExtraCtx, input: unknown): Promise<unknown> => {
  const fn = (extraHandlers as unknown as Record<string, Fn>)[name];
  assert.ok(fn, `a handler for ${name}`);
  return fn(ctx, input as never);
};
const failed = async (p: Promise<unknown>): Promise<VyreErr> => {
  try { await p; } catch (e) { assert.ok(e instanceof VyreErr, "a typed error"); return e; }
  throw new Error("expected the call to fail");
};

function ready(o: Parameters<typeof world>[0] = {}): World {
  const w = world(o);
  configureSpaceAdmin(w.drivers);
  return w;
}

afterEach(() => configureSpaceAdmin(null));

test("exactly the eight capabilities that had no packet are handled", () => {
  assert.deepEqual(Object.keys(extraHandlers).sort(), [
    "spaces.delete", "spaces.export", "spaces.get", "spaces.leave", "spaces.matrix", "spaces.switch_address", "spaces.transfer_ownership", "spaces.update",
  ]);
});

test("get returns the profile with the owner, the pinned key fingerprint, the address and where it runs", async () => {
  const w = ready();
  const out = await call("spaces.get", w.ctx, {}) as { space: Record<string, unknown> };
  assert.deepEqual(out.space, {
    id: "spc_test", name: "Northwind", kind: "team", owner: "usr_owner", fingerprint: "ab12 cd34 ef56 7890", address: { mode: "relay" },
    hostedOn: "Vyre Server on a Mac mini", defaults: {}, createdAt: NOW,
  });
  // a Personal Space lives on the device
  const p = ready({ kind: "personal" });
  const personal = await call("spaces.get", p.ctx, {}) as { space: { kind: string; address: { mode: string } } };
  assert.deepEqual([personal.space.kind, personal.space.address.mode], ["personal", "device"]);
});

test("get keeps the time the profile was first read as the creation time unless the host knows better", async () => {
  const w = ready();
  await call("spaces.get", w.ctx, {});
  w.setNow(NOW + 5000);
  assert.equal(((await call("spaces.get", w.ctx, {})) as { space: { createdAt: number } }).space.createdAt, NOW);
  configureSpaceAdmin({ ...w.drivers, createdAt: async () => 1_700_000_000_000 });
  assert.equal(((await call("spaces.get", w.ctx, {})) as { space: { createdAt: number } }).space.createdAt, 1_700_000_000_000);
});

test("update changes only what was sent, says which fields changed and ignores a change to the same value", async () => {
  const w = ready();
  const out = await call("spaces.update", w.ctx, { name: "Northwind Law", legalName: "Northwind Law LLP", logoFileId: "fil_logo1", defaults: { skin: "paper", language: "en" } }) as { space: Record<string, unknown> };
  assert.deepEqual([out.space["name"], out.space["legalName"], out.space["logoFileId"], out.space["defaults"]], ["Northwind Law", "Northwind Law LLP", "fil_logo1", { skin: "paper", language: "en" }]);
  assert.deepEqual(w.events.map((e) => [e.name, e.payload]), [["space.updated", { fields: ["name", "legalName", "logoFileId", "defaults"], by: "usr_owner" }]]);
  w.events.length = 0;
  await call("spaces.update", w.ctx, { name: "Northwind Law", legalName: "Northwind Law LLP" });
  assert.deepEqual(w.events, [], "nothing changed, nothing announced");
  await call("spaces.update", w.ctx, { defaults: { skin: "graphite", language: null } });
  const again = await call("spaces.get", w.ctx, {}) as { space: { defaults: unknown } };
  assert.deepEqual(again.space.defaults, { skin: "graphite" }, "defaults merge and a null removes a key");
  assert.deepEqual(w.events.map((e) => (e.payload as { fields: string[] }).fields), [["defaults"]]);
  w.events.length = 0;
  await call("spaces.update", w.ctx, { logoFileId: null, legalName: "" });
  const cleared = ((await call("spaces.get", w.ctx, {})) as { space: Record<string, unknown> }).space;
  assert.deepEqual([cleared["logoFileId"], cleared["legalName"]], [undefined, undefined]);
  assert.deepEqual((w.events[0]!.payload as { fields: string[] }).fields, ["legalName", "logoFileId"]);
});

test("update refuses an empty or very long name, a long legal name and oversized defaults", async () => {
  const w = ready();
  assert.equal((await failed(call("spaces.update", w.ctx, { name: "  " }))).error.code, "validation.bad_input");
  assert.equal((await failed(call("spaces.update", w.ctx, { name: "x".repeat(121) }))).error.code, "validation.bad_input");
  assert.equal((await failed(call("spaces.update", w.ctx, { legalName: "x".repeat(201) }))).error.code, "validation.bad_input");
  const many = Object.fromEntries(Array.from({ length: 51 }, (_, i) => [`k${i}`, i]));
  assert.equal((await failed(call("spaces.update", w.ctx, { defaults: many }))).error.code, "validation.too_large");
  assert.equal((await failed(call("spaces.update", w.ctx, { defaults: { blob: "x".repeat(17_000) } }))).error.code, "validation.too_large");
  assert.deepEqual(w.events, []);
  assert.equal(((await call("spaces.get", w.ctx, {})) as { space: { name: string } }).space.name, "Northwind");
});

test("the Personal matrix: a Team Space has everything, a Personal Space shows one line for what needs a Team Space", async () => {
  const team = ready();
  const t = await call("spaces.matrix", team.ctx, {}) as { kind: string; features: { key: string; available: boolean; line?: string }[] };
  assert.equal(t.kind, "team");
  assert.deepEqual(t.features.map((f) => f.key), [...TEAM_ONLY]);
  assert.ok(t.features.every((f) => f.available && f.line === undefined));
  const personal = ready({ kind: "personal" });
  const p = await call("spaces.matrix", personal.ctx, {}) as { kind: string; features: { key: string; available: boolean; line?: string }[] };
  assert.equal(p.kind, "personal");
  assert.ok(p.features.every((f) => !f.available && f.line === TEAM_LINE));
  assert.deepEqual(p.features.map((f) => f.key), ["apps_public", "campaign_sending", "console", "agent_computers", "webhooks", "always_on_runs", "sharing", "members"]);
});

test("export is the Space-wide export of the backup module and answers with its run", async () => {
  const w = ready();
  assert.deepEqual(await call("spaces.export", w.ctx, { idempotencyKey: "idem_1" }), { runId: "run_export1" });
  assert.deepEqual(w.calls, [{ cap: "backup.export_start", input: { idempotencyKey: "spaces.export:idem_1" } }]);
});

test("a member can leave: devices purge and the person stops being served", async () => {
  const w = ready();
  w.asPerson("usr_ines");
  assert.deepEqual(await call("spaces.leave", w.ctx, { confirm: true }), { ok: true });
  assert.deepEqual(w.events.map((e) => [e.name, e.payload]), [
    ["member.removed", { personId: "usr_ines", by: "usr_ines", reason: "left" }],
    ["principal.suspended", { principalId: "usr_ines", reason: "left" }],
  ]);
});

test("the owner cannot leave before handing the Space over; without confirmation nothing happens", async () => {
  const w = ready();
  const err = await failed(call("spaces.leave", w.ctx, { confirm: true }));
  assert.equal(err.error.code, "validation.precondition_failed");
  assert.match(err.error.message, /own this Space/);
  w.asPerson("usr_ines");
  assert.equal((await failed(call("spaces.leave", w.ctx, { confirm: false }))).error.code, "validation.bad_input");
  assert.deepEqual(w.events, []);
});

test("the owner hands the Space to a member: the host moves the role, two events say so", async () => {
  const w = ready();
  assert.deepEqual(await call("spaces.transfer_ownership", w.ctx, { to: "usr_ines" }), { ok: true });
  assert.deepEqual(w.host, ["transfer usr_owner usr_ines"]);
  assert.deepEqual(w.events.map((e) => [e.name, e.payload]), [
    ["space.ownership_transferred", { from: "usr_owner", to: "usr_ines" }],
    ["access.changed", { epoch: 7, what: "assignment", by: "usr_owner" }],
  ]);
  assert.equal(((await call("spaces.get", w.ctx, {})) as { space: { owner: string } }).space.owner, "usr_ines");
  // and now the old owner cannot hand it over again
  assert.equal((await failed(call("spaces.transfer_ownership", w.ctx, { to: "usr_a1b2c3" }))).error.code, "permission.role_lacks_permission");
});

test("transfer refuses a non-owner caller, yourself and someone who is not a member", async () => {
  const w = ready();
  assert.equal((await failed(call("spaces.transfer_ownership", w.ctx, { to: "usr_owner" }))).error.code, "validation.precondition_failed");
  assert.equal((await failed(call("spaces.transfer_ownership", w.ctx, { to: "usr_stranger" }))).error.code, "validation.precondition_failed");
  w.asPerson("usr_ines");
  assert.equal((await failed(call("spaces.transfer_ownership", w.ctx, { to: "usr_ines" }))).error.code, "permission.role_lacks_permission");
  assert.deepEqual(w.host, []);
  assert.deepEqual(w.events, []);
});

test("delete needs the owner and the legal name typed exactly; then the host removes the data", async () => {
  const w = ready();
  await call("spaces.update", w.ctx, { legalName: "Northwind Law LLP" });
  w.events.length = 0;
  assert.equal((await failed(call("spaces.delete", w.ctx, { confirmName: "Northwind" }))).error.code, "validation.precondition_failed");
  assert.equal((await failed(call("spaces.delete", w.ctx, { confirmName: "northwind law llp" }))).error.code, "validation.precondition_failed");
  w.asPerson("usr_ines");
  assert.equal((await failed(call("spaces.delete", w.ctx, { confirmName: "Northwind Law LLP" }))).error.code, "permission.role_lacks_permission");
  assert.deepEqual([w.events, w.host], [[], []]);
  w.asPerson("usr_owner");
  assert.deepEqual(await call("spaces.delete", w.ctx, { confirmName: "Northwind Law LLP" }), { ok: true });
  assert.deepEqual(w.host, ["delete"]);
  assert.deepEqual(w.events.map((e) => [e.name, e.payload]), [["space.deleted", { by: "usr_owner" }]]);
  // a deleted Space answers nothing more
  assert.equal((await failed(call("spaces.get", w.ctx, {}))).error.code, "validation.not_found");
  assert.equal((await failed(call("spaces.update", w.ctx, { name: "Again" }))).error.code, "validation.not_found");
});

test("a Space with no legal name is deleted by typing its name", async () => {
  const w = ready({ name: "Harbor Studio" });
  assert.equal((await failed(call("spaces.delete", w.ctx, { confirmName: "Northwind" }))).error.code, "validation.precondition_failed");
  await call("spaces.delete", w.ctx, { confirmName: "Harbor Studio" });
  assert.deepEqual(w.host, ["delete"]);
});

test("switching the address applies it on the host, keeps the Space key and says what changed", async () => {
  const w = ready();
  const out = await call("spaces.switch_address", w.ctx, { mode: "own_domain", host: "Team.Example.com " }) as { space: { address: unknown; fingerprint: string } };
  assert.deepEqual(out.space.address, { mode: "own_domain", host: "team.example.com" });
  assert.equal(out.space.fingerprint, "ab12 cd34 ef56 7890", "the pinned key did not change, so nobody is invited again");
  assert.deepEqual(w.host, ["address own_domain team.example.com"]);
  assert.deepEqual(w.events.map((e) => [e.name, e.payload]), [["space.address_changed", { mode: "own_domain", host: "team.example.com", by: "usr_owner" }]]);
  w.events.length = 0;
  const back = await call("spaces.switch_address", w.ctx, { mode: "relay", host: "ignored.example.com" }) as { space: { address: unknown } };
  assert.deepEqual(back.space.address, { mode: "relay" });
  assert.deepEqual(w.host, ["address own_domain team.example.com", "address relay -"]);
  assert.deepEqual(w.events.map((e) => e.payload), [{ mode: "relay", by: "usr_owner" }]);
  // the same address again changes nothing
  w.events.length = 0;
  await call("spaces.switch_address", w.ctx, { mode: "relay" });
  assert.deepEqual([w.events, w.host.length], [[], 2]);
});

test("the address must be a domain name, and a Personal Space has none to move", async () => {
  const w = ready();
  for (const host of [undefined, "", "not a host", "192.168.1.5", "-bad.example.com", "x".repeat(300) + ".com", "https://team.example.com"]) {
    const err = await failed(call("spaces.switch_address", w.ctx, { mode: "own_domain", ...(host !== undefined ? { host } : {}) }));
    assert.equal(err.error.code, "validation.bad_input", String(host));
  }
  assert.deepEqual(w.host, []);
  const p = ready({ kind: "personal" });
  assert.equal((await failed(call("spaces.switch_address", p.ctx, { mode: "relay" }))).error.code, "permission.needs_team");
});

test("the host drivers must be wired", async () => {
  const w = ready();
  configureSpaceAdmin(null);
  assert.equal((await failed(call("spaces.get", w.ctx, {}))).error.code, "internal.unavailable");
});
