// Memory learns after every turn (owner ruling 3 Nov 2026): a completed turn hands the chat to memory.capture once, as the asker, with the account the turn ran on; a routine's turn or a
// failed one hands nothing; and the reply is never held for it: the turn is done, and the next one answers, while the learning pass is still running. The timings are measured and printed.
// @reads /modules/engine/migrations/0001_init.sql
import test from "node:test";
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { handlers, hostSeams } from "../impl.ts";
import { ensureRuntime } from "../runtime.ts";
import { learnInput } from "../learn.ts";
import { harness } from "../fixtures/harness.ts";
import { scriptedProvider } from "../../../agent/src/turn-engine/scripted-session.ts";
import type { DriverEvent, TurnRow } from "../../../agent/src/turn-engine/types.ts";
import type { EngineHostSeam } from "../runtime.ts";

const THREAD = "thr_learnturn";
const THREADS = [{ threadId: THREAD, kind: "chat", starter: "usr_dana", agents: [{ agentId: "agt_intake", mode: "lead" as const }] }];
const say: DriverEvent[] = [{ type: "text", text: "Done." }, { type: "usage", inputTokens: 10, outputTokens: 4 }, { type: "done" }];

interface Seen { learn: Array<{ input: Record<string, unknown>; as: string | undefined; at: number }>; release: () => void; gate: Promise<void> }
function hostFor(p: ReturnType<typeof scriptedProvider>, seen: Seen, learnMs: number | "held"): EngineHostSeam {
  return {
    holder: "host:spc_learntest", openSession: p.openSession, now: () => 1_760_000_000_000,
    async call(cap, input, as) {
      if (cap === "engine.account.resolve") return { accountRef: "#Dana_Claude", payer: "usr_dana", reason: "starter", allowed: true, itemId: "vit_aaaaaaaaaaaa" };
      if (cap === "engine.accounts.list") return { accounts: [{ ref: "#Dana_Claude", driver: "claude_code", kind: "subscription", status: "ok" }] };
      if (cap === "engine.turn.record_usage" || cap === "engine.turn.record") return {};
      if (cap === "memory.capture") {
        seen.learn.push({ input: input as Record<string, unknown>, as, at: performance.now() });
        // a slow pass: a model on the other side of the world, or one held until the test lets it go
        if (learnMs === "held") await seen.gate; else await new Promise((r) => setTimeout(r, learnMs));
        return { proposed: 1, merged: 1, via: "model" };
      }
      throw new Error(`unexpected ${cap}`);
    },
  };
}
const fresh = (): Seen => { let release = (): void => {}; const gate = new Promise<void>((r) => { release = r; }); return { learn: [], release, gate }; };

async function oneTurn(learnMs: number | "held", seen = fresh()) {
  const h = harness({ threads: THREADS });
  const p = scriptedProvider({ script: say });
  hostSeams.setEngineHost(hostFor(p, seen, learnMs));
  const engine = (await ensureRuntime(h.ctx))!;
  await (handlers["engine.stop"]!(h.ctx as never, { threadId: THREAD } as never) as Promise<unknown>).catch(() => undefined);
  let doneAt = 0;
  engine.subscribe((e) => { if (e.type === "turn.completed") doneAt = performance.now(); });
  const t0 = performance.now();
  engine.receive({ threadId: THREAD, author: { kind: "person", id: "usr_dana" }, body: "I prefer short answers." });
  await engine.idle(THREAD);
  const idleAt = performance.now();
  return { h, p, engine, seen, t0, doneAt, idleAt };
}

test("a completed turn hands the chat to memory once, as the asker, with the account the turn ran on", async () => {
  const r = await oneTurn(0);
  await new Promise((done) => setTimeout(done, 20));
  assert.equal(r.seen.learn.length, 1);
  assert.equal(r.seen.learn[0]!.as, "usr_dana");
  assert.deepEqual(r.seen.learn[0]!.input, {
    threadId: THREAD, reason: "turn", turnId: r.seen.learn[0]!.input["turnId"], agentId: "agt_intake",
    account: { ref: "#Dana_Claude", driver: "claude_code", kind: "subscription", payer: "usr_dana" },
  });
  hostSeams.setEngineHost(null);
});

test("a routine's turn, a failed turn and a turn with no person teach nothing", () => {
  const base: TurnRow = {
    id: "trn_1", threadId: THREAD, agentId: "agt_intake", asker: "usr_dana", payerReason: "starter", model: null, state: "completed", traceId: "0".repeat(32), qseq: 1, kind: "message" as TurnRow["kind"],
    routine: false, startedAt: 0, endedAt: 1, tokensIn: 0, tokensOut: 0, error: null, firstTokenOverheadMs: null, injected: 0,
  };
  assert.ok(learnInput(base, null));
  assert.equal(learnInput({ ...base, routine: true }, null), null);
  assert.equal(learnInput({ ...base, state: "failed" }, null), null);
  assert.equal(learnInput({ ...base, asker: "agt_other" }, null), null);
  assert.equal((learnInput(base, null) as Record<string, unknown>)["account"], undefined, "no account: memory learns by rules");
});

test("the reply is never held for learning: the turn completes and the chat goes idle while a slow pass still runs", async () => {
  // baseline: learning answers at once
  const quick = await oneTurn(0);
  hostSeams.setEngineHost(null);
  // a pass held open until the end of the test
  const held = await oneTurn("held");
  const learnStarted = held.seen.learn.length;
  const pending = held.seen.learn.length <= 1;
  const doneMs = held.doneAt - held.t0;
  const idleMs = held.idleAt - held.t0;
  const quickIdle = quick.idleAt - quick.t0;
  // a second message answers while the first pass is still held
  const t1 = performance.now();
  held.engine.receive({ threadId: THREAD, author: { kind: "person", id: "usr_dana" }, body: "And send it to Priya." });
  await held.engine.idle(THREAD);
  const secondMs = performance.now() - t1;
  console.log(`reply timings (ms): turn done ${doneMs.toFixed(2)}, idle ${idleMs.toFixed(2)} with the pass held; idle ${quickIdle.toFixed(2)} with an instant pass; next turn ${secondMs.toFixed(2)} while the first pass is still held`);
  assert.ok(pending, "the pass had not finished");
  assert.ok(held.doneAt > 0 && doneMs < 250, `the turn completed in ${doneMs.toFixed(1)} ms with learning held`);
  assert.ok(idleMs < quickIdle + 100, `held ${idleMs.toFixed(1)} ms vs instant ${quickIdle.toFixed(1)} ms`);
  assert.ok(secondMs < 250, `the next turn answered in ${secondMs.toFixed(1)} ms`);
  await new Promise((done) => setTimeout(done, 10));
  assert.ok(learnStarted <= 1 && held.seen.learn.length === 2, "each turn handed over once");
  held.seen.release();
  hostSeams.setEngineHost(null);
});
