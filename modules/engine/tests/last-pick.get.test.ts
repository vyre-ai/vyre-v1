// engine.last_pick.get: Settings > Your AI shows the model the person last picked in a chat, from the store a new chat starts on. Nothing until they pick; their own pick only.
import test from "node:test";
import assert from "node:assert/strict";
import { lastPickGet } from "../handlers/control.ts";
import { defaultsSet } from "../handlers/extra/config.ts";
import { rememberPick } from "../last-pick.ts";
import { contractErrors, harness } from "../fixtures/harness.ts";

test("nothing before a pick, then the last model they picked in any chat, and never someone else's", async () => {
  const h = harness();
  assert.deepEqual(await lastPickGet(h.ctx), {}, "nothing picked yet");
  rememberPick(h.db, "usr_dana", "agt_intake", { model: "claude-sonnet-5-5", provider: "anthropic", effort: "high" }, 1);
  rememberPick(h.db, "usr_dana", "agt_docs", { model: "gpt-5", provider: "openai", effort: null }, 2);
  rememberPick(h.db, "usr_sam", "agt_intake", { model: "claude-haiku-5-5", provider: "anthropic", effort: null }, 3);
  const mine = await lastPickGet(h.ctx);
  assert.deepEqual(mine, { model: "gpt-5", provider: "openai" }, "the latest of her picks, any agent");
  assert.deepEqual(contractErrors("engine.last_pick.get", "out", mine), []);
});

test("choosing the default model in Settings is remembered as the last pick, so a new chat starts on it", async () => {
  const h = harness();
  await defaultsSet(h.ctx, { provider: "anthropic", model: "claude-sonnet-5-5" });
  assert.deepEqual(await lastPickGet(h.ctx), { model: "claude-sonnet-5-5", provider: "anthropic" });
  await defaultsSet(h.ctx, { fallback: [{ provider: "anthropic", model: "claude-haiku-5-5" }] });
  assert.deepEqual(await lastPickGet(h.ctx), { model: "claude-sonnet-5-5", provider: "anthropic" }, "a backup change is not a pick");
});

test("a new chat starts on the latest pick of any agent, not an older pick for its own agent (owner, 6 Nov)", async () => {
  const { recallPick } = await import("../last-pick.ts");
  const h = harness();
  rememberPick(h.db, "usr_dana", "agt_intake", { model: "claude-sonnet-5-5", provider: "anthropic", effort: "high" }, 1);
  rememberPick(h.db, "usr_dana", "agt_docs", { model: "glm-5", provider: "opencode-go", effort: "low" }, 2);
  assert.deepEqual(recallPick(h.db, "usr_dana", "agt_intake"), { model: "glm-5", provider: "opencode-go", effort: "low" });
});

test("picking Auto is a pick: it is remembered over an older specific model, and no pick at all stays different from Auto", async () => {
  const { recallPick } = await import("../last-pick.ts");
  const h = harness();
  assert.equal(recallPick(h.db, "usr_dana", "agt_intake"), null, "no pick yet");
  rememberPick(h.db, "usr_dana", "agt_intake", { model: "claude-sonnet-5-5", provider: "anthropic", effort: "high" }, 1);
  rememberPick(h.db, "usr_dana", "agt_docs", { model: "auto", provider: "anthropic", effort: null }, 2);
  assert.equal(recallPick(h.db, "usr_dana", "agt_intake")?.model, "auto");
  assert.deepEqual(await lastPickGet(h.ctx), { model: "auto", provider: "anthropic" });
});
