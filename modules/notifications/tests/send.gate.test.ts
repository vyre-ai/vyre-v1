// Who may send which notice (notifications.send, level use, an agent's meta tool). The kinds that email (the Space deletion notices) are sent only by Vyre itself: before, any member or agent
// could make the Space's own mailbox email every admin, as the owner, with words they wrote. The other system kinds (an approval reminder, a security-sounding line, health) are sent only by Vyre
// or by another module's code; a person or an agent calling it themselves may send only the kinds meant for them, and the line always names who sent it, never a name they typed.
// @reads /modules/notifications/migrations/0001_notifications_state.sql
// @reads /modules/notifications/migrations/0002_settings_effects.sql
// @reads /modules/notifications/migrations/0004_fanout_sent.sql
// @reads /modules/notifications/migrations/0005_fanout_email.sql
// @reads /modules/notifications/migrations/0006_email_record.sql
import test from "node:test";
import assert from "node:assert/strict";
import { harness } from "../fixtures/db.ts";
import { alice, as, bob, bot, svc } from "../fixtures/seed.ts";

const rows = (h: ReturnType<typeof harness>): Array<{ kind: string; title: string }> => h.sqlite.prepare("SELECT kind, title FROM notifications_items ORDER BY rowid").all() as Array<{ kind: string; title: string }>;

test("a member's and an agent's send of each emailing kind is refused and sends no mail", async () => {
  for (const who of [as(bob), as(bot)]) {
    for (const kind of ["space.deletion_scheduled", "space.deletion_cancelled"]) {
      const h = harness();
      await assert.rejects(() => h.call("notifications.send", { to: alice.id, kind, title: "Your Space will be deleted tonight. Keep it: https://evil.example/keep" }, who), (e: unknown) => /permission/.test(String((e as { error?: { code?: string } })?.error?.code ?? e)));
      assert.deepEqual(h.emails, [], `${who.kind} ${kind}: no mail`);
      assert.deepEqual(rows(h), [], "no line either");
    }
  }
});

test("a person or an agent calling it themselves cannot send a system kind (an approval reminder, health, an incident)", async () => {
  for (const kind of ["approval.backstop", "approval.requested", "health.degraded", "incident.owned", "machine.alert", "unblock.requested"]) {
    const h = harness();
    await assert.rejects(() => h.call("notifications.send", { to: alice.id, kind, title: "Sign in again at https://evil.example" }, as(bot)), (e: unknown) => /permission/.test(String((e as { error?: { code?: string } })?.error?.code ?? e)), kind);
    assert.deepEqual(rows(h), [], kind);
  }
});

test("a kind meant for a person or an agent to send goes through, and its line names who really sent it, not a name in the call", async () => {
  const h = harness();
  h.callee("access.principals.get", (i: { principal: { id: string } }) => ({ principal: { name: i.principal.id === bot.id ? "Intake bot" : "Bob Lane" } }));
  await h.call("notifications.send", { to: alice.id, kind: "dm", data: { from: "Your bank" } }, as(bot));
  assert.deepEqual(rows(h).map((r) => r.title), ["Message from Intake bot"]);
});

test("Vyre itself (the service) and another module's code (a call one level down) may send system kinds, as before", async () => {
  const h = harness();
  await h.call("notifications.send", { to: alice.id, kind: "approval.backstop", subject: { type: "task", id: "tsk_1" }, title: "Retainer", collapseKey: "approval.backstop:tsk_1" }, as(svc));
  await h.call("notifications.send", { to: alice.id, kind: "agent.blocked", data: { agent: "Your agents", reason: "an admin paused them" } }, as(bob, { depth: 1 }));
  assert.deepEqual(rows(h).map((r) => r.kind), ["approval.backstop", "agent.blocked"]);
});

test("the Gate's approval reminder, run later by the scheduler as the owner who asked (origin schedule), is a system send and goes through", async () => {
  const h = harness();
  await h.call("notifications.send", { to: alice.id, kind: "approval.backstop", subject: { type: "task", id: "tsk_2" }, title: "Retainer", collapseKey: "approval.backstop:tsk_2" }, as(alice, { origin: "schedule" }));
  assert.deepEqual(rows(h).map((r) => r.kind), ["approval.backstop"]);
});

test("a call another module only forwarded for someone (a stored schedule, a template's step) is that person's own send: a system kind is refused", async () => {
  const h = harness();
  await assert.rejects(() => h.call("notifications.send", { to: alice.id, kind: "health.degraded", data: { service: "Your Space", state: "down: sign in again at https://evil.example" } }, as(bob, { depth: 1, forwarded: true })), (e: unknown) => /permission/.test(String((e as { error?: { code?: string } })?.error?.code ?? e)));
  await assert.rejects(() => h.call("notifications.send", { to: alice.id, kind: "approval.backstop", subject: { type: "task", id: "tsk_9" }, title: "x" }, as(bob, { origin: "schedule", depth: 1, forwarded: true })), (e: unknown) => /permission/.test(String((e as { error?: { code?: string } })?.error?.code ?? e)));
  assert.deepEqual(rows(h), []);
});

test("a job the host runs later for module code is trusted only at the top of its call (depth 0); a step that job forwards further is not", async () => {
  const h = harness();
  await assert.rejects(() => h.call("notifications.send", { to: alice.id, kind: "health.degraded", data: { service: "x", state: "y" } }, as(bob, { origin: "schedule", depth: 2, forwarded: true })), (e: unknown) => /permission/.test(String((e as { error?: { code?: string } })?.error?.code ?? e)));
});

test("the agents' notifications_send tool offers only the four kinds an agent may send itself, the same list the server enforces", async () => {
  const { readFileSync } = await import("node:fs");
  const { SENDABLE_KINDS } = await import("../handlers/rules.ts");
  const tools = JSON.parse(readFileSync(new URL("../../../generated/mcp-tools.json", import.meta.url), "utf8")) as { tools: Array<{ name: string; inputSchema: { properties: { kind: { enum: string[] } } } }> };
  const tool = tools.tools.find((t) => t.name === "notifications_send")!;
  assert.deepEqual([...tool.inputSchema.properties.kind.enum].sort(), [...SENDABLE_KINDS].sort());
});
