// Helpers run on the right model, and the agent chooses it (owner, 4 Nov 2026): the default stays in the parent's provider; an explicit two-helper ask across two accounts works; an account the person may not use is
// refused; a model that is not available falls back inside its account and the pick says which was asked for; an agent set to ask first must ask.
import test from "node:test";
import assert from "node:assert/strict";
import { DANA, DRAFTER, INTAKE, harness } from "../fixtures/harness.ts";
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

test("Change model restarts a helper on the account and model the person picks: its agent takes them, the brief is given again, the row wears the new pick", async () => {
  const hn = world("same_provider");
  const threadId = await chatOf(hn);
  const h = (await startHelper(hn, threadId, { account: "#Mine_Claude", model: "claude-haiku-5-5", why: "cheap reader" })).helper["threadId"] as string;
  const out = await g["chat.helper.restart"](hn.person(DANA), { threadId, helperId: h, account: "#Space_OCG", model: "glm-5.3" });
  assert.deepEqual([out.model, out.account], ["glm-5.3", "#Space_OCG"]);
  assert.deepEqual(hn.rows("SELECT model, provider, accountRef FROM chat_thread_agent WHERE thread = ?", h).map((r) => [r["model"], r["provider"], r["accountRef"]]), [["glm-5.3", "opencode-go", "#Space_OCG"]]);
  const again = hn.rows("SELECT body, author FROM chat_message WHERE thread = ? ORDER BY threadSeq", h).map((r) => String(r["body"]));
  assert.equal(again.length, 2, "the brief, then the restart line");
  assert.match(again[1]!, /Starting again on GLM 5\.3\. Do the brief again from the start\./);
  const pk = pickOf(hn, h)!;
  assert.deepEqual([pk["model"], pk["accountRef"], pk["why"]], ["glm-5.3", "#Space_OCG", "you asked"]);
});

test("Change model: only the person it works for, an unavailable model falls back and says so, an account they may not use is refused", async () => {
  const hn = world("same_provider");
  const threadId = await chatOf(hn);
  const h = (await startHelper(hn, threadId, { account: "#Mine_Claude", model: "claude-haiku-5-5" })).helper["threadId"] as string;
  assert.equal((await failure(() => g["chat.helper.restart"](hn.person("usr_other"), { threadId, helperId: h, model: "claude-opus-5-5", account: "#Mine_Claude" }))).code, "validation.precondition_failed");
  assert.deepEqual(await failure(() => g["chat.helper.restart"](hn.person(DANA), { threadId, helperId: h, account: "#Someone_Elses_Key", model: "gpt-6" })), { code: "permission.no_grant", reason: "account_not_theirs" });
  const fell = await g["chat.helper.restart"](hn.person(DANA), { threadId, helperId: h, account: "#Mine_Claude", model: "claude-sonnet-5-5" });
  assert.deepEqual([fell.model, fell.fellBackFrom], ["claude-haiku-5-5", "claude-sonnet-5-5"]);
  assert.equal((await failure(() => g["chat.helper.restart"](hn.person(DANA), { threadId, helperId: threadId, model: "claude-opus-5-5", account: "#Mine_Claude" }))).code, "validation.not_found", "a chat is not a helper");
});

test("any member of the chat can message a running helper; someone outside it cannot; the words are theirs and the chat above sees them as a line, not a message to answer", async () => {
  const { addMember } = await import("../projections.ts");
  const { MAYA, LEO } = await import("../fixtures/harness.ts");
  const hn = world("same_provider");
  const threadId = await chatOf(hn);
  addMember(hn.ctx, threadId, MAYA, "member");
  const h = (await startHelper(hn, threadId, {})).helper["threadId"] as string;
  const before = hn.named("message.received").length;
  const sent = await g["chat.helper.steer"](hn.person(MAYA), { threadId: h, body: "Also check the fees page.", idempotencyKey: "s-1" });
  assert.ok(sent.messageId);
  const mine = hn.rows("SELECT author, body FROM chat_message WHERE thread = ? AND body = ?", h, "Also check the fees page.");
  assert.deepEqual(mine.map((r) => r["author"]), [MAYA], "credited to the person who wrote it, not to the asker");
  const seen = hn.rows("SELECT author, body FROM chat_message WHERE thread = ? AND body LIKE ?", threadId, 'To "%');
  assert.equal(seen.length, 1, "the chat above sees what the helper was told");
  assert.equal(hn.named("message.received").slice(before).filter((e) => e.payload["copy"] === true).length, 1, "and it is flagged as a copy: no agent answers it");
  assert.equal((await failure(() => g["chat.helper.steer"](hn.person(LEO), { threadId: h, body: "hi", idempotencyKey: "s-2" }))).code, "validation.precondition_failed", "not in the chat");
});
