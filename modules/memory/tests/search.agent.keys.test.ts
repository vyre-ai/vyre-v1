// memory.search as an agent working for a person whose memory is sealed under their own key (Team server): key held, key gone, lessons and plain facts mixed, a fresh agent. Always an answer.
import { pagePut } from "../handlers/pages.ts";
import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { proposeFact, search } from "../handlers/facts.ts";
import { recordCorrection } from "../handlers/corrections.ts";
import { setMemoryKeyPort } from "../personal.ts";
import { asPerson, contractErrors, harness } from "../fixtures/harness.ts";

const KEY = crypto.randomBytes(32);
const held = new Map<string, Uint8Array>();
setMemoryKeyPort({ personKey: (p) => (held.has(p) ? Uint8Array.from(held.get(p)!) : null) });
test.after(() => setMemoryKeyPort(null));
const AGENT = "agt_dex";

for (const keyHeld of [true, false]) {
  for (const mode of ["keyword", "hybrid"] as const) {
    test(`the agent's search, person key ${keyHeld ? "held" : "gone"}, ${mode}: a fresh agent and one with a fact and lessons both answer`, async () => {
      held.set("usr_dana", KEY);
      const h = harness({ settings: {} });
      const asAgent = (): ReturnType<typeof harness> => harness({ raw: h.raw, clock: h.clock, principal: { kind: "agent", id: AGENT }, actingFor: "usr_dana" });
      if (!keyHeld) held.delete("usr_dana");
      const fresh = await search(asAgent().ctx, { q: "what do you remember", agentId: AGENT, mode });
      assert.deepEqual(contractErrors("memory.search", "out", fresh), []);
      held.set("usr_dana", KEY);
      const dana = asPerson(h, { kind: "person", id: "usr_dana" });
      await proposeFact(dana.ctx, { text: "Dana takes her coffee black with cardamom", agentId: AGENT, sourceKind: "manual", sourceRef: "typed" });
      await recordCorrection(dana.ctx, { agentId: AGENT, how: "refuse", was: "Send the invoice", note: "ask me first" });
      if (!keyHeld) held.delete("usr_dana");
      for (const input of [{ q: "coffee", agentId: AGENT, mode }, { q: "ask me first", mode }, { q: "memory", layers: ["person" as const], agentId: AGENT, mode }]) {
        const out = await search(asAgent().ctx, input);
        assert.deepEqual(contractErrors("memory.search", "out", out), [], JSON.stringify(out).slice(0, 300));
      }
      held.delete("usr_dana");
    });
  }
}


test("a personal page written while her key was held, searched after it is gone: an answer with the locked line, not an error", async () => {
  held.set("usr_dana", KEY);
  const h = harness({ settings: {} });
  const dana = asPerson(h, { kind: "person", id: "usr_dana" });
  await pagePut(dana.ctx, { title: "Dana travel plans", layer: "person", notes: "Dana flies to Karachi in March" });
  held.delete("usr_dana");
  for (const who of [{ kind: "person", id: "usr_dana" }, { kind: "agent", id: AGENT }]) {
    const c = harness({ raw: h.raw, clock: h.clock, principal: who, ...(who.kind === "agent" ? { actingFor: "usr_dana" } : {}) });
    for (const mode of ["keyword", "hybrid"] as const) {
      const out = await search(c.ctx, { q: "travel Karachi", mode });
      assert.deepEqual(contractErrors("memory.search", "out", out), []);
      assert.equal(out.hits.length, 0, "nothing personal while sealed");
    }
  }
});
