// A turn that is stopped says why (owner, 4 Nov 2026): the cancelled event carries the reason, never a bare "Stopped.".
import test from "node:test";
import assert from "node:assert/strict";
import { createTurnEngine, scriptedProvider } from "../src/turn-engine/index.ts";

const person = { kind: "person" as const, id: "dana" };
async function slow() {
  let release: () => void = () => undefined;
  const gate = new Promise<void>((r) => { release = r; });
  const p = scriptedProvider({ script: [{ type: "text", text: "working" }, { type: "done" }], beforeEvent: async (i) => { if (i === 0) await Promise.race([gate, new Promise((r) => setTimeout(r, 400))]); } });
  const engine = createTurnEngine({ holder: "host:s", openSession: p.openSession });
  engine.openThread({ id: "T", kind: "chat", starter: "dana", agents: [{ id: "a", mode: "lead" }] });
  return { engine, release };
}
const reasons = (engine: Awaited<ReturnType<typeof slow>>["engine"]): Array<string | undefined> => engine.events("T").filter((e) => e.type === "turn.cancelled").map((e) => (e as { reason?: string }).reason);

test("Stop gives the reason stop; a new message that interrupts gives interrupt; a limit gives limit", async () => {
  { const { engine } = await slow();
    engine.receive({ threadId: "T", author: person, mentions: [], body: "go" });
    await new Promise((r) => setTimeout(r, 50));
    await engine.stop("T", { agentId: "a" });
    await engine.idle("T");
    assert.deepEqual(reasons(engine), ["stop"]); }
  { const { engine } = await slow();
    engine.receive({ threadId: "T", author: person, mentions: [], body: "go" });
    await new Promise((r) => setTimeout(r, 50));
    engine.receive({ threadId: "T", author: person, mentions: [], body: "actually, this instead" }, { interrupt: true });
    await engine.idle("T");
    assert.deepEqual(reasons(engine).slice(0, 1), ["interrupt"]); }
  { const { engine } = await slow();
    engine.receive({ threadId: "T", author: person, mentions: [], body: "go" });
    await new Promise((r) => setTimeout(r, 50));
    await engine.stop("T", { agentId: "a", reason: "limit" });
    await engine.idle("T");
    assert.deepEqual(reasons(engine), ["limit"]); }
});
