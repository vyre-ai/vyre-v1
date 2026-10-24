// Devices and sessions through the real handlers (spec 2.25).
// contract tests for revoke: revoking a device ends its sessions.
import test from "node:test";
import assert from "node:assert/strict";
import { handlers } from "../impl.ts";
import { codeOf, harness } from "../fixtures/db.ts";
import type { Harness } from "../fixtures/db.ts";

const MAYA = { id: "usr_maya", admin: false };
const names = (h: Harness) => h.events.map((e) => e.name);

/** Maya signs in on a Mac and a phone; Omar on a laptop. */
async function world() {
  const h = harness();
  const sys = h.system();
  const mac = await handlers["devices.register"](sys, { person: "usr_maya", name: "Maya's Mac", class: "desktop" });
  h.advance(60_000);
  const phone = await handlers["devices.register"](sys, { person: "usr_maya", name: "Maya's iPhone", class: "phone" });
  const laptop = await handlers["devices.register"](sys, { person: "usr_omar", name: "Omar's laptop", class: "desktop" });
  h.events.length = 0;
  return { h, mac, phone, laptop };
}

test("register opens a device and a session and says so", async () => {
  const h = harness();
  const out = await handlers["devices.register"](h.system(), { person: "usr_maya", name: "  Maya's Mac ", class: "desktop" });
  assert.equal(out.device.name, "Maya's Mac");
  assert.equal(out.device.person, "usr_maya");
  assert.equal(out.device.epoch, 0);
  assert.match(out.device.id, /^dev_/);
  assert.match(out.sessionId, /^ses_/);
  assert.deepEqual(names(h), ["device.registered", "session.started"]);
  assert.deepEqual(h.events[1]!.payload, { sessionId: out.sessionId, person: "usr_maya", deviceId: out.device.id });
});

test("mine shows my live devices and sessions, marks this device, and nobody else's", async () => {
  const { h, mac, phone } = await world();
  const mine = await handlers["devices.mine"](h.as(MAYA.id, { device: phone.device.id }), {});
  assert.deepEqual(mine.devices.map((d) => d.id), [phone.device.id, mac.device.id], "newest contact first");
  assert.deepEqual(mine.devices.map((d) => d.current), [true, false]);
  assert.equal(mine.sessions.length, 2);
  assert.ok(mine.sessions.every((s) => s.principal.id === "usr_maya" && s.kind === "device"));
  assert.deepEqual(mine.sessions.map((s) => s.current).sort(), [false, true]);
  await assert.rejects(handlers["devices.mine"](h.system(), {}), (e) => codeOf(e) === "auth.unauthenticated");
});

test("revoking a device ends its sessions, cuts it off on next contact and bumps the epoch", async () => {
  const { h, mac, phone } = await world();
  const out = await handlers["devices.revoke"](h.as(MAYA.id, { device: phone.device.id }), { deviceId: mac.device.id });
  assert.deepEqual(out, { ok: true });
  assert.deepEqual(names(h), ["device.revoked", "session.revoked", "epoch.bumped"]);
  assert.deepEqual(h.events[0]!.payload, { deviceId: mac.device.id, person: "usr_maya", by: "usr_maya" });
  assert.deepEqual(h.events[1]!.payload, { sessionId: mac.sessionId, person: "usr_maya", by: "usr_maya" });
  assert.deepEqual(h.events[2]!.payload, { scope: "person", person: "usr_maya", epoch: 1, reason: "device_revoked" });

  // its session is gone, the other device keeps its session and moves up to the new epoch
  const mine = await handlers["devices.mine"](h.as(MAYA.id, { device: phone.device.id }), {});
  assert.deepEqual(mine.devices.map((d) => d.id), [phone.device.id]);
  assert.deepEqual(mine.sessions.map((s) => s.id), [phone.sessionId]);
  assert.equal(mine.devices[0]!.epoch, 1);

  // on next contact the revoked device is told, and cannot touch
  const hello = await handlers["devices.epoch"](h.as(MAYA.id, { device: mac.device.id }), {});
  assert.deepEqual(hello, { personEpoch: 1, spaceEpoch: 0, revoked: true });
  assert.equal((await handlers["devices.epoch"](h.as(MAYA.id, { device: phone.device.id }), {})).revoked, false);
  await assert.rejects(handlers["devices.touch"](h.system(), { deviceId: mac.device.id }), (e) => codeOf(e) === "auth.device_revoked");

  // revoking again changes nothing and says nothing
  h.events.length = 0;
  await handlers["devices.revoke"](h.as(MAYA.id), { deviceId: mac.device.id });
  assert.deepEqual(h.events, []);
});

