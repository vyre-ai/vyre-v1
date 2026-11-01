// Flow 8, "One-tap send", on a booted daemon: an agent tries to send an email, the Gate holds it, and the Approve task carries the whole draft so Needs you can show it beside its record; Send goes out as
// written (the task's own approve) and Ask for changes sends it back with the person's note and sends nothing.
import test from "node:test";
import assert from "node:assert/strict";
import { boot, call, connect, hostLog, newAgent, seededDir, waitFor } from "./memory-live-kit.ts";
import { heldMail } from "../apps/app/src/places/chats/needsyou/heldmail.ts";
import type { Daemon } from "../host/src/daemon/daemon.ts";

let n = 0;
const ok = async (d: Daemon, cap: string, input: Record<string, unknown>): Promise<any> => {   // eslint-disable-line @typescript-eslint/no-explicit-any
  const r = await call(d, cap, { idempotencyKey: `hs-${cap}-${++n}`, ...input });
  assert.equal(r.status, 200, `${cap}: ${JSON.stringify(r.data)}`);
  return r.data;
};

test("held send live: the held task holds the draft and its record; Ask for changes sends nothing", async () => {
  const d = await boot(seededDir());
  try {
    await connect(d);
    const agent = await newAgent(d, "Drafter");
    const rec = (await ok(d, "records.create", { type: "contact", fields: { name: "Dana Fox", email: "dana@fox.test" } })).record;
    const box = (await ok(d, "mail.mailbox.create", { kind: "shared", address: "hello@acme.test", title: "Hello", privacy: "space" })).mailbox;
    const threadId = (await ok(d, "chat.start", { kind: "chat", agentIds: [agent.id] })).thread.threadId as string;
    await ok(d, "threads.set_mode", { threadId, mode: "auto" });
    const send = { mailboxId: box.id, to: [{ address: "dana@fox.test", name: "Dana Fox", contactId: rec.id }], subject: "Your engagement letter", text: "Dear Dana, the letter is attached. Please sign by Friday.", contactId: rec.id, idempotencyKey: "hs-send" };
    await ok(d, "chat.post", { threadId, body: `TOOL mail_send ${JSON.stringify(send)}`, mentions: [{ kind: "agent", id: agent.id }] });
    const hold = await waitFor(async () => {
      await d.hooks?.pump?.();
      return ((await call(d, "gate.holds.list", { states: ["held"] })).data.holds as Array<{ capName: string; taskId: string; act: string }> | undefined)?.find((h) => h.capName === "mail.send") ?? null;
    }, 40_000, () => hostLog(d));
    assert.equal(hold.act, "send");

    const task = (await ok(d, "tasks.get", { taskId: hold.taskId })).task;
    const draft = heldMail(task);
    assert.ok(draft, "the held task carries the draft");
    assert.equal(draft.subject, "Your engagement letter");
    assert.deepEqual(draft.to, ["Dana Fox <dana@fox.test>"]);
    assert.match(draft.body, /Please sign by Friday/);
    assert.equal(draft.recordId, rec.id, "and the record it is about");
    assert.deepEqual(task.actions.map((a: { key: string }) => a.key), ["approve", "reject"]);

    // Ask for changes: the task goes back with the person's note, and nothing was sent
    await ok(d, "tasks.act", { taskId: hold.taskId, action: "reject", note: "Add the fee to the letter" });
    const sent = (await ok(d, "mail.message.list", { mailboxId: box.id })).messages as Array<{ direction: string }>;
    assert.equal(sent.filter((m) => m.direction === "out").length, 0, "nothing went out");
    const after = ((await call(d, "gate.holds.list", { states: ["held"] })).data.holds as unknown[]) ?? [];
    assert.equal(after.length, 0, "the hold is closed");
  } finally { await d.stop(); }
});
