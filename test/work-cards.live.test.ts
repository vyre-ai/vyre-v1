// @tsx
// Work a turn starts appears under its reply as cards (rc.9 lane E): an agent makes a record and a task from a chat and the reply carries a card for each, naming them and pointing at them, in one
// message.
import test from "node:test";
import assert from "node:assert/strict";
import { boot, call, connect, hostLog, newAgent, seededDir, waitFor } from "./memory-live-kit.ts";
import { linkCardOf } from "../ui/src/blocks/link-card/model.ts";
import type { Daemon } from "../host/src/daemon/daemon.ts";

let n = 0;
const ok = async (d: Daemon, cap: string, input: Record<string, unknown>): Promise<any> => {   // eslint-disable-line @typescript-eslint/no-explicit-any
  const r = await call(d, cap, { idempotencyKey: `wc-${cap}-${++n}`, ...input });
  assert.equal(r.status, 200, `${cap}: ${JSON.stringify(r.data)}`);
  return r.data;
};
const cardsOf = async (d: Daemon, threadId: string): Promise<{ lead: string; title: string; target?: { type: string; id: string } }[]> => {
  const msgs = (await call(d, "chat.messages.list", { threadId })).data.messages as Array<{ kind: string; author?: { kind?: string }; blocks?: { type: string; data: unknown }[] }>;
  return msgs.filter((m) => m.author?.kind === "agent").flatMap((m) => (m.blocks ?? []).flatMap((b) => { const c = linkCardOf(b); return c ? [c] : []; }));
};

test("work cards live: a record the agent makes is a card under its reply that names it and points at it", async () => {
  const d = await boot(seededDir());
  try {
    await connect(d);
    const agent = await newAgent(d, "Worker");
    const threadId = (await ok(d, "chat.start", { kind: "chat", agentIds: [agent.id] })).thread.threadId as string;
    await ok(d, "threads.set_mode", { threadId, mode: "auto" });
    await ok(d, "chat.post", { threadId, body: `TOOL records_create ${JSON.stringify({ type: "contact", fields: { name: "Dana Fox" }, idempotencyKey: "wc-rec" })}`, mentions: [{ kind: "agent", id: agent.id }] });
    const cards = await waitFor(async () => { await d.hooks?.pump?.(); const c = await cardsOf(d, threadId); return c.length ? c : null; }, 40_000, () => hostLog(d));
    assert.equal(cards[0]!.lead, "Record");
    assert.equal(cards[0]!.title, "Dana Fox");
    assert.equal(cards[0]!.target!.type, "record");
    // the card points at a record the person can read
    assert.equal((await call(d, "records.get", { type: "contact", recordId: cards[0]!.target!.id })).status, 200);

    // a Flow the agent runs is a Run card pointing at the Run
    const flow = (await ok(d, "automations.create", { name: "Lead sweep", definition: { triggers: [{ key: "manual" }], nodes: [{ id: "t", key: "create_task", title: "Call the lead", input: { title: "Call the lead", assigned: { kind: "person", id: "usr_olivia" } } }] } })).automation.id as string;
    await ok(d, "automations.set_enabled", { automationId: flow, enabled: true });
    await ok(d, "chat.post", { threadId, body: `TOOL automations_run ${JSON.stringify({ automationId: flow, idempotencyKey: "wc-run" })}`, mentions: [{ kind: "agent", id: agent.id }] });
    const run = await waitFor(async () => { await d.hooks?.pump?.(); return (await cardsOf(d, threadId)).find((c) => c.lead === "Run") ?? null; }, 40_000, () => hostLog(d));
    assert.equal(run.target!.type, "run");
    assert.equal((await call(d, "runs.get", { runId: run.target!.id })).status, 200, "the card points at a Run the person can read");
  } finally { await d.stop(); }
});
