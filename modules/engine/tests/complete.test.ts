// engine.complete: one request on an account through the engine's session opener. Only a module's own nested call may make it; a person or an agent arriving at depth 0 is refused.
import test from "node:test";
import assert from "node:assert/strict";
import { handlers, hostSeams } from "../impl.ts";
import { ensureRuntime } from "../runtime.ts";
import { bindEngine } from "../projections.ts";
import { codeOf, contractErrors, harness } from "../fixtures/harness.ts";
import { scriptedProvider } from "../../../agent/src/turn-engine/scripted-session.ts";
import type { DriverEvent } from "../../../agent/src/turn-engine/types.ts";

const script: DriverEvent[] = [{ type: "text", text: '{"actions":[]}' }, { type: "usage", inputTokens: 321, outputTokens: 12 }, { type: "done" }];
const complete = handlers["engine.complete"] as unknown as (ctx: unknown, input: unknown) => Promise<{ text: string; tokensIn: number; tokensOut: number }>;

function withProviders(h: ReturnType<typeof harness>, depth: number, principal?: { kind: string; id: string }) {
  return {
    ...h.ctx, depth, ...(principal ? { principal } : {}),
    async call(cap: string, input: unknown) {
      if (cap === "providers.list") return { providers: [{ id: "prv_1", providerKey: "anthropic", name: "Team key", connection: "api_key", scope: "shared", handle: "#Team_Key", itemId: "vit_aaaaaaaaaaaa", engine: "anthropic", spaceMayUse: true, state: "ok" }] };
      return h.ctx.call(cap as never, input);
    },
  };
}

test("only a nested call may run it: a person and an agent at depth 0 are refused, a module's own call runs the request on the account and reports the tokens", async () => {
  bindEngine(null);
  const h = harness();
  const seen: string[] = [];
  const p = scriptedProvider({ script });
  hostSeams.setEngineHost({ holder: "host:spc_enginetest", openSession: async (spec) => { seen.push(`${spec.account?.ref}|${spec.agent.id}|${spec.agent.role}`); return p.openSession(spec); }, now: () => 1_760_000_000_000, async call() { throw new Error("unexpected"); } });
  try {
    for (const who of [{ kind: "person", id: "usr_dana" }, { kind: "agent", id: "agt_intake" }]) {
      await assert.rejects(() => complete(withProviders(h, 0, who), { accountRef: "#Team_Key", prompt: "Tasks: patterns." }), (e) => codeOf(e) === "permission.no_grant");
    }
    assert.equal(seen.length, 0, "no session was opened for a refused call");
    const out = await complete(withProviders(h, 1), { accountRef: "#Team_Key", prompt: "Tasks: patterns.", system: "You tidy memory." });
    assert.deepEqual(out, { text: '{"actions":[]}', tokensIn: 321, tokensOut: 12 });
    assert.deepEqual(contractErrors("engine.complete", "out", out), []);
    assert.deepEqual(seen, ["#Team_Key|memory-upkeep|You tidy memory."]);
    await assert.rejects(() => complete(withProviders(h, 1), { accountRef: "#Nope", prompt: "x" }), (e) => codeOf(e) === "validation.not_found");
  } finally { hostSeams.setEngineHost(null); }
  assert.ok(await ensureRuntime(h.ctx) === null);
});
