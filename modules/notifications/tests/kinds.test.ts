// notifications.kind.set_level: how one kind reaches me (desktop, phone, email), the level it lands at, and what it may never be lowered to.
import test from "node:test";
import assert from "node:assert/strict";
import { codeOf, harness } from "../fixtures/db.ts";
import { alice, as, bob, sendInput, svc } from "../fixtures/seed.ts";

const me = as(alice);
const sender = as(svc);
async function refused(p: Promise<unknown>, code: string): Promise<void> {
  await assert.rejects(p, (e) => { assert.equal(codeOf(e), code); return true; });
}

test("channels alone pick the level: desktop or phone interrupt, email or none is a badge", async () => {
  const h = harness();
  assert.deepEqual(await h.call("notifications.kind.set_level", { kind: "mention.thread", channels: ["phone", "desktop"] }, me), { kind: "mention.thread", level: "interrupt", channels: ["desktop", "phone"] });
  assert.deepEqual(await h.call("notifications.kind.set_level", { kind: "mention.thread", channels: ["email"] }, me), { kind: "mention.thread", level: "badge", channels: ["email"] });
  assert.deepEqual(await h.call("notifications.kind.set_level", { kind: "mention.thread", channels: [] }, me), { kind: "mention.thread", level: "badge", channels: [] });
});

test("send lands at my level for that kind, for me only", async () => {
  const h = harness();
  assert.equal((await h.call("notifications.send", sendInput({ kind: "reply.followed", collapseKey: "a" }), sender)).outcome, "badge");
  await h.call("notifications.kind.set_level", { kind: "reply.followed", channels: ["desktop"] }, me);
  assert.equal((await h.call("notifications.send", sendInput({ kind: "reply.followed", collapseKey: "b" }), sender)).outcome, "interrupt");
  assert.equal((await h.call("notifications.send", sendInput({ to: bob.id, kind: "reply.followed", collapseKey: "c" }), sender)).outcome, "badge", "another person keeps the shipped level");
  await h.call("notifications.kind.set_level", { kind: "dm", level: "badge" }, me);
  assert.equal((await h.call("notifications.send", sendInput({ kind: "dm" }), sender)).outcome, "badge", "a person may quiet a direct message");
});

test("kinds.list carries my choice only where I made one, and one event names the kind", async () => {
  const h = harness();
  await h.call("notifications.kind.set_level", { kind: "campaign.reply", channels: ["email"] }, me);
  const { kinds } = await h.call("notifications.kinds.list", {}, me);
  assert.deepEqual(kinds.find((k: { key: string }) => k.key === "campaign.reply").mine, { level: "badge", channels: ["email"] });
  assert.equal(kinds.filter((k: { mine?: unknown }) => k.mine !== undefined).length, 1);
  assert.deepEqual(h.events.map((e) => [e.name, e.payload.fields]), [["notification.rules_changed", ["kind:campaign.reply"]]]);
  await h.call("notifications.kind.set_level", { kind: "campaign.reply", channels: ["email"] }, me);
  assert.equal(h.events.length, 1, "no change, no event");
  const other = (await h.call("notifications.kinds.list", {}, as(bob))).kinds;
  assert.equal(other.some((k: { mine?: unknown }) => k.mine !== undefined), false);
});

test("refused: nothing to set, unknown kind, digest with channels, desktop at badge, lowering an owned incident", async () => {
  const h = harness();
  await refused(h.call("notifications.kind.set_level", { kind: "dm" }, me), "validation.bad_input");
  await refused(h.call("notifications.kind.set_level", { kind: "vault.rotation_due", level: "badge" }, me), "validation.bad_input");
  await refused(h.call("notifications.kind.set_level", { kind: "member.joined", level: "digest", channels: ["email"] }, me), "validation.bad_input");
  await refused(h.call("notifications.kind.set_level", { kind: "run.failed", level: "badge", channels: ["desktop"] }, me), "validation.bad_input");
  await refused(h.call("notifications.kind.set_level", { kind: "incident.owned", channels: ["email"] }, me), "validation.precondition_failed");
  await refused(h.call("notifications.kind.set_level", { kind: "approval.backstop", level: "digest" }, me), "validation.precondition_failed");
  assert.equal(h.events.length, 0);
});
