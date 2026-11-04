// The reusable Request to join link (lane l-consolidate): on, role, rotate, off; a person asks with a name and an email; an admin approves (a one-time invite at the link's role) or declines.
// @reads ../migrations/0004_join_link.sql
import test from "node:test";
import assert from "node:assert/strict";
import { handlers } from "../impl.ts";
import { codeOf, harness, KEYS } from "../fixtures/db.ts";

const JOIN = { username: "dana", displayName: "Dana", password: "a long enough password", deviceName: "Dana's Mac", deviceClass: "desktop" as const, keys: KEYS };
const ASK = { name: "Dana Lee", email: "Dana@Example.com", note: "From the Tuesday call" };

function requestCode(address: string): string {
  const m = /^https:\/\/maya\.vyre\.run\/join\/request\/([A-Z0-9]{4}-[A-Z0-9]{4})#fp=ab12cd34ef567890$/.exec(address);
  assert.ok(m, `address shape: ${address}`);
  return m![1]!;
}
async function turnedOn(h: ReturnType<typeof harness>, role?: string) {
  const { link } = await handlers["members.join_link.create"](h.as("usr_admin"), role ? { role } : {});
  return { link, code: requestCode(link.address!) };
}
const rejects = (p: Promise<unknown>, code: string, why: string) => assert.rejects(p, (e) => codeOf(e) === code, why);

test("the link is off until an admin turns it on, and says so with the least role", async () => {
  const h = harness();
  const { link } = await handlers["members.join_link.get"](h.as("usr_admin"), {});
  assert.deepEqual(link, { on: false, role: "rol_guest", waiting: 0, total: 0 });
  assert.deepEqual(h.raw.rows("members_join_link"), []);
});

test("turning it on makes the address, defaults to Guest, and Get shows the same address again", async () => {
  const h = harness();
  const { link, code } = await turnedOn(h);
  assert.equal(link.on, true);
  assert.equal(link.role, "rol_guest");
  assert.equal(link.waiting, 0);
  assert.deepEqual(h.events.map((e) => [e.name, e.payload]), [["member.join_link_changed", { change: "on", role: "rol_guest", by: "usr_admin" }]]);
  assert.ok(!JSON.stringify(h.events).includes(code), "the code is in no event");
  assert.equal((await handlers["members.join_link.get"](h.as("usr_admin"), {})).link.address, link.address, "a reusable link is shown again");
  const again = await handlers["members.join_link.create"](h.as("usr_admin"), {});
  assert.equal(again.link.address, link.address, "on twice is the same link");
  assert.equal(h.events.length, 1, "and says nothing the second time");
});

test("the role can be changed without changing the address; Owner and unknown roles are refused; a Space with no address cannot share a link", async () => {
  const h = harness();
  const { link } = await turnedOn(h);
  const member = await handlers["members.join_link.create"](h.as("usr_admin"), { role: "rol_member" });
  assert.equal(member.link.role, "rol_member");
  assert.equal(member.link.address, link.address);
  assert.deepEqual(h.events.map((e) => (e.payload as { change: string }).change), ["on", "role"]);
  await rejects(handlers["members.join_link.create"](h.as("usr_admin"), { role: "rol_owner" }), "validation.precondition_failed", "owner");
  await rejects(handlers["members.join_link.create"](h.as("usr_admin"), { role: "rol_nobody" }), "validation.not_found", "unknown role");
  const bare = harness();
  bare.world.host = undefined;
  await rejects(handlers["members.join_link.create"](bare.as("usr_admin"), {}), "validation.precondition_failed", "no address");
  assert.deepEqual(bare.raw.rows("members_join_link"), []);
});

test("Rotate makes a new address and the old one stops working; requests already waiting stay", async () => {
  const h = harness();
  const { code: oldCode } = await turnedOn(h);
  await handlers["members.join_link.request"](h.anon, { code: oldCode, ...ASK });
  h.advance(1000);
  const { link } = await handlers["members.join_link.rotate"](h.as("usr_admin"), {});
  const fresh = requestCode(link.address!);
  assert.notEqual(fresh, oldCode);
  assert.equal(link.rotatedAt, h.now());
  assert.equal(link.waiting, 1, "the request made through the old address is still there");
  await rejects(handlers["members.join_link.preview"](h.anon, { code: oldCode }), "auth.invalid_code", "old preview");
  await rejects(handlers["members.join_link.request"](h.anon, { code: oldCode, name: "Eve", email: "eve@example.com" }), "auth.invalid_code", "old request");
  assert.equal((await handlers["members.join_link.preview"](h.anon, { code: fresh })).spaceName, "Maya Studio");
  assert.equal(h.events.at(-1)!.name, "member.join_link_changed");
  assert.equal((h.events.at(-1)!.payload as { change: string }).change, "rotated");
  const off = harness();
  await rejects(handlers["members.join_link.rotate"](off.as("usr_admin"), {}), "validation.precondition_failed", "nothing to rotate");
});

