// Model "Auto" never reaches a provider as an empty name (a fresh install's first "hello" got provider.bad_request, `model` must be a non-empty string): for each kind of account, with a good list, a stale
// saved list, an empty catalog and a refresh that failed, the turn opens on a concrete model of that account, or ends with a plain "Pick a model for <account>" before anything is sent.
import test from "node:test";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { PINNED_MODEL, chooseAuto, isAuto, withConcreteModel, NO_MODEL_PICKED } from "../auto-model.ts";
import type { OpenSession, SessionSpec } from "../../../agent/src/turn-engine/types.ts";

const ACCOUNTS = [
  { label: "an OpenAI key", driver: "openai", provider: "openai", list: ["gpt-5", "gpt-6"], pinned: undefined },
  { label: "Codex on an API key", driver: "codex", provider: "openai", list: ["gpt-6.1-sol"], cli: true },
  { label: "an Anthropic key", driver: "anthropic", provider: "anthropic", list: ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"], pinned: PINNED_MODEL["anthropic"] },
  { label: "Claude Code", driver: "claude_code", provider: "anthropic", list: ["claude-sonnet-5-5"], cli: true },
  { label: "OpenCode", driver: "opencode_go", provider: "opencode-go", list: ["glm-5.3", "kimi-k3"], pinned: PINNED_MODEL["opencode_go"] },
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
    for (const [what, models] of [["a saved list that names nothing usable", async () => ["auto", "  "]], ["an empty catalog", async () => []], ["a refresh that failed", async () => { throw new Error("Couldn't refresh"); }]] as const) {
      const run = seen();
      const go = withConcreteModel(run.open, { models })(spec(a.driver, what === "an empty catalog" ? "" : "auto"));
      if (a.pinned === undefined) {
        await assert.rejects(go, (e: { code?: string; message?: string }) => e.code === NO_MODEL_PICKED && e.message === "Pick a model for My account.", `${what}: no model is guessed, the person is asked`);
        assert.deepEqual(run.models, [], "nothing was opened, so nothing was sent");
      } else {
        await go;
        assert.equal(run.models[0], a.pinned, `${what}: the pinned model, from the shipped catalog`);
      }
    }
    assert.ok(typeof good.models[0] === "string" && good.models[0].trim() !== "", "never empty");
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
  // pins come only from the catalogs this release ships; no provider is given a name from memory
  assert.deepEqual(Object.keys(PINNED_MODEL).sort(), ["anthropic", "opencode_go"]);
  assert.equal(PINNED_MODEL["anthropic"], "claude-sonnet-5-5", "Anthropic's everyday model by id, not the dearest");
  const prices = JSON.parse(readFileSync(new URL("../prices.json", import.meta.url), "utf8")) as { providers: { anthropic: Record<string, unknown> } };
  assert.ok(Object.keys(prices.providers.anthropic).includes(PINNED_MODEL["anthropic"]!), `Anthropic's pin is a model the prices table names: ${PINNED_MODEL["anthropic"]}`);
  assert.match(PINNED_MODEL["opencode_go"]!, /^glm-/, "OpenCode Go's from its provider entry");
  for (const d of ["openai", "xai", "google", "openrouter", "custom", "local"]) assert.equal(PINNED_MODEL[d], undefined, `${d} has no pin`);
});
