// Model "Auto" never reaches a provider as an empty name (a fresh install's first "hello" got provider.bad_request, `model` must be a non-empty string): for each kind of account, with a good list, a stale
// saved list, an empty catalog and a refresh that failed, the turn opens on a concrete model of that account, or ends with a plain "Pick a model for <account>" before anything is sent.
import test from "node:test";
import assert from "node:assert/strict";
import { PINNED_MODEL, chooseAuto, isAuto, withConcreteModel, NO_MODEL_PICKED } from "../auto-model.ts";
import type { OpenSession, SessionSpec } from "../../../agent/src/turn-engine/types.ts";

const ACCOUNTS = [
  { label: "an OpenAI key", driver: "openai", provider: "openai", list: ["gpt-5", "gpt-6"], pinned: "gpt-5" },
  { label: "Codex on an API key", driver: "codex", provider: "openai", list: ["gpt-6.1-sol"], cli: true },
  { label: "an Anthropic key", driver: "anthropic", provider: "anthropic", list: ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"], pinned: "claude-sonnet-5-5" },
  { label: "Claude Code", driver: "claude_code", provider: "anthropic", list: ["claude-sonnet-5-5"], cli: true },
  { label: "OpenCode", driver: "opencode_go", provider: "opencode-go", list: ["glm-5.3", "kimi-k3"], pinned: "glm-5.3" },
] as const;

const spec = (driver: string, model: string | undefined, name = "My account"): SessionSpec => ({
  threadId: "thr_1", turnId: "trn_1", traceId: "0".repeat(32), asker: "usr_a", agent: { id: "agt_1", mode: "lead", ...(model === undefined ? {} : { model }) },
  account: { ref: "#Acct", name, driver, provider: driver, kind: "api_key", payer: "usr_a", reason: "starter" },
} as unknown as SessionSpec);

const seen = (): { open: OpenSession; models: Array<string | undefined> } => {
  const models: Array<string | undefined> = [];
  return { models, open: (async (s: SessionSpec) => { models.push(s.agent.model); return {} as never; }) as OpenSession };
};

test("isAuto: nothing named, an empty name and the word itself are Auto; a model's name is not", () => {
  for (const m of [undefined, null, "", "  ", "auto", "Auto"]) assert.equal(isAuto(m as never), true, String(m));
  for (const m of ["gpt-5", "claude-sonnet-5-5"]) assert.equal(isAuto(m), false);
});

for (const a of ACCOUNTS) {
  const cli = "cli" in a && a.cli === true;
  test(`Auto on ${a.label}: ${cli ? "the engine keeps its own default, nothing is sent from here" : "a concrete model from a good list, a stale list, an empty catalog and a refresh that failed"}`, async () => {
    if (cli) {
      const s = seen();
      await withConcreteModel(s.open, { models: async () => { throw new Error("must not be asked for an engine with its own default"); } })(spec(a.driver, undefined));
      assert.deepEqual(s.models, [undefined], "a CLI engine is opened as it was");
      return;
    }
    const good = seen();
    await withConcreteModel(good.open, { models: async () => [...a.list] })(spec(a.driver, undefined));
    assert.ok(a.list.includes(good.models[0] as never), `a model the account lists: ${good.models[0]}`);
    const stale = seen();
    await withConcreteModel(stale.open, { models: async () => ["auto", "  "] })(spec(a.driver, "auto"));
    assert.equal(stale.models[0], a.pinned, "a saved list that names nothing usable: the provider's pinned model");
    const empty = seen();
    await withConcreteModel(empty.open, { models: async () => [] })(spec(a.driver, ""));
    assert.equal(empty.models[0], a.pinned, "an empty catalog: the pinned model");
    const failed = seen();
    await withConcreteModel(failed.open, { models: async () => { throw new Error("Couldn't refresh"); } })(spec(a.driver, undefined));
    assert.equal(failed.models[0], a.pinned, "a refresh that failed is the pinned model, never a failed turn");
    for (const m of [...good.models, ...stale.models, ...empty.models, ...failed.models]) assert.ok(typeof m === "string" && m.trim() !== "", "never empty");
  });
}

test("a model the person picked is left exactly as picked, on any account", async () => {
  const s = seen();
  await withConcreteModel(s.open, { models: async () => ["gpt-5"] })(spec("openai", "gpt-6"));
  assert.deepEqual(s.models, ["gpt-6"]);
});

test("Auto picks the standard tier first, so the cheapest or the most expensive model is not the default", () => {
  assert.equal(chooseAuto({ driver: "openai", provider: "openai" }, ["gpt-5-mini", "gpt-6", "gpt-5"]), "gpt-5");
  assert.equal(chooseAuto({ driver: "openai", provider: "openai" }, ["gpt-5-mini"]), "gpt-5-mini", "only a cheap one: that one");
});

test("an account nothing can choose a model for stops the turn before any request, in plain words naming the account", async () => {
  const s = seen();
  await assert.rejects(withConcreteModel(s.open, { models: async () => [] })(spec("custom", undefined, "Our local box")), (e: { code?: string; message?: string }) => e.code === NO_MODEL_PICKED && e.message === "Pick a model for Our local box.");
  assert.deepEqual(s.models, [], "nothing was opened, so nothing was sent");
  for (const d of ["openai", "anthropic", "opencode_go", "xai", "google", "openrouter"]) assert.ok(PINNED_MODEL[d], `${d} has a pinned model`);
});