test("Off stops the address and keeps the waiting requests; turning it on again makes a different address", async () => {
  const h = harness();
  const { code } = await turnedOn(h, "rol_member");
  await handlers["members.join_link.request"](h.anon, { code, ...ASK });
  const { link } = await handlers["members.join_link.disable"](h.as("usr_admin"), {});
  assert.deepEqual(link, { on: false, role: "rol_member", waiting: 1, total: 1, createdAt: link.createdAt });
  assert.equal(link.address, undefined);
  await rejects(handlers["members.join_link.request"](h.anon, { code, name: "Eve", email: "eve@example.com" }), "auth.invalid_code", "off");
  await rejects(handlers["members.join_link.preview"](h.anon, { code }), "auth.invalid_code", "off preview");
  assert.equal((await handlers["members.join_link.disable"](h.as("usr_admin"), {})).link.on, false, "off twice is fine");
  assert.equal(h.events.filter((e) => (e.payload as { change?: string }).change === "off").length, 1);
  const back = await handlers["members.join_link.create"](h.as("usr_admin"), {});
  assert.equal(back.link.role, "rol_member", "the role is kept");
  assert.notEqual(requestCode(back.link.address!), code, "an address shared before stays dead");
  assert.equal(back.link.waiting, 1);
});

test("a person asks with a name and an email: one waiting request, an event without the email, and the same email twice is one", async () => {
  const h = harness();
  const { code } = await turnedOn(h, "rol_member");
  h.events.length = 0;
  assert.deepEqual(await handlers["members.join_link.request"](h.anon, { code: ` ${code.toLowerCase().replace("-", " ")} `, ...ASK }), { ok: true }, "people type codes");
  const mine = (await handlers["members.join_requests.list"](h.as("usr_admin"), {})).requests;
  assert.equal(mine.length, 1);
  assert.deepEqual({ ...mine[0]!, id: "x" }, { id: "x", name: "Dana Lee", email: "dana@example.com", note: "From the Tuesday call", role: "rol_member", state: "waiting", at: h.now() });
  assert.deepEqual(h.events.map((e) => e.name), ["member.join_requested"]);
  assert.deepEqual(h.events[0]!.payload, { requestId: mine[0]!.id, name: "Dana Lee", role: "rol_member" });
  assert.ok(!JSON.stringify(h.events).includes("example.com"), "no email in the event");
  await handlers["members.join_link.request"](h.anon, { code, name: "Dana L", email: "DANA@example.com" });
  assert.equal((await handlers["members.join_requests.list"](h.as("usr_admin"), {})).total, 1);
  assert.equal(h.events.length, 1, "asking again says nothing more");
  assert.equal((await handlers["members.join_link.get"](h.as("usr_admin"), {})).link.waiting, 1);
});

test("what a request must carry is checked, and a wrong code reads like no link at all", async () => {
  const h = harness();
  const { code } = await turnedOn(h);
  const bad = (input: Record<string, unknown>, want: string, why: string) => rejects(handlers["members.join_link.request"](h.anon, { code, ...ASK, ...input } as never), want, why);
  await bad({ name: "  " }, "validation.bad_input", "name");
  await bad({ name: "x".repeat(101) }, "validation.bad_input", "long name");
  await bad({ email: "not-an-email" }, "validation.bad_input", "email");
  await bad({ note: "x".repeat(501) }, "validation.bad_input", "long note");
  await bad({ code: "ZZZZ-ZZZZ" }, "auth.invalid_code", "unknown code");
  await bad({ code: "" }, "auth.invalid_code", "empty code");
  await rejects(handlers["members.join_link.preview"](h.anon, { code: "ZZZZ-ZZZZ" }), "auth.invalid_code", "preview of an unknown code");
  assert.equal(h.raw.rows("members_join_requests").length, 0);
  // an invite code is not a request code
  const inv = await handlers["members.invites.create"](h.as("usr_admin"), { role: "rol_member", idempotencyKey: "k" });
  const invCode = /\/join\/([A-Z0-9-]+)#/.exec(inv.link)![1]!;
  await bad({ code: invCode }, "auth.invalid_code", "an invite code");
});

test("the preview names the Space, the role and the fingerprint", async () => {
  const h = harness();
  const { code } = await turnedOn(h, "rol_member");
  assert.deepEqual(await handlers["members.join_link.preview"](h.anon, { code }), { spaceId: "spc_test", spaceName: "Maya Studio", role: "Member", fingerprint: "ab12 cd34 ef56 7890" });
});

