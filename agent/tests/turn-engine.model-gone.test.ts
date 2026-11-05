// A model the engine says is not there (engine.model_unavailable) before the turn said anything: the host picks another model and the turn runs again at once; nothing left ends the turn with its own code.
import test from "node:test";
import assert from "node:assert/strict";
import { createTurnEngine, scriptedProvider } from "../src/turn-engine/index.ts";
import type { OpenThread, ResolvedAccount } from "../src/turn-engine/index.ts";
import { classifyCli, goneModel, plainCli } from "../src/drivers/cli/errors.ts";

const person = { kind: "person" as const, id: "dana" };
const thread = (): OpenThread => ({ id: "T", kind: "chat", starter: "dana", agents: [{ id: "intake", mode: "lead" }] });
const account = (over: Partial<ResolvedAccount> = {}): ResolvedAccount => ({ ref: "#A", driver: "anthropic", provider: "anthropic", kind: "api_key", payer: "dana", reason: "starter", itemId: "vit_1", ...over });
const say = [{ type: "text" as const, text: "Hi." }, { type: "usage" as const, inputTokens: 10, outputTokens: 4 }, { type: "done" as const }];
const CLI_WORDS = "There's an issue with the selected model (beam-free). It may not exist or you may not have access to it. Run --model to pick a different model.";

test("the CLI's own words for a model it will not run are engine.model_unavailable, and its usage line never reaches a person", () => {
  assert.equal(classifyCli(CLI_WORDS), "engine.model_unavailable");
  assert.equal(goneModel(CLI_WORDS), "beam-free");
  assert.equal(classifyCli("boom"), "engine.cli_error");
  assert.equal(classifyCli("rate limit reached"), "provider.rate_limited");
  assert.doesNotMatch(plainCli(CLI_WORDS), /--model|Run /);
  assert.match(plainCli(CLI_WORDS), /may not exist/);
  assert.equal(plainCli("Run --model"), "Run --model", "nothing else to say keeps the words");
});

test("a model that is not there moves the turn to the model the host picks, with no error and one model switch", async () => {
  let runs = 0;
  const p = scriptedProvider({ script: () => (runs++ === 0 ? [{ type: "error" as const, code: "engine.model_unavailable", message: CLI_WORDS }] : say) });
  const asked: Array<{ message: string; account: string }> = [];
  const engine = createTurnEngine({
    holder: "host:s", openSession: p.openSession, resolveAccount: async () => account(),
    nextModel: async (q) => { asked.push({ message: q.message, account: q.account.ref }); return account({ ref: "#B" }); },
  });
  engine.openThread(thread());
  engine.receive({ threadId: "T", author: person, body: "Hey!!!" });
  await engine.idle("T");
  assert.deepEqual(p.specs.map((s) => s.account?.ref), ["#A", "#B"]);
  assert.equal(asked.length, 1);
  assert.deepEqual(engine.turns("T").map((t) => [t.state, t.error?.code]), [["completed", undefined]]);
  assert.equal(p.sessions.filter((s) => !s.closed).length, 0);
});

test("nothing works: the host's own code ends the turn; without a host hook, or after output, the turn fails as before", async () => {
  const gone = [{ type: "error" as const, code: "engine.model_unavailable", message: CLI_WORDS }];
  const p = scriptedProvider({ script: () => gone });
  const e1 = createTurnEngine({ holder: "host:s", openSession: p.openSession, resolveAccount: async () => account(), nextModel: async () => { throw Object.assign(new Error("None of your AI accounts can answer right now."), { code: "engine.no_model_works" }); } });
  e1.openThread(thread());
  e1.receive({ threadId: "T", author: person, body: "x" });
  await e1.idle("T");
  assert.deepEqual(e1.turns("T").map((t) => [t.state, t.error?.code]), [["failed", "engine.no_model_works"]]);

  const q = scriptedProvider({ script: () => gone });
  const e2 = createTurnEngine({ holder: "host:s", openSession: q.openSession, resolveAccount: async () => account() });
  e2.openThread(thread());
  e2.receive({ threadId: "T", author: person, body: "x" });
  await e2.idle("T");
  assert.deepEqual(e2.turns("T").map((t) => [t.state, t.error?.code]), [["failed", "engine.model_unavailable"]]);

  const r = scriptedProvider({ script: () => [{ type: "text" as const, text: "Half" }, ...gone] });
  const e3 = createTurnEngine({ holder: "host:s", openSession: r.openSession, resolveAccount: async () => account(), nextModel: async () => account({ ref: "#Z" }) });
  e3.openThread(thread());
  e3.receive({ threadId: "T", author: person, body: "x" });
  await e3.idle("T");
  assert.equal(r.sessions.length, 1, "no repeat after output");
});

test("the CLI's own words map to a reason a person can read: network, an engine that cannot run here, a sign-in", () => {
  assert.equal(classifyCli("Error: getaddrinfo ENOTFOUND api.anthropic.com"), "provider.network");
  assert.equal(classifyCli("workspace routing discovery failed"), "engine.cli_unusable");
  assert.equal(classifyCli("Please run /login"), "provider.auth_failed");
  assert.equal(classifyCli("usage limit reached"), "provider.rate_limited");
  assert.equal(classifyCli("something unknown"), "engine.cli_error");
});
