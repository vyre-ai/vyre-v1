// The chat's line when a team chat runs on a Space account's default model (owner, 3 Nov): once per chat, agent and swap, in plain words.
import test from "node:test";
import assert from "node:assert/strict";
import { fallbackLine, modelWords, noteModelFallback } from "../model-fallback.ts";
import type { ResolvedAccount } from "../../../agent/src/turn-engine/types.ts";

test("the line names the model it ran on and the maker that is not on the team key", () => {
  assert.equal(modelWords("glm-5.3"), "GLM 5.3");
  assert.equal(fallbackLine({ from: "claude-sonnet-5-5", to: "glm-5.3" }), "Ran on GLM 5.3; Claude isn't on the team key.");
  assert.equal(fallbackLine({ from: "gpt-5", to: "kimi-k3" }), "Ran on Kimi K3; GPT isn't on the team key.");
  assert.equal(fallbackLine({ from: "claude-sonnet-5-5" }), "Ran on the team key's own model; Claude isn't on it.");
});

test("it is said once per chat, agent and swap, and the account passes through unchanged", async () => {
  const acct: ResolvedAccount = { ref: "#OpenCode_Go_for_everyone", driver: "opencode_go", provider: "opencode_go", kind: "api_key", payer: "usr_mia", reason: "starter", shared: true, modelFallback: { from: "claude-sonnet-5-5", to: "glm-5.3" } };
  const posts: string[] = [];
  const resolve = noteModelFallback({ resolve: async () => acct, postAs: (async (_a: string, m: { blocks: Array<{ data: { text: string } }> }) => { posts.push(m.blocks[0]!.data.text); return {}; }) as never });
  const q = { threadId: "thr_1", agentId: "agt_1", askerId: "usr_mia" };
  assert.equal(await resolve(q), acct);
  await resolve(q);
  await resolve({ ...q, threadId: "thr_2" });
  assert.deepEqual(posts, ["Ran on GLM 5.3; Claude isn't on the team key.", "Ran on GLM 5.3; Claude isn't on the team key."]);
});
