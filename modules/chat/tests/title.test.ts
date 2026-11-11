// A chat is named after the first real request, never from a greeting, made again once from a thin first request, and never after a person renames it.
import test from "node:test";
import assert from "node:assert/strict";
import { DANA, INTAKE, MAYA, contractErrors, harness } from "../fixtures/harness.ts";
import type { Harness } from "../fixtures/harness.ts";
import { titleMake } from "../handlers/title.ts";
import { start } from "../handlers/thread.ts";
import { update } from "../handlers/g24a.ts";
import { planNotice } from "../handlers/notify.ts";
import { post } from "../handlers/post.ts";

const say = (...bodies: string[]) => ({ messages: bodies.map((b, i) => ({ messageId: `msg_${i}`, author: { kind: "person", id: DANA }, body: b })) });
const ACCOUNT = { ref: "#Dana_OpenRouter", driver: "openrouter", kind: "api_key", payer: DANA };
const world = (bodies: string[], model: string | null = "GHL onboarding goal") => {
  const prompts: string[] = [];
  const completed: Array<Record<string, unknown>> = [];
  const hn = harness({ calls: {
    "chat.messages.list": () => say(...bodies),
    "engine.models.list": () => ({ models: [{ provider: "openrouter", model: "google/gemini-flash-lite", allowed: true, pricing: { prompt: "0.0000001", completion: "0.0000004" } }] }),
    "engine.complete": (i) => { prompts.push(String(i["prompt"])); completed.push(i); if (model === null) throw new Error("no model"); return { text: model, tokensIn: 30, tokensOut: 6 }; },
  } });
  return { hn, prompts, completed };
};
const chatOf = async (hn: Harness): Promise<string> => (await start(hn.ctx, { kind: "chat", agentIds: [INTAKE] })).thread["threadId"] as string;
const titleOf = (hn: Harness, id: string): unknown => hn.rows("SELECT title FROM chat_thread WHERE id = ?", id)[0]?.["title"];

test("rule 4: the first real request names the chat in 2 to 5 words, on the cheap model of the turn's account", async () => {
  const { hn, prompts, completed } = world(["Set up the GHL onboarding goal for the Lab 8 registrants"]);
  const id = await chatOf(hn);
  const input = { threadId: id, account: ACCOUNT };
  assert.deepEqual(contractErrors("chat.title_make", "in", input), []);
  const out = await titleMake(hn.ctx, input);
  assert.deepEqual(contractErrors("chat.title_make", "out", out), []);
  assert.deepEqual(out, { made: true, title: "GHL onboarding goal" });
  assert.equal(titleOf(hn, id), "GHL onboarding goal");
  assert.match(prompts[0]!, /Lab 8 registrants/);
  const used = completed[0]!;
  assert.equal(used["model"], "google/gemini-flash-lite");
  assert.equal(used["accountRef"], "#Dana_OpenRouter");
});

test("a greeting makes no title; the first real request after it does; the model never sees the greeting", async () => {
  const a = world(["Heyy"]);
  const id = await chatOf(a.hn);
  assert.deepEqual(await titleMake(a.hn.ctx, { threadId: id, account: ACCOUNT }), { made: false, why: "small_talk" });
  assert.equal(a.completed.length, 0, "no model call for small talk");
  const b = world(["hi", "test", "Draft the October note for Sara"], "October note for Sara");
  const id2 = await chatOf(b.hn);
  assert.equal((await titleMake(b.hn.ctx, { threadId: id2, account: ACCOUNT })).title, "October note for Sara");
  assert.ok(!/\bhi\b|test/.test(b.prompts[0]!), "only the request goes to the model");
});

test("with no account or a model that fails, the request's own words make the title", async () => {
  const { hn } = world(["Draft the October note for Sara"], null);
  const id = await chatOf(hn);
  const out = await titleMake(hn.ctx, { threadId: id, account: ACCOUNT });
  assert.deepEqual(out, { made: true, title: "Draft the October note" });
  const bare = world(["Reconcile the October ledger today"]);
  const id2 = await chatOf(bare.hn);
  assert.equal((await titleMake(bare.hn.ctx, { threadId: id2 })).title, "Reconcile the October ledger today");
});

