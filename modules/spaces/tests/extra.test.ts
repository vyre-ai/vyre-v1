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

test("exactly the thirteen capabilities that had no packet are handled", () => {
  assert.deepEqual(Object.keys(extraHandlers).sort(), [
    "spaces.delete", "spaces.delete_cancel", "spaces.delete_due", "spaces.export", "spaces.export_latest", "spaces.get", "spaces.image", "spaces.leave", "spaces.matrix", "spaces.switch_address", "spaces.timezone.set", "spaces.transfer_ownership", "spaces.update",
  ]);
});

test("get returns the profile with the owner, the pinned key fingerprint, the address and where it runs", async () => {
  const w = ready();
  const out = await call("spaces.get", w.ctx, {}) as { space: Record<string, unknown> };
  assert.deepEqual(out.space, {
    id: "spc_test", name: "Northwind", kind: "team", owner: "usr_owner", fingerprint: "ab12 cd34 ef56 7890", address: { mode: "relay" },
    hostedOn: "Vyre Server on a Mac mini", defaults: {}, timezone: "Asia/Karachi", createdAt: NOW,
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
  assert.deepEqual(p.features.map((f) => f.key), ["apps_public", "console", "webhooks", "always_on_runs", "sharing", "members"]);
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

const DAY = 86_400_000;
const FOURTEEN = 14 * DAY;
type Sp = { space: Record<string, unknown> };

test("delete needs the owner and the legal name typed exactly; it schedules the deletion 14 days out and removes nothing yet", async () => {
  const w = ready();
  await call("spaces.update", w.ctx, { legalName: "Northwind Law LLP" });
  w.events.length = 0;
  assert.equal((await failed(call("spaces.delete", w.ctx, { confirmName: "Northwind", withoutExport: true }))).error.code, "validation.precondition_failed");
  assert.equal((await failed(call("spaces.delete", w.ctx, { confirmName: "northwind law llp", withoutExport: true }))).error.code, "validation.precondition_failed");
  w.asPerson("usr_ines");
  assert.equal((await failed(call("spaces.delete", w.ctx, { confirmName: "Northwind Law LLP", withoutExport: true }))).error.code, "permission.role_lacks_permission");
  assert.deepEqual([w.events, w.host], [[], []]);
  w.asPerson("usr_owner");
  assert.deepEqual(await call("spaces.delete", w.ctx, { confirmName: "Northwind Law LLP", withoutExport: true }), { ok: true, deletionAt: NOW + FOURTEEN });
  assert.deepEqual(w.host, [], "the data stays until the date");
  assert.deepEqual(w.events.map((e) => [e.name, e.payload]), [["space.deletion_scheduled", { by: "usr_owner", at: NOW + FOURTEEN }]]);
  // everything keeps working, and the Space says when it goes
  const got = ((await call("spaces.get", w.ctx, {})) as Sp).space;
  assert.equal(got["deletionAt"], NOW + FOURTEEN);
  assert.equal(((await call("spaces.update", w.ctx, { name: "Still here" })) as Sp).space["name"], "Still here");
  // asking again keeps the date and announces nothing more
  w.events.length = 0;
  w.setNow(NOW + 2 * DAY);
  assert.deepEqual(await call("spaces.delete", w.ctx, { confirmName: "Northwind Law LLP", withoutExport: true }), { ok: true, deletionAt: NOW + FOURTEEN });
  assert.deepEqual(w.events, []);
});

test("a Space with no legal name is scheduled by typing its name", async () => {
  const w = ready({ name: "Harbor Studio" });
  assert.equal((await failed(call("spaces.delete", w.ctx, { confirmName: "Northwind", withoutExport: true }))).error.code, "validation.precondition_failed");
  await call("spaces.delete", w.ctx, { confirmName: "Harbor Studio", withoutExport: true });
  assert.deepEqual(w.host, []);
  assert.equal(((await call("spaces.get", w.ctx, {})) as Sp).space["deletionAt"], NOW + FOURTEEN);
});

test("delete cannot be scheduled without an export from the last 24 hours, unless the owner says without an export", async () => {
  const w = ready();
  const refused = await failed(call("spaces.delete", w.ctx, { confirmName: "Northwind" }));
  assert.equal(refused.error.code, "validation.precondition_failed");
  assert.deepEqual(refused.error.details, { reason: "export_required" });
  assert.deepEqual(w.events, []);
  assert.equal(((await call("spaces.get", w.ctx, {})) as Sp).space["deletionAt"], undefined);
  // an export older than a day does not count
  assert.deepEqual(await call("spaces.export_latest", w.ctx, {}), {});
  await call("spaces.export", w.ctx, { idempotencyKey: "k1" });
  w.setNow(NOW + 25 * 3_600_000);
  assert.equal((await failed(call("spaces.delete", w.ctx, { confirmName: "Northwind" }))).error.details?.["reason"], "export_required");
  // a fresh export does
  await call("spaces.export", w.ctx, { idempotencyKey: "k2" });
  assert.deepEqual(await call("spaces.delete", w.ctx, { confirmName: "Northwind" }), { ok: true, deletionAt: NOW + 25 * 3_600_000 + FOURTEEN });
});

test("export.latest answers the newest export's time, or nothing", async () => {
  const w = ready();
  assert.deepEqual(await call("spaces.export_latest", w.ctx, {}), {});
  await call("spaces.export", w.ctx, { idempotencyKey: "a" });
  w.setNow(NOW + 3_600_000);
  assert.deepEqual(await call("spaces.export_latest", w.ctx, {}), { at: NOW });
  await call("spaces.export", w.ctx, { idempotencyKey: "b" });
  assert.deepEqual(await call("spaces.export_latest", w.ctx, {}), { at: NOW + 3_600_000 });
});

test("cancel clears the schedule with one call, tells everyone by event, and the Space is not deleted afterwards", async () => {
  const w = ready();
  assert.equal((await failed(call("spaces.delete_cancel", w.ctx, {}))).error.code, "validation.precondition_failed", "nothing is scheduled");
  await call("spaces.delete", w.ctx, { confirmName: "Northwind", withoutExport: true });
  w.events.length = 0;
  w.asPerson("usr_ines");   // an admin who is not the owner
  assert.deepEqual(await call("spaces.delete_cancel", w.ctx, {}), { ok: true });
  assert.deepEqual(w.events.map((e) => [e.name, e.payload]), [["space.deletion_cancelled", { by: "usr_ines" }]]);
  assert.equal(((await call("spaces.get", w.ctx, {})) as Sp).space["deletionAt"], undefined);
  w.setNow(NOW + FOURTEEN + DAY);
  w.asService();
  assert.deepEqual(await call("spaces.delete_due", w.ctx, {}), { deleted: false });
  assert.deepEqual(w.host, []);
});

test("the minute job removes the Space only once the date has passed, then announces space.deleted", async () => {
  const w = ready();
  const due = (): Promise<unknown> => call("spaces.delete_due", w.ctx, {});
  w.asService();
  assert.deepEqual(await due(), { deleted: false }, "nothing scheduled");
  w.asPerson("usr_owner");
  await call("spaces.delete", w.ctx, { confirmName: "Northwind", withoutExport: true });
  w.events.length = 0;
  w.asService();
  w.setNow(NOW + FOURTEEN - 1);
  assert.deepEqual(await due(), { deleted: false }, "a moment before the date");
  assert.deepEqual([w.host, w.events], [[], []]);
  w.setNow(NOW + FOURTEEN);
  assert.deepEqual(await due(), { deleted: true });
  assert.deepEqual(w.host, ["delete"]);
  assert.deepEqual(w.events.map((e) => [e.name, e.payload]), [["space.deleted", { by: "usr_owner" }]]);
  // once only
  assert.deepEqual(await due(), { deleted: false });
  assert.deepEqual(w.host, ["delete"]);
  // a deleted Space answers nothing more
  w.asPerson("usr_owner");
  assert.equal((await failed(call("spaces.get", w.ctx, {}))).error.code, "validation.not_found");
  assert.equal((await failed(call("spaces.update", w.ctx, { name: "Again" }))).error.code, "validation.not_found");
});

test("only the host's own job removes a Space whose date has passed; a person is refused", async () => {
  const w = ready();
  await call("spaces.delete", w.ctx, { confirmName: "Northwind", withoutExport: true });
  w.setNow(NOW + FOURTEEN + 1);
  assert.equal((await failed(call("spaces.delete_due", w.ctx, {}))).error.code, "permission.no_grant");
  assert.deepEqual(w.host, []);
});

test("the module exports the minute job that does it", async () => {
  const { periodic } = await import("../impl.ts");
  const job = periodic["spaces.delete_due"];
  assert.equal(job.everyMs, 60_000);
  const w = ready();
  await call("spaces.delete", w.ctx, { confirmName: "Northwind", withoutExport: true });
  w.asService();
  await job.run(w.ctx);
  assert.deepEqual(w.host, []);
  w.setNow(NOW + FOURTEEN);
  assert.deepEqual(await job.run(w.ctx), []);
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

test("a Space settles on its owner's own time zone the first time it is read, and keeps it when the owner moves", async () => {
  const w = ready();
  const first = (await call("spaces.get", w.ctx, {}) as { space: { timezone?: string } }).space;
  assert.equal(first.timezone, "Asia/Karachi");
  w.zones.owner = "America/New_York";
  assert.equal(((await call("spaces.get", w.ctx, {})) as { space: { timezone?: string } }).space.timezone, "Asia/Karachi", "it does not follow the owner afterwards");
  const bare = ready();
  bare.zones.owner = undefined;
  assert.equal(((await call("spaces.get", bare.ctx, {})) as { space: { timezone?: string } }).space.timezone, "UTC", "no owner zone: UTC");
  const bad = ready();
  bad.zones.owner = "Mars/Olympus";
  assert.equal(((await call("spaces.get", bad.ctx, {})) as { space: { timezone?: string } }).space.timezone, "UTC", "a zone no runtime knows is not taken");
});

test("setting the time zone checks the name on the server, announces the change once, and the Space read carries it", async () => {
  const w = ready();
  const out = await call("spaces.timezone.set", w.ctx, { timezone: "America/Los_Angeles" }) as { space: { timezone?: string } };
  assert.equal(out.space.timezone, "America/Los_Angeles");
  assert.deepEqual(w.events.map((e) => [e.name, e.payload]), [["space.updated", { fields: ["timezone"], by: "usr_owner" }]]);
  w.events.length = 0;
  await call("spaces.timezone.set", w.ctx, { timezone: " America/Los_Angeles " });
  assert.deepEqual(w.events, [], "the same zone changes nothing and says nothing");
  assert.equal(((await call("spaces.get", w.ctx, {})) as { space: { timezone?: string } }).space.timezone, "America/Los_Angeles");
  for (const bad of ["", "Pacific", "Mars/Olympus", "../etc/passwd", "x".repeat(80)]) {
    assert.equal((await failed(call("spaces.timezone.set", w.ctx, { timezone: bad }))).error.code, "validation.bad_input", bad);
  }
  assert.equal(((await call("spaces.get", w.ctx, {})) as { space: { timezone?: string } }).space.timezone, "America/Los_Angeles", "a refused name changes nothing");
  assert.deepEqual(w.events, []);
});

test("setting the Space time zone is an admin's, and an agent's change goes to the Gate: the contract says so", async () => {
  const registry = JSON.parse((await import("node:fs")).readFileSync(new URL("../../../generated/registry.json", import.meta.url), "utf8")) as { capabilities: { name: string; permission?: string | null; gate?: { act: string; when?: string } | null; audit?: string }[] };
  const cap = registry.capabilities.find((c) => c.name === "spaces.timezone.set")!;
  assert.ok(cap, "in the contract");
  assert.equal(cap.permission, "policy.manage", "the permission a Member does not have");
  assert.equal(cap.gate?.act, "approve");
  assert.match(cap.gate?.when ?? "", /actor\.kind != 'person'/);
  assert.equal(cap.audit, "always");
});