test("a device that is not yours reads as missing; an admin may revoke and see it", async () => {
  const { h, mac, laptop } = await world();
  await assert.rejects(handlers["devices.revoke"](h.as("usr_omar"), { deviceId: mac.device.id }), (e) => codeOf(e) === "validation.not_found");
  await assert.rejects(handlers["devices.get"](h.as("usr_omar"), { deviceId: mac.device.id }), (e) => codeOf(e) === "validation.not_found");
  const seen = await handlers["devices.get"](h.as("usr_admin", { admin: true }), { deviceId: mac.device.id });
  assert.equal(seen.device.id, mac.device.id);
  assert.deepEqual(seen.sessions.map((s) => s.id), [mac.sessionId]);
  await handlers["devices.revoke"](h.as("usr_admin", { admin: true }), { deviceId: laptop.device.id });
  assert.deepEqual(h.events[0]!.payload, { deviceId: laptop.device.id, person: "usr_omar", by: "usr_admin" });
  assert.equal((await handlers["devices.get"](h.as("usr_omar"), { deviceId: laptop.device.id })).device.revokedAt !== undefined, true);
});

test("sign out everywhere else keeps this device and returns how many it ended", async () => {
  const { h, mac, phone } = await world();
  const third = await handlers["devices.register"](h.system(), { person: "usr_maya", name: "Browser", class: "web" });
  h.events.length = 0;
  const out = await handlers["devices.revoke_others"](h.as(MAYA.id, { device: phone.device.id }), {});
  assert.deepEqual(out, { revoked: 2 });
  assert.deepEqual(h.events.filter((e) => e.name === "device.revoked").map((e) => (e.payload as { deviceId: string }).deviceId).sort(), [mac.device.id, third.device.id].sort());
  const mine = await handlers["devices.mine"](h.as(MAYA.id, { device: phone.device.id }), {});
  assert.deepEqual(mine.devices.map((d) => d.id), [phone.device.id]);
  assert.equal((await handlers["devices.revoke_others"](h.as(MAYA.id, { device: phone.device.id }), {})).revoked, 0);
});

test("a purge is acknowledged once, and only for a revoked device", async () => {
  const { h, mac } = await world();
  await assert.rejects(handlers["devices.purge_ack"](h.system(), { deviceId: mac.device.id }), (e) => codeOf(e) === "validation.precondition_failed");
  await handlers["devices.revoke"](h.as(MAYA.id), { deviceId: mac.device.id });
  h.events.length = 0;
  await handlers["devices.purge_ack"](h.system(), { deviceId: mac.device.id });
  await handlers["devices.purge_ack"](h.system(), { deviceId: mac.device.id });
  assert.deepEqual(h.events, [{ name: "device.purged", subject: mac.device.id, payload: { deviceId: mac.device.id, person: "usr_maya" } }]);
  await assert.rejects(handlers["devices.purge_ack"](h.system(), { deviceId: "dev_missing" }), (e) => codeOf(e) === "validation.not_found");
});

test("list is for admins' filters and pages; revoked devices stay listed with their time", async () => {
  const { h, mac, phone, laptop } = await world();
  await handlers["devices.revoke"](h.as(MAYA.id), { deviceId: mac.device.id });
  const admin = h.as("usr_admin", { admin: true });
  const all = await handlers["devices.list"](admin, {});
  assert.equal(all.total, 3);
  assert.equal(all.devices.find((d) => d.id === mac.device.id)?.revokedAt !== undefined, true);
  assert.deepEqual((await handlers["devices.list"](admin, { person: "usr_omar" })).devices.map((d) => d.id), [laptop.device.id]);
  assert.deepEqual((await handlers["devices.list"](admin, { class: "phone" })).devices.map((d) => d.id), [phone.device.id]);
  const first = await handlers["devices.list"](admin, { limit: 2 });
  assert.equal(first.devices.length, 2);
  assert.equal(first.next, "2");
  const rest = await handlers["devices.list"](admin, { limit: 2, cursor: first.next! });
  assert.equal(rest.devices.length, 1);
  assert.equal(rest.next, undefined);
});

