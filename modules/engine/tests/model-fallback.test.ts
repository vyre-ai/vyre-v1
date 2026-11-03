// The chat's line when a team chat runs on a Space account's default model (owner, 3 Nov): once per chat, agent and swap, in plain words.
import test from "node:test";
import assert from "node:assert/strict";
import { fallbackLine, modelWords, noteModelFallback } from "../model-fallback.ts";
import { withSpaceKeyTurns } from "../space-key-turns.ts";
import type { EngineSession, ResolvedAccount, SessionSpec } from "../../../agent/src/turn-engine/types.ts";

test("the line names the model it ran on and the maker that is not on the team key", () => {
  assert.equal(modelWords("glm-5.3"), "GLM 5.3");
  assert.equal(fallbackLine({ from: "claude-sonnet-5-5", to: "glm-5.3" }), "Ran on GLM 5.3; Claude isn't on the team key.");
  assert.equal(fallbackLine({ from: "gpt-5", to: "kimi-k3" }), "Ran on Kimi K3; GPT isn't on the team key.");
  assert.equal(fallbackLine({ from: "claude-sonnet-5-5" }), "Ran on the team key's own model; Claude isn't on it.");
});

test("it is said once per chat, agent and swap", async () => {
  const posts: string[] = [];
  const say = noteModelFallback({ postAs: (async (_a: string, m: { blocks: Array<{ data: { text: string } }> }) => { posts.push(m.blocks[0]!.data.text); return {}; }) as never });
  const q = { threadId: "thr_1", agentId: "agt_1", askerId: "usr_mia" };
  const swap = { from: "claude-sonnet-5-5", to: "glm-5.3" };
  await say(q, swap);
  await say(q, swap);
  await say({ ...q, threadId: "thr_2" }, swap);
  assert.deepEqual(posts, ["Ran on GLM 5.3; Claude isn't on the team key.", "Ran on GLM 5.3; Claude isn't on the team key."]);
});

test("the line is said when the session opens on the swapped model, not when an account is only picked", async () => {
  const posts: string[] = [];
  const opened: Array<string | undefined> = [];
  const open = async (spec: SessionSpec): Promise<EngineSession> => { opened.push(spec.agent.model); return { warm: false, async *send() { yield { type: "done" } as const; }, sendToolResult() {}, inject() {}, async cancel() {}, async close() {} }; };
  const db = { all: () => [] as unknown[], run: () => ({ changes: 0 }) };
  const wrapped = withSpaceKeyTurns(open, { call: async () => ({}), db, now: () => 1, postAs: (async (_a: string, m: { blocks: Array<{ data: { text: string } }> }) => { posts.push(m.blocks[0]!.data.text); return {}; }) as never });
  const acct: ResolvedAccount = { ref: "#Cheap", driver: "anthropic", provider: "anthropic", kind: "api_key", payer: "usr_mia", reason: "starter", shared: true, modelFallback: { from: "claude-sonnet-5-5", to: "glm-5.3" } };
  const spec = { threadId: "thr_1", agent: { id: "agt_1", mode: "lead", model: "claude-sonnet-5-5" }, asker: "usr_mia", turnId: "trn_1", traceId: "a".repeat(32) } as SessionSpec;
  await wrapped({ ...spec, account: { ...acct, modelFallback: undefined } as ResolvedAccount });
  assert.deepEqual(posts, [], "an account that does not swap says nothing");
  await wrapped({ ...spec, account: acct });
  assert.deepEqual([posts, opened.at(-1)], [["Ran on GLM 5.3; Claude isn't on the team key."], "glm-5.3"]);
});
