// P-L2_26: the limits the P-L2_24 groups reported. Unread counts and the unread filter in chat.recent, the / table of the composer, chat.open_tab respecting the person's setting and devices, and the
// messages the server writes in plain text (question, plan, helper, handoff) refused in a sealed thread, all against the frozen contract.
// @reads /generated/registry.json
import test from "node:test";
import assert from "node:assert/strict";
import { g26Handlers, sealedThread } from "../handlers/g26.ts";
import { handlers } from "../handlers/index.ts";
import { markRead } from "../handlers/g24a.ts";
import { ensurePrivate } from "../handlers/private.ts";
import { DANA, INTAKE, MAYA, assertEventsConform, codeOf, contractErrors, harness } from "../fixtures/harness.ts";
import type { Harness } from "../fixtures/harness.ts";

const h = handlers as unknown as Record<string, (ctx: Harness["ctx"], input: any) => Promise<any>>;   // eslint-disable-line @typescript-eslint/no-explicit-any
const NOW = 1_760_000_000_000;

async function chatWith(hn: Harness, ...ids: string[]) {
  const t = (await h["chat.start"]!(hn.ctx, { kind: "chat", agentIds: [INTAKE], idempotencyKey: `k${ids.join("")}${Math.random()}` })).thread.threadId as string;
  for (const id of ids) await h["threads.members.add"]!(hn.ctx, { threadId: t, personId: id });
  return t;
}

test("the finished handlers replace the group's entries of the same name in the table", () => {
  for (const name of Object.keys(g26Handlers)) assert.equal(h[name], (g26Handlers as Record<string, unknown>)[name], name);
});

test("chat.recent counts unread messages from others past the read cursor, filter unread keeps only those, and nextUnread names the first", async () => {
  const hn = harness();
  const quiet = await chatWith(hn);
  const busy = await chatWith(hn, MAYA);
  hn.advance(1000);
  await h["chat.post"]!(hn.person(MAYA), { threadId: busy, body: "one", idempotencyKey: "u1" });
  await h["chat.post"]!(hn.person(MAYA), { threadId: busy, body: "two", idempotencyKey: "u2" });
  const all = await h["chat.recent"]!(hn.ctx, {});
  assert.deepEqual(contractErrors("chat.recent", "out", all), []);
  const rows = [...all.today, ...all.yesterday, ...all.earlier] as Array<{ threadId: string; unread: number }>;
  assert.equal(rows.find((r) => r.threadId === busy)!.unread, 2);
  assert.equal(rows.find((r) => r.threadId === quiet)!.unread, 0);
  assert.equal(all.nextUnread, busy);
  const only = await h["chat.recent"]!(hn.ctx, { filter: "unread" });
  assert.deepEqual([...only.today, ...only.yesterday, ...only.earlier].map((r: { threadId: string }) => r.threadId), [busy]);
  await markRead(hn.ctx, { threadId: busy });
  const after = await h["chat.recent"]!(hn.ctx, { filter: "unread" });
  assert.deepEqual([...after.today, ...after.yesterday, ...after.earlier], []);
  assert.equal(after.nextUnread, null);
  assert.deepEqual(assertEventsConform(hn), []);
});

test("the composer / table lists the commands chat runs, filtered by what was typed; @ still comes from the group's table", async () => {
  const hn = harness();
  const all = await h["chat.composer.suggest"]!(hn.ctx, { symbol: "/", q: "" });
  assert.deepEqual(contractErrors("chat.composer.suggest", "out", all), []);
  assert.deepEqual(all.items.map((i: { id: string }) => i.id), ["plan", "helper", "handoff", "pin"]);
  assert.ok(all.items.every((i: { kind: string; group: string }) => i.kind === "command" && i.group === "Commands"));
  const some = await h["chat.composer.suggest"]!(hn.ctx, { symbol: "/", q: "/pl" });
  assert.deepEqual(some.items.map((i: { id: string }) => i.id), ["plan"]);
  const at = await h["chat.composer.suggest"]!(hn.ctx, { symbol: "@", q: "" });
  assert.deepEqual(contractErrors("chat.composer.suggest", "out", at), []);
});

