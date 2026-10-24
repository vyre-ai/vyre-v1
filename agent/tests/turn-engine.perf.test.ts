// Send budget (V1-SPEC Speed): first token = provider latency + under 150 ms of ours.
// The fake provider injects 200 ms before its first event. turn.first_token_overhead is the
// remainder, measured on the wall clock around that wait.
import test from "node:test";
import assert from "node:assert/strict";
import { fakeLlm } from "../../testkit/providers/llm.ts";
import { wallClock } from "../../testkit/providers/clock.ts";
import { createTurnEngine } from "../src/turn-engine/index.ts";
import type { TurnInput, TurnSession } from "../src/turn-engine/index.ts";

function sessionFromFake(latencyMs: number, send: TurnSession["send"]): TurnSession {
  return {
    driverId: "fake",
    latencyMs,
    send,
    inject() {},
    async cancel() {},
  };
}

test("turn.first_token_overhead stays under 150 ms when the fake provider waits 200 ms", async () => {
  const llm = fakeLlm({
    latencyMs: 200,
    clock: wallClock,
    script: [{ type: "text", text: "hello" }, { type: "done" }],
  });
  const engine = createTurnEngine({
    holder: "host:spc_perf",
    open: () => sessionFromFake(llm.latencyMs, async function* send(input: TurnInput) {
      for await (const ev of llm.stream({ model: input.model, messages: input.messages })) {
        if (ev.type === "text") yield { type: "text", text: ev.text };
        else if (ev.type === "thinking") yield { type: "thinking", text: ev.text };
        else if (ev.type === "tool_call") yield { type: "tool_call", id: ev.id, name: ev.name, input: ev.input };
        else if (ev.type === "usage") yield { type: "usage", inputTokens: ev.inputTokens, outputTokens: ev.outputTokens };
        else if (ev.type === "done") yield { type: "done" };
        else yield { type: "error", message: ev.message };
      }
    }),
  });
  engine.openThread({
    id: "thr",
    kind: "chat",
    starter: "dana",
    starterAccountRef: "#Dana_Key",
    agents: [{ id: "intake", mode: "lead", name: "Intake" }],
  });
  engine.receive({ threadId: "thr", author: { kind: "person", id: "dana" }, body: "hi" });
  await engine.drain("thr");
  const turn = engine.turns("thr")[0];
  const overhead = turn?.firstTokenOverheadMs;
  assert.equal(turn?.state, "completed");
  assert.equal(turn?.blocks[0]?.text, "hello");
  if (overhead === null || overhead === undefined) throw new Error("missing turn.first_token_overhead");
  assert.ok(overhead < 150 && overhead > -50, `turn.first_token_overhead ${overhead} ms, budget 150, provider ${llm.latencyMs}`);
  console.log(`turn.first_token_overhead ${overhead.toFixed(1)} ms (budget 150, provider ${llm.latencyMs})`);
});
