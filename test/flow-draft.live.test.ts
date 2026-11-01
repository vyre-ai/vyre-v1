// Flow 9, "Describe a Flow in chat, watch it run", on a booted daemon: an agent drafts a Flow in a chat (automations.create from the thread), a card appears there with the flow in plain words and two
// buttons, the buttons' own capabilities (Turn on, Test) work as the person, and once on, the next matching record starts a Run.
import test from "node:test";
import assert from "node:assert/strict";
import { boot, call, connect, hostLog, newAgent, seededDir, waitFor } from "./memory-live-kit.ts";
import { linkCardOf } from "../ui/src/blocks/link-card/model.ts";
import type { Daemon } from "../host/src/daemon/daemon.ts";

let n = 0;
const ok = async (d: Daemon, cap: string, input: Record<string, unknown>): Promise<any> => {   // eslint-disable-line @typescript-eslint/no-explicit-any
  const r = await call(d, cap, { idempotencyKey: `fd-${cap}-${++n}`, ...input });
  assert.equal(r.status, 200, `${cap}: ${JSON.stringify(r.data)}`);
  return r.data;
};

test("flow draft live: the card says what it does, Turn on works as the person, and the next record starts a Run", async () => {
  const d = await boot(seededDir());
  try {
    await connect(d);
    const agent = await newAgent(d, "Builder");
    const threadId = (await ok(d, "chat.start", { kind: "chat", agentIds: [agent.id] })).thread.threadId as string;
    const definition = {
      triggers: [{ key: "record_change", config: {}, filter: { type: "contact", op: "created" } }],
      nodes: [{ id: "task", key: "create_task", title: "Make a task to call the lead", input: { title: "Call the new lead", assigned: { kind: "person", id: "usr_olivia" } } }],
    };
    await ok(d, "chat.post", { threadId, body: `TOOL automations_create ${JSON.stringify({ name: "New lead task", definition, idempotencyKey: "fd-create" })}`, mentions: [{ kind: "agent", id: agent.id }] });
    const card = await waitFor(async () => {
      await d.hooks?.pump?.();
      const msgs = (await call(d, "chat.messages.list", { threadId })).data.messages as Array<{ blocks?: { type: string; data: unknown }[] }>;
      for (const m of msgs) for (const b of m.blocks ?? []) { const c = linkCardOf(b); if (c && c.lead === "Flow drafted") return c; }
      return null;
    }, 40_000, () => hostLog(d));
    assert.equal(card.title, "New lead task");
    assert.deepEqual(card.body!.split("\n"), ["When a record changes", "Then make a task to call the lead"]);
    assert.equal(card.target!.type, "automation");
    assert.deepEqual(card.actions!.map((a) => a.key), ["on", "test"]);

    // the card's buttons are plain capability calls, run as the person
    const on = card.actions!.find((a) => a.key === "on") as { cap: string; input: Record<string, unknown> };
    const draft = (await ok(d, "automations.get", { automationId: card.target!.id })).automation;
    assert.equal(draft.status, "draft", "the agent's draft is not running");
    const enabled = (await ok(d, on.cap, on.input)).automation;
    assert.equal(enabled.status, "on");

    // the next matching record starts a Run
    await ok(d, "records.create", { type: "contact", fields: { name: "Dana Fox" } });
    const run = await waitFor(async () => {
      await d.hooks?.pump?.();
      return ((await call(d, "runs.list", { scope: "mine" })).data.runs as Array<{ name?: string; kind: string }> | undefined)?.find((r) => r.kind === "automation") ?? null;
    }, 40_000, () => hostLog(d));
    assert.ok(run);
    // and the Run did what the card said: the task exists
    const task = await waitFor(async () => {
      await d.hooks?.pump?.();
      return ((await call(d, "tasks.list", { scope: "all" })).data.tasks as Array<{ title: string }> | undefined)?.find((t) => t.title === "Call the new lead") ?? null;
    }, 40_000, () => hostLog(d));
    assert.ok(task);
  } finally { await d.stop(); }
});
