// Live turn frames (chat streaming): the bridge's events leave the host as `turn` frames to the sockets whose person may read the thread, in order, and are never replayed or held for an ack.
// Two halves: the live hub's publishTurn on a real socket, and the engine host seam's `stream` with a fake invoke standing in for threads.get.
import test from "node:test";
import assert from "node:assert/strict";
import { createLiveHub } from "../src/ws.ts";
import { createEngineHost } from "../src/seams/engine.ts";
import type { PublishTurn } from "../src/seams/engine.ts";
import type { Invoke } from "../src/invoke.ts";
import { fail } from "../src/routes/errors.ts";

const SPACE = "spc_1";

async function connect(port: number, token: string) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/sync/v1/ws?token=${token}&device=${token}-dev`);
  const queue: Record<string, unknown>[] = [];
  const waiting: Array<(f: Record<string, unknown>) => void> = [];
  ws.addEventListener("message", (m) => { const f = JSON.parse(String(m.data)) as Record<string, unknown>; const w = waiting.shift(); if (w) w(f); else queue.push(f); });
  await new Promise<void>((resolve, reject) => { ws.addEventListener("open", () => resolve()); ws.addEventListener("error", () => reject(new Error("could not connect"))); });
  ws.send(JSON.stringify({ t: "hello", cursor: 0 }));
  const next = (ms = 1500): Promise<Record<string, unknown>> => new Promise((resolve, reject) => {
    const q = queue.shift();
    if (q) { resolve(q); return; }
    const t = setTimeout(() => reject(new Error("no frame")), ms);
    waiting.push((f) => { clearTimeout(t); resolve(f); });
  });
  await next();   // hello_ok
  return { next, close: () => ws.close() };
}

test("a turn frame reaches only the sockets whose person is allowed, in the order published", async () => {
  const hub = createLiveHub({ session: (_h, url) => { const t = url.searchParams.get("token"); return t ? { space: SPACE, principal: { kind: "person", id: `usr_${t}` }, device: `${t}-dev` } : null; } });
  const port = await hub.listen();
  try {
    const dana = await connect(port, "dana");
    const eli = await connect(port, "eli");
    const frame = (n: number) => ({ t: "turn" as const, turn: "trn_1", delta: { kind: "delta", threadId: "thr_a", text: `piece ${n}` } });
    // the check for the first frame is slow, the next ones are instant: order must still hold
    hub.publishTurn(frame(1), async (p) => { await new Promise((r) => setTimeout(r, 40)); return p === "usr_dana"; });
    hub.publishTurn(frame(2), (p) => p === "usr_dana");
    const a = await dana.next(), b = await dana.next();
    assert.deepEqual([a["t"], (a["delta"] as { text: string }).text, (b["delta"] as { text: string }).text], ["turn", "piece 1", "piece 2"]);
    await assert.rejects(eli.next(150), /no frame/, "a person who may not read the thread hears nothing of it");
    dana.close(); eli.close();
  } finally { await hub.close(); }
});

test("a check that throws means no frame, and never breaks the ones after it", async () => {
  const hub = createLiveHub({ session: () => ({ space: SPACE, principal: { kind: "person", id: "usr_dana" }, device: "d1" }) });
  const port = await hub.listen();
  try {
    const dana = await connect(port, "dana");
    hub.publishTurn({ t: "turn", turn: "trn_1", delta: { kind: "start" } }, () => { throw new Error("boom"); });
    hub.publishTurn({ t: "turn", turn: "trn_1", delta: { kind: "end" } }, () => true);
    assert.equal((await dana.next())["t"], "turn");
    dana.close();
  } finally { await hub.close(); }
});

function seam() {
  const published: Array<{ frame: Parameters<PublishTurn>[0]; allow: Parameters<PublishTurn>[1] }> = [];
  const asked: Array<{ cap: string; as: string | undefined }> = [];
  const invoke: Invoke = async (cap, _input, seed) => {
    asked.push({ cap, as: seed.principal.id });
    if (seed.principal.id === "usr_out") return fail("permission.no_grant" as never, "c".repeat(32));
    return { status: "ok", output: {}, traceId: "c".repeat(32) } as never;
  };
  const host = createEngineHost({ space: SPACE, invoke, publishTurn: () => (frame, allow) => { published.push({ frame, allow }); } });
  return { host, published, asked };
}

test("the engine host turns a bridge event into a turn frame whose audience is whoever may read the thread", async () => {
  const s = seam();
  s.host.stream?.({ kind: "delta", threadId: "thr_a", turnId: "trn_9", agentId: "agt_x", text: "Hi" });
  assert.equal(s.published.length, 1);
  assert.deepEqual(s.published[0]?.frame, { t: "turn", turn: "trn_9", delta: { kind: "delta", threadId: "thr_a", agentId: "agt_x", text: "Hi" } });
  const allow = s.published[0]!.allow;
  assert.equal(await allow("usr_in"), true);
  assert.equal(await allow("usr_out"), false, "a person refused by threads.get is not in the audience");
  assert.deepEqual(s.asked.map((a) => a.cap), ["threads.get", "threads.get"]);
});

test("the audience check is kept a minute: a stream of deltas asks once per person", async () => {
  const s = seam();
  for (let i = 0; i < 5; i++) s.host.stream?.({ kind: "delta", threadId: "thr_a", turnId: "trn_9", agentId: "agt_x", text: String(i) });
  for (const p of s.published) await p.allow("usr_in");
  assert.equal(s.asked.length, 1);
});

test("with no live socket yet, a turn event is dropped and nothing throws", () => {
  const host = createEngineHost({ space: SPACE, invoke: (async () => ({ status: "ok", output: {}, traceId: "c".repeat(32) })) as never, publishTurn: () => null });
  assert.doesNotThrow(() => host.stream?.({ kind: "start", threadId: "thr_a", turnId: "trn_9", agentId: "agt_x", asker: "usr_in" }));
});
