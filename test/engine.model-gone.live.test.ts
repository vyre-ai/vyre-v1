// The owner's rc.20 bug (Beam Free): a model the engine says is not there. On a booted Team server with the member-key kit, a session that refuses one model the way Claude Code words it:
//   the turn runs again at once on another model, with no error card and one quiet line that names both models and no id or CLI advice
//   the refused model leaves her list, and her last pick is the model that answered, so a new chat does not fail again
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import type { DriverEvent, EngineSession, OpenSession } from "../agent/src/turn-engine/types.ts";
import { boot, hostLog, seededDir, waitFor } from "./memory-live-kit.ts";
import { api, connectClaude, door, join, ok } from "./member-key-kit.ts";
import { fakeSpaceKey, setSpaceKey } from "./support/space-key-endpoint.ts";

const GONE = "There's an issue with the selected model (beam-free). It may not exist or you may not have access to it. Run --model to pick a different model.";
const refusing: OpenSession = async (spec) => {
  const model = spec.agent.model;
  return {
    warm: true,
    async *send(): AsyncGenerator<DriverEvent> {
      if (model === "beam-free") { yield { type: "error", code: "engine.model_unavailable", message: GONE }; return; }
      yield { type: "text", text: `answered on ${model ?? "the default"}` };
      yield { type: "done" };
    },
    sendToolResult() {}, inject() {}, async cancel() {}, async close() {},
  } as EngineSession;
};

test("a refused model: the turn runs on the next one with one quiet line, the model leaves the list, the last pick moves", { timeout: 120_000 }, async () => {
  const stub = await fakeSpaceKey();
  const dir = seededDir();
  const d = await boot(dir, refusing, undefined, { vault: undefined } as unknown as NonNullable<Parameters<typeof boot>[3]>);
  try {
    await fetch(`${d.url}/local/vault/key/unlock`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${d.token}` }, body: JSON.stringify({ key: Buffer.alloc(32, 3).toString("base64") }) });
    await setSpaceKey(d, d.token, stub);
    const agentId = (await ok(d, d.token, "agents.create", { name: "Spark", role: "You help the team." })).agent.agentId as string;
    const rubab = await join(d, "rubab");
    assert.equal((await door(d, rubab.token, "unlock", rubab.personKey)).status, 204);
    await connectClaude(d, rubab.token, "Rubab_Claude");

    const threadId = (await ok(d, rubab.token, "chat.start", { kind: "chat", agentIds: [agentId] })).thread.threadId as string;
    await ok(d, rubab.token, "engine.set_model", { threadId, agentId, model: "beam-free", provider: "claude-code", idempotencyKey: "mg-1" });
    await ok(d, rubab.token, "chat.post", { threadId, body: "Hey!!!", mentions: [{ kind: "agent", id: agentId }] });
    const seen = async () => {
      await d.hooks?.pump?.();
      const ms = ((await api(d, rubab.token, "chat.messages.list", { threadId })).data.messages ?? []) as Array<{ author?: { kind?: string }; body?: string; blocks?: Array<{ type?: string; data?: { state?: string; text?: string; code?: string } }> }>;
      const blocks = ms.flatMap((m) => m.blocks ?? []).filter((b) => b.type === "turn_status").map((b) => b.data ?? {});
      return { reply: ms.find((m) => m.author?.kind === "agent" && (m.body ?? "") !== "")?.body, notes: blocks.filter((b) => b.state === "note").map((b) => b.text), errors: blocks.filter((b) => b.code !== undefined) };
    };
    const got = await waitFor(async () => { const s = await seen(); return s.reply ? s : null; }, 60_000, () => hostLog(d));
    assert.match(String(got.reply), /^answered on /);
    assert.doesNotMatch(String(got.reply), /beam-free/);
    assert.deepEqual(got.errors, [], "no error card");
    assert.equal(got.notes.length, 1);
    assert.match(String(got.notes[0]), /^Beam Free isn't available right now, so .+ answered\. It's off your list until it works again\.$/);
    assert.doesNotMatch(String(got.notes[0]), /--model|—|engine\./);

    // the refused model is off her list, and a new chat starts on the model that answered
    const list = (await ok(d, rubab.token, "engine.models.list", {})).models as Array<{ model: string }>;
    assert.equal(list.some((m) => m.model === "beam-free"), false);
    const picked = (await ok(d, rubab.token, "engine.usage.get", { threadId, agentId })).model as string;
    assert.notEqual(picked, "beam-free");
    const next = (await ok(d, rubab.token, "chat.start", { kind: "chat", agentIds: [agentId] })).thread.threadId as string;
    assert.equal(await waitFor(async () => { await d.hooks?.pump?.(); return ((await ok(d, rubab.token, "engine.usage.get", { threadId: next, agentId })).model as string | undefined) ?? null; }, 20_000, () => hostLog(d)), picked);
  } finally { await d.stop(); await stub.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});