test("sessions: list my own or anyone's with access.manage; end one", async () => {
  const { h, mac, phone, laptop } = await world();
  const maya = h.as(MAYA.id, { device: mac.device.id });
  assert.deepEqual((await handlers["devices.sessions.list"](maya, {})).sessions.map((s) => s.id).sort(), [mac.sessionId, phone.sessionId].sort());
  await assert.rejects(handlers["devices.sessions.list"](maya, { person: "usr_omar" }), (e) => codeOf(e) === "permission.no_grant");
  const seen = await handlers["devices.sessions.list"](h.as("usr_admin", { admin: true }), { person: "usr_omar" });
  assert.deepEqual(seen.sessions.map((s) => s.id), [laptop.sessionId]);

  await assert.rejects(handlers["devices.sessions.revoke"](h.as("usr_omar"), { sessionId: phone.sessionId }), (e) => codeOf(e) === "validation.not_found");
  await handlers["devices.sessions.revoke"](maya, { sessionId: phone.sessionId });
  assert.deepEqual(names(h), ["session.revoked"]);
  h.events.length = 0;
  await handlers["devices.sessions.revoke"](maya, { sessionId: phone.sessionId });
  assert.deepEqual(h.events, [], "ending an ended session says nothing");
  assert.deepEqual((await handlers["devices.sessions.list"](maya, {})).sessions.map((s) => s.id), [mac.sessionId]);
});

test("rename is the owner's act", async () => {
  const { h, mac } = await world();
  const out = await handlers["devices.rename"](h.as(MAYA.id), { deviceId: mac.device.id, name: " Studio Mac " });
  assert.equal(out.device.name, "Studio Mac");
  await assert.rejects(handlers["devices.rename"](h.as("usr_admin", { admin: true }), { deviceId: mac.device.id, name: "x" }), (e) => codeOf(e) === "validation.not_found");
  await assert.rejects(handlers["devices.rename"](h.as(MAYA.id), { deviceId: mac.device.id, name: "   " }), (e) => codeOf(e) === "validation.bad_input");
});

test("touch moves last seen and location of the device and its sessions", async () => {
  const { h, mac } = await world();
  h.advance(10 * 60_000);
  await handlers["devices.touch"](h.system(), { deviceId: mac.device.id, location: "Lisbon" });
  const got = await handlers["devices.get"](h.as(MAYA.id), { deviceId: mac.device.id });
  assert.equal(got.device.location, "Lisbon");
  assert.equal(got.sessions[0]!.location, "Lisbon");
  assert.ok(got.device.lastSeenAt! > got.sessions[0]!.startedAt);
  await assert.rejects(handlers["devices.touch"](h.system(), { deviceId: "dev_missing" }), (e) => codeOf(e) === "validation.not_found");
});

test("epochs: a person bump and a Space key rotation count up on their own", async () => {
  const { h } = await world();
  assert.deepEqual(await handlers["devices.epoch_bump"](h.system(), { person: "usr_maya", reason: "password_reset" }), { epoch: 1 });
  assert.deepEqual(await handlers["devices.epoch_bump"](h.system(), { person: "usr_maya", reason: "suspended" }), { epoch: 2 });
  assert.deepEqual(await handlers["devices.rotate_space_key"](h.as("usr_admin", { admin: true }), { reason: "offboarding" }), { epoch: 1 });
  assert.deepEqual((await handlers["devices.epoch"](h.as(MAYA.id), {})), { personEpoch: 2, spaceEpoch: 1, revoked: false });
  assert.deepEqual((await handlers["devices.epoch"](h.as("usr_omar"), {})), { personEpoch: 0, spaceEpoch: 1, revoked: false });
  assert.deepEqual(h.events.map((e) => e.payload), [
    { scope: "person", person: "usr_maya", epoch: 1, reason: "password_reset" },
    { scope: "person", person: "usr_maya", epoch: 2, reason: "suspended" },
    { scope: "space", epoch: 1, reason: "key_rotation" },
  ]);
});
