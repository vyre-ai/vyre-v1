// A session that goes quiet never leaves a turn running: past idleMs with no event and no tool, the turn ends failed with turn_timeout and the thread keeps working.
import test from "node:test";
import assert from "node:assert/strict";
import { createTurnEngine, scriptedProvider } from "../src/turn-engine/index.ts";
import type { EngineAgent, OpenThread } from "../src/turn-engine/index.ts";

const person = { kind: "person" as const, id: "dana" };
const agents = (): EngineAgent[] => [{ id: "intake", mode: "lead" }];
const thread = (): OpenThread => ({ id: "T", kind: "chat", starter: "dana", agents: agents() });

test("a session that never answers ends the turn as failed with turn_timeout", async () => {
  const p = scriptedProvider({ script: [{ type: "text", text: "Hi." }, { type: "done" }], beforeEvent: () => new Promise<void>(() => undefined) });
  let t = 0;
  const beats: Array<() => void> = [];
  const engine = createTurnEngine({ holder: "host:s", openSession: p.openSession, hr: () => t, idleMs: 1000, schedule: (fn) => { beats.push(fn); return () => undefined; } });
  const events: string[] = [];
  engine.subscribe((e) => events.push(e.type));
  engine.openThread(thread());
  engine.receive({ threadId: "T", author: person, body: "hello" });
  await new Promise((r) => setTimeout(r, 20));
  t = 5000;
  for (const b of beats) b();
  await engine.idle("T");
  assert.deepEqual(engine.turns("T").map((x) => [x.state, x.error?.code]), [["failed", "turn_timeout"]]);
  assert.ok(events.includes("turn.failed"));
  assert.equal(p.sessions[0]?.closed, true);
});

test("a session that keeps talking is not timed out", async () => {
  const p = scriptedProvider({ script: [{ type: "text", text: "Hi." }, { type: "done" }] });
  let t = 0;
  const beats: Array<() => void> = [];
  const engine = createTurnEngine({ holder: "host:s", openSession: p.openSession, hr: () => t, idleMs: 1000, schedule: (fn) => { beats.push(fn); return () => undefined; } });
  engine.openThread(thread());
  engine.receive({ threadId: "T", author: person, body: "hello" });
  await engine.idle("T");
  assert.deepEqual(engine.turns("T").map((x) => x.state), ["completed"]);
});