test("chat.open_tab opens when the setting is on and a device is online; the person's setting off or no online device is a plain no, with no tab line", async () => {
  const online = { devices: [{ id: "dev_1", lastSeenAt: NOW - 1000 }] };
  const base = { "settings.get": () => ({ row: { value: true } }), "devices.mine": () => online };
  const a = harness({ calls: base });
  const ta = await chatWith(a);
  const ok = await h["chat.open_tab"]!(a.agent(INTAKE, DANA), { threadId: ta, targetType: "file", targetId: "fil_1" });
  assert.deepEqual(contractErrors("chat.open_tab", "out", ok), []);
  assert.equal(ok.opened, true);
  assert.equal(a.named("tab.opened").length, 1);

  const off = harness({ calls: { ...base, "settings.get": () => ({ row: { value: false } }) } });
  const tb = await chatWith(off);
  const no = await h["chat.open_tab"]!(off.agent(INTAKE, DANA), { threadId: tb, targetType: "file", targetId: "fil_1" });
  assert.deepEqual(no, { opened: false, reason: "disabled_by_person" });
  assert.equal(off.named("tab.opened").length, 0);
  assert.equal(off.rows("SELECT * FROM chat_message WHERE kind = 'agent'").length, 0, "no line is posted when the tab is not opened");

  const none = harness({ calls: { ...base, "devices.mine": () => ({ devices: [{ id: "dev_1", lastSeenAt: NOW - 10 * 60_000 }] }) } });
  const tc = await chatWith(none);
  assert.deepEqual(await h["chat.open_tab"]!(none.agent(INTAKE, DANA), { threadId: tc, targetType: "file", targetId: "fil_1" }), { opened: false, reason: "no_device" });

  const unreadable = harness({ calls: {} });
  const td = await chatWith(unreadable);
  assert.equal((await h["chat.open_tab"]!(unreadable.agent(INTAKE, DANA), { threadId: td, targetType: "file", targetId: "fil_1" })).opened, true, "settings and devices that cannot be read do not turn a tab away");
});

test("in a sealed thread the server-written messages are refused with bad_input and nothing is written; in an open thread they work as before", async () => {
  const hn = harness();
  const open = await chatWith(hn);
  const sealed = await chatWith(hn);
  ensurePrivate(hn.db);
  hn.db.run("INSERT INTO chat_private (thread, owner, keyId, sealedAt) VALUES (?, ?, ?, ?)", sealed, DANA, "key_1", NOW);
  assert.equal(sealedThread(hn.ctx, sealed), true);
  assert.equal(sealedThread(hn.ctx, open), false);
  const before = hn.rows("SELECT * FROM chat_message WHERE thread = ?", sealed).length;
  const agent = hn.agent(INTAKE, DANA);
  const refusals = [
    h["chat.question.ask"]!(agent, { threadId: sealed, prompt: "Which?", mode: "free" }),
    h["chat.plan.propose"]!(agent, { threadId: sealed, title: "Plan", steps: ["One"] }),
    h["chat.helper.start"]!(agent, { threadId: sealed, title: "Side", instruction: "Look" }),
    h["chat.handoff"]!(agent, { threadId: sealed, toAgentId: "agt_drafter", note: "Over to you" }),
  ];
  for (const p of refusals) await assert.rejects(p, (e) => codeOf(e) === "validation.bad_input");
  assert.equal(hn.rows("SELECT * FROM chat_message WHERE thread = ?", sealed).length, before, "no message was written in the sealed thread");
  const q = await h["chat.question.ask"]!(agent, { threadId: open, prompt: "Which?", mode: "free" });
  assert.deepEqual(contractErrors("chat.question.ask", "out", q), []);
});