test("a title made from a thin request is made again once, from the first fuller one, and then it stands", async () => {
  const lines = ["test chat"];
  const prompts: string[] = [];
  const hn = harness({ calls: {
    "chat.messages.list": () => say(...lines),
    "engine.models.list": () => ({ models: [] }),
    "engine.complete": (i) => { prompts.push(String(i["prompt"])); return { text: prompts.length === 1 ? "Test chat" : "Lab 8 reminder emails", tokensIn: 1, tokensOut: 1 }; },
  } });
  const id = await chatOf(hn);
  // "test chat" is not a greeting: it is thin, and names the chat for now
  assert.equal((await titleMake(hn.ctx, { threadId: id, account: { ...ACCOUNT, driver: "anthropic" } })).made, true);
  assert.equal(titleOf(hn, id), "Test chat");
  assert.deepEqual(await titleMake(hn.ctx, { threadId: id, account: { ...ACCOUNT, driver: "anthropic" } }), { made: false, why: "small_talk" }, "nothing fuller yet: the thin title stands for now");
  lines.push("Write the reminder emails for the Lab 8 registrants");
  const second = await titleMake(hn.ctx, { threadId: id, account: { ...ACCOUNT, driver: "anthropic" } });
  assert.deepEqual(second, { made: true, title: "Lab 8 reminder emails" });
  lines.push("Now also change the colour of the header on the registration page please");
  assert.deepEqual(await titleMake(hn.ctx, { threadId: id, account: { ...ACCOUNT, driver: "anthropic" } }), { made: false, why: "done" }, "made again once, never twice");
});

test("a person's rename is theirs for good, from the header or the sidebar (threads.update)", async () => {
  const { hn } = world(["Set up the GHL onboarding goal for the Lab 8 registrants"]);
  const id = await chatOf(hn);
  await update(hn.ctx, { threadId: id, title: "Lab 8 work" });
  assert.deepEqual(await titleMake(hn.ctx, { threadId: id, account: ACCOUNT }), { made: false, why: "renamed" });
  assert.equal(titleOf(hn, id), "Lab 8 work");
  // and a rename after an automatic title wins over any later make
  const w2 = world(["Draft the October note for Sara"], "October note");
  const id2 = await chatOf(w2.hn);
  await titleMake(w2.hn.ctx, { threadId: id2, account: ACCOUNT });
  await update(w2.hn.ctx, { threadId: id2, title: "Sara notes" });
  assert.deepEqual(await titleMake(w2.hn.ctx, { threadId: id2, account: ACCOUNT }), { made: false, why: "renamed" });
  assert.equal(titleOf(w2.hn, id2), "Sara notes");
});

test("a direct message with a person and a channel are named by the rule, not by a made title", async () => {
  const { hn } = world(["Set up the GHL onboarding goal"]);
  const dm = (await start(hn.ctx, { kind: "chat", agentIds: [], personId: MAYA })).thread["threadId"] as string;
  assert.deepEqual(await titleMake(hn.ctx, { threadId: dm, account: ACCOUNT }), { made: false, why: "direct" });
});

test("a notification says where in the chat's one name: who is in an untitled chat, the title once it has one", async () => {
  const hn = harness({ calls: { "access.principals.get": (i) => ({ principal: { name: ({ usr_dana: "Dana", usr_maya: "Maya", agt_intake: "Intake" } as Record<string, string>)[String((i["principal"] as { id: string }).id)] } }) } });
  const id = (await start(hn.ctx, { kind: "chat", agentIds: [INTAKE] })).thread["threadId"] as string;
  const said = (await post(hn.ctx, { threadId: id, body: "@Maya see this", mentions: [{ kind: "person", id: MAYA }], idempotencyKey: "n1" })) as { message: { messageId: string } };
  const event = { name: "message.mentioned", payload: { threadId: id, messageId: said.message.messageId, personId: MAYA } };
  const first = await planNotice(hn.ctx, event);
  assert.equal(first?.data["where"], "Intake and Dana", "an untitled chat reads from the others in it, never \"a chat\"");
  await update(hn.ctx, { threadId: id, title: "Lab 8 work" });
  assert.equal((await planNotice(hn.ctx, event))?.data["where"], "Lab 8 work");
});
