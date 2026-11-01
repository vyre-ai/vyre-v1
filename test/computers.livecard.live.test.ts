// The live card on a booted daemon (rc.9 flow 13): an agent works on its computer for a chat, and the chat gets one screenshot block marked live, pointing at a frame kept in Files; a second step adds none.
// The computer is the module's scripted machine (no Docker); the chat, the engine, the agent's tool path and Files are live. The Docker proof of the same machine is host/tests/computers.live.test.ts.
import test from "node:test";
import assert from "node:assert/strict";
import { boot, call, connect, newAgent, seededDir, waitFor } from "./memory-live-kit.ts";
import { bindHost } from "../modules/computers/projections.ts";
import type { ComputerHost } from "../modules/computers/projections.ts";
import { fakeHost } from "../modules/computers/fixtures/fake-host.ts";

const PNG = "iVBORw0KGgo=";
let keys = 0;
const ok = async (d: Awaited<ReturnType<typeof boot>>, cap: string, input: Record<string, unknown>): Promise<any> => {   // eslint-disable-line @typescript-eslint/no-explicit-any
  const r = await call(d, cap, { idempotencyKey: `lc-${cap}-${++keys}`, ...input });
  assert.equal(r.status, 200, `${cap}: ${JSON.stringify(r.data)}`);
  return r.data;
};

test("computers live: the first step an agent takes for a chat leaves one live card in it", async () => {
  const d = await boot(seededDir());
  try {
    await connect(d);
    const fake = fakeHost();
    const host = { ...fake.host, async tool() { return { ok: true, frame: PNG }; } } as unknown as ComputerHost;
    bindHost(host);
    const agent = await newAgent(d, "Desk");
    const computerId = (await ok(d, "computers.provision", { agentId: agent.id })).computer.computerId as string;
    await ok(d, "computers.wake", { computerId });
    const threadId = (await ok(d, "chat.start", { kind: "chat", agentIds: [agent.id] })).thread.threadId as string;
    await ok(d, "threads.set_mode", { threadId, mode: "auto" });
    const step = (n: number) => ok(d, "chat.post", { threadId, body: `TOOL screen_click ${JSON.stringify({ computerId, x: 10 + n, y: 10 })}`, mentions: [{ kind: "agent", id: agent.id }] });
    const cards = async () => ((await call(d, "chat.messages.list", { threadId })).data.messages as Array<{ blocks?: Array<{ type: string; data: Record<string, unknown> }> }>).flatMap((m) => m.blocks ?? []).filter((b) => b.type === "screenshot" && b.data["live"] === true);
    await step(1);
    const first = await waitFor(async () => { await d.hooks?.pump?.(); const c = await cards(); return c.length > 0 ? c : null; });
    assert.equal(first.length, 1);
    assert.equal(first[0]!.data["computerId"], computerId);
    assert.ok(typeof first[0]!.data["fileId"] === "string" && (first[0]!.data["fileId"] as string).length > 0, "it points at a frame kept in Files");
    await step(2);
    await new Promise<void>((r) => setTimeout(r, 1500));
    await d.hooks?.pump?.();
    assert.equal((await cards()).length, 1, "the second step adds no card");
  } finally { await d.stop(); bindHost(null); }
});
