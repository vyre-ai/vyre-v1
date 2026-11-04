// Helpers run on the right model, and the agent chooses it (owner, 4 Nov 2026): the default stays in the parent's provider; an explicit two-helper ask across two accounts works; an account the person may not use is
// refused; a model that is not available falls back inside its account and the pick says which was asked for; an agent set to ask first must ask.
import test from "node:test";
import assert from "node:assert/strict";
import { DRAFTER, INTAKE, harness } from "../fixtures/harness.ts";
import type { Harness } from "../fixtures/harness.ts";
import { g24dHandlers as g } from "../handlers/g24d.ts";
import { start } from "../handlers/thread.ts";
import { pick, tierFor, tierOf } from "../../../lib/model-tiers.ts";

const model = (m: string, available = true) => ({ model: m, tier: tierOf(m), available });
const CAT = (policy: "same_provider" | "any" | "ask" = "same_provider") => ({
  policy, parent: { provider: "anthropic" },
  accounts: [
    { ref: "#Mine_Claude", provider: "anthropic", label: "Claude · Irfad", models: [model("claude-haiku-5-5"), model("claude-opus-5-5"), model("claude-sonnet-5-5", false)] },
    { ref: "#Mine_OpenAI", provider: "openai", label: "OpenAI · irfad@mylegalacademy.com", models: [model("gpt-6")] },
    { ref: "#Space_OCG", provider: "opencode-go", label: "OpenCode Go · Space", models: [model("glm-5.3-flash"), model("glm-5.3")] },
  ],
});
const world = (policy?: "same_provider" | "any" | "ask") => harness({ calls: { "engine.helper_models": () => CAT(policy) } });
const chatOf = async (hn: Harness): Promise<string> => (await start(hn.ctx, { kind: "chat", agentIds: [INTAKE] })).thread["threadId"] as string;
const failure = async (run: () => Promise<unknown>): Promise<{ code: string; reason?: string }> => { try { await run(); } catch (e) { const x = e as { error?: { code?: string; details?: { reason?: string } } }; return { code: String(x.error?.code), ...(x.error?.details?.reason ? { reason: x.error.details.reason } : {}) }; } return { code: "none" }; };
const startHelper = (hn: Harness, threadId: string, extra: Record<string, unknown>) => g["chat.helper.start"](hn.agent(INTAKE), { threadId, title: "A job", instruction: "Do it.", agentId: DRAFTER, ...extra });
const pickOf = (hn: Harness, helperId: string): Record<string, unknown> | undefined => {
  const row = hn.rows("SELECT blocks FROM chat_message WHERE json_extract(blocks, '$[0].data.helperThreadId') = ?", helperId)[0];
  return row ? ((JSON.parse(String(row["blocks"])) as Array<{ data?: { pick?: Record<string, unknown> } }>)[0]?.data?.pick) : undefined;
};

test("tiers: a cheap model for reading and checking, a strong one for reasoning and code, by the name the vendor gave", () => {
  assert.deepEqual(["claude-haiku-5-5", "glm-5.3-flash", "deepseek-v4.1-flash", "gpt-6", "claude-opus-5-5", "deepseek-v4-pro", "glm-5.3"].map(tierOf), ["cheap", "cheap", "cheap", "strong", "strong", "strong", "standard"]);
  const models = ["claude-opus-5-5", "claude-haiku-5-5"];
  assert.equal(pick(models, tierFor("read")), "claude-haiku-5-5");
  assert.equal(pick(models, tierFor("think")), "claude-opus-5-5");
  assert.equal(pick(["glm-5.3"], "cheap"), "glm-5.3", "no cheap one: the nearest");
});

test("two helpers across two accounts: one on OpenAI from the person's own account, one on the Space's OpenCode, each named by its account, and the person asked for both", async () => {
  const hn = world("any");
  const threadId = await chatOf(hn);
  const a = (await startHelper(hn, threadId, { account: "OpenAI · irfad@mylegalacademy.com", model: "gpt-6", why: "you asked" })).helper["threadId"] as string;
  const b = (await startHelper(hn, threadId, { account: "#Space_OCG", model: "glm-5.3", why: "you asked" })).helper["threadId"] as string;
  assert.deepEqual(pickOf(hn, a), { accountRef: "#Mine_OpenAI", accountLabel: "OpenAI · irfad@mylegalacademy.com", provider: "openai", model: "gpt-6", why: "you asked" });
  assert.equal(pickOf(hn, b)?.["accountRef"], "#Space_OCG");
  assert.deepEqual(hn.rows("SELECT model, provider FROM chat_thread_agent WHERE thread = ?", a).map((r) => [r["model"], r["provider"]]), [["gpt-6", "openai"]]);
});

test("the default stays inside the parent's provider: another provider needs the person to have asked", async () => {
  const hn = world("same_provider");
  const threadId = await chatOf(hn);
  assert.deepEqual(await failure(() => startHelper(hn, threadId, { account: "#Mine_OpenAI", model: "gpt-6" })), { code: "validation.precondition_failed", reason: "other_provider" });
  assert.equal(pickOf(hn, (await startHelper(hn, threadId, { account: "#Mine_Claude", model: "claude-haiku-5-5", why: "cheap reader" })).helper["threadId"] as string)?.["why"], "cheap reader");
  assert.ok(await startHelper(hn, threadId, { account: "#Mine_OpenAI", model: "gpt-6", why: "you asked" }), "named by the person: allowed");
});

test("an account the person may not use is refused, never guessed", async () => {
  const hn = world("any");
  const threadId = await chatOf(hn);
  assert.deepEqual(await failure(() => startHelper(hn, threadId, { account: "#Someone_Elses_Key", model: "gpt-6" })), { code: "permission.no_grant", reason: "account_not_theirs" });
});

test("a model that is not available falls back inside its account, and the pick says which one was asked for", async () => {
  const hn = world("same_provider");
  const threadId = await chatOf(hn);
  const h = (await startHelper(hn, threadId, { account: "#Mine_Claude", model: "claude-sonnet-5-5", why: "cheap reader" })).helper["threadId"] as string;
  const p = pickOf(hn, h)!;
  assert.deepEqual([p["model"], p["fellBackFrom"]], ["claude-haiku-5-5", "claude-sonnet-5-5"]);
});

test("an agent set to ask first must be given a model: without one it is told to ask the person with the choices", async () => {
  const hn = world("ask");
  const threadId = await chatOf(hn);
  assert.deepEqual(await failure(() => startHelper(hn, threadId, {})), { code: "validation.precondition_failed", reason: "ask_first" });
  assert.ok(await startHelper(hn, threadId, { account: "#Mine_Claude", model: "claude-opus-5-5" }));
});