test("Approve makes a one-time invite for the email at the role the link had, then the person joins through it", async () => {
  const h = harness();
  const { code } = await turnedOn(h, "rol_member");
  await handlers["members.join_link.request"](h.anon, { code, ...ASK });
  const id = (await handlers["members.join_requests.list"](h.as("usr_admin"), { state: "waiting" })).requests[0]!.id;
  // the admin changes the link's role after the request: the request keeps the role it was made at
  await handlers["members.join_link.create"](h.as("usr_admin"), { role: "rol_guest" });
  h.events.length = 0;
  const out = await handlers["members.join_requests.approve"](h.as("usr_admin"), { requestId: id });
  assert.equal(out.invite.email, "dana@example.com");
  assert.equal(out.invite.role, "rol_member");
  assert.equal(out.invite.state, "open");
  assert.deepEqual(h.events.map((e) => e.name), ["member.invited"]);
  const inviteCode = /\/join\/([A-Z0-9-]+)#fp=/.exec(out.link)![1]!;
  assert.ok(!JSON.stringify(h.raw.rows("members_invites")).includes(inviteCode), "the invite code is stored only as a hash");
  const row = (await handlers["members.join_requests.list"](h.as("usr_admin"), {})).requests[0]!;
  assert.equal(row.state, "approved");
  assert.equal(row.inviteId, out.invite.id);
  assert.equal((await handlers["members.join_link.get"](h.as("usr_admin"), {})).link.waiting, 0);
  const joined = await handlers["members.accept"](h.anon, { code: inviteCode, ...JOIN });
  assert.equal(joined.personId, "usr_dana");
  assert.deepEqual(h.world.principals.get("usr_dana")!.roles, ["rol_member"]);
  await rejects(handlers["members.join_requests.approve"](h.as("usr_admin"), { requestId: id }), "validation.precondition_failed", "approved twice");
  await rejects(handlers["members.join_requests.decline"](h.as("usr_admin"), { requestId: id }), "validation.precondition_failed", "decline after approve");
});

test("Approve fails plainly when that email already has an open invite, and the request stays waiting", async () => {
  const h = harness();
  const { code } = await turnedOn(h);
  await handlers["members.invites.create"](h.as("usr_admin"), { role: "rol_member", email: "dana@example.com", idempotencyKey: "first" });
  await handlers["members.join_link.request"](h.anon, { code, ...ASK });
  const id = (await handlers["members.join_requests.list"](h.as("usr_admin"), {})).requests[0]!.id;
  await rejects(handlers["members.join_requests.approve"](h.as("usr_admin"), { requestId: id }), "validation.duplicate", "open invite");
  assert.equal((await handlers["members.join_requests.list"](h.as("usr_admin"), { state: "waiting" })).total, 1);
  await rejects(handlers["members.join_requests.approve"](h.as("usr_admin"), { requestId: "jrq_missing" }), "validation.not_found", "unknown request");
});

test("Decline closes the request without an invite; the same person can ask again", async () => {
  const h = harness();
  const { code } = await turnedOn(h);
  await handlers["members.join_link.request"](h.anon, { code, ...ASK });
  const id = (await handlers["members.join_requests.list"](h.as("usr_admin"), {})).requests[0]!.id;
  h.events.length = 0;
  assert.deepEqual(await handlers["members.join_requests.decline"](h.as("usr_admin"), { requestId: id }), { ok: true });
  assert.deepEqual(h.events.map((e) => [e.name, e.payload]), [["member.join_request_declined", { requestId: id }]]);
  assert.equal(h.raw.rows("members_invites").length, 0, "no invite");
  assert.deepEqual(await handlers["members.join_requests.decline"](h.as("usr_admin"), { requestId: id }), { ok: true }, "declined twice is fine");
  await rejects(handlers["members.join_requests.approve"](h.as("usr_admin"), { requestId: id }), "validation.precondition_failed", "approve after decline");
  h.advance(1000);
  await handlers["members.join_link.request"](h.anon, { code, ...ASK });
  const all = (await handlers["members.join_requests.list"](h.as("usr_admin"), {})).requests;
  assert.deepEqual(all.map((r) => r.state), ["waiting", "declined"], "newest first");
  assert.deepEqual((await handlers["members.join_requests.list"](h.as("usr_admin"), { state: "declined" })).requests.map((r) => r.id), [id]);
  assert.equal((await handlers["members.join_link.get"](h.as("usr_admin"), {})).link.total, 2);
});
