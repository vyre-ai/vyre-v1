import test from "node:test";
import assert from "node:assert/strict";
import { AskDriverError, askPrompt, createEmailAskDriver, parseProposal } from "./email-ask.ts";

const doc = { emailId: "eml_1", name: "Welcome", mode: "html", subject: "Hi", html: "<p>x</p>" };
type Reply = (cap: string, input: Record<string, unknown>) => unknown;
function driver(reply: Reply, o: { timeoutMs?: number } = {}) {
  const calls: { cap: string; input: Record<string, unknown>; as: string; who: { principal: { kind: string; id: string }; actingFor?: string | undefined } }[] = [];
  let clock = 0;
  const d = createEmailAskDriver({ call: async (cap, input, as) => { calls.push({ cap, input: input as Record<string, unknown>, as: as.principal.id, who: as }); return reply(cap, input as Record<string, unknown>); }, now: () => clock, sleep: async (ms) => { clock += ms; }, ...o });
  return { d, calls };
}
const base: Reply = (cap) => {
  if (cap === "chat.ask_suggest") return { agentId: null };
  if (cap === "agents.list") return { agents: [{ agentId: "agt_a", status: "awake" }] };
  if (cap === "engine.pool.status") return {};
  if (cap === "chat.start") return { thread: { threadId: "thr_1" } };
  if (cap === "engine.account.resolve") return { allowed: true, accountRef: "acc_1" };
  if (cap === "chat.post") return { message: { messageId: "msg_1", threadSeq: 1 } };
  return {};
};

test("an Ask is one agent turn in a private Ask pane, run as the asker, and the reply is the proposal", async () => {
  const { d, calls } = driver((cap, input) => cap === "chat.messages.list" ? { messages: [{ author: { kind: "agent" }, body: "```json\n{\"subject\":\"Hello\"}\n```" }] } : base(cap, input));
  assert.deepEqual(await d.propose({ instruction: "Friendlier", agentId: null, doc, principal: { kind: "person", id: "usr_me" } }), { subject: "Hello" });
  assert.ok(calls.every((c) => c.as === "usr_me"), "every call runs as the asker");
  const start = calls.find((c) => c.cap === "chat.start")!.input;
  assert.deepEqual([start["kind"], start["scopeType"], start["scopeId"], start["agentIds"]], ["ask", "email", "eml_1", ["agt_a"]]);
  assert.ok(calls.findIndex((c) => c.cap === "engine.pool.status") < calls.findIndex((c) => c.cap === "chat.start"), "the runtime exists before the first message");
  assert.match(String(calls.find((c) => c.cap === "chat.post")!.input["body"]), /Friendlier[\s\S]*"subject":"Hi"/);
});

test("no model for the agent fails in words before anything is posted", async () => {
  const { d, calls } = driver((cap, input) => cap === "engine.account.resolve" ? { allowed: false, accountRef: null } : base(cap, input));
  await assert.rejects(() => d.propose({ instruction: "x", agentId: "agt_a", doc, principal: { kind: "person", id: "usr_me" } }), (e: AskDriverError) => e.code === "validation.precondition_failed" && /Open Settings/.test(e.message));
  assert.equal(calls.some((c) => c.cap === "chat.post"), false);
});

test("a failed turn says why by its code; a parked or stopped turn is told apart", async () => {
  const turn = (state: string, code?: string): Reply => (cap, input) => cap === "chat.messages.list" ? { messages: [{ author: { kind: "agent" }, body: "", blocks: [{ type: "turn_status", data: { state, ...(code ? { code } : {}) } }] }] } : base(cap, input);
  await assert.rejects(() => driver(turn("failed", "provider.auth_failed")).d.propose({ instruction: "x", agentId: "agt_a", doc, principal: { kind: "person", id: "usr_me" } }), (e: AskDriverError) => e.code === "provider.auth_failed" && /reconnect/.test(e.message));
  await assert.rejects(() => driver(turn("cancelled")).d.propose({ instruction: "x", agentId: "agt_a", doc, principal: { kind: "person", id: "usr_me" } }), /stopped/);
  const parked = driver(turn("waiting"));
  await assert.rejects(() => parked.d.propose({ instruction: "x", agentId: "agt_a", doc, principal: { kind: "person", id: "usr_me" } }), /needs an approval/);
  assert.ok(parked.calls.some((c) => c.cap === "engine.stop"), "a parked turn is stopped");
});

test("no answer in time stops the turn; an abort stops it at once", async () => {
  const silent: Reply = (cap, input) => cap === "chat.messages.list" ? { messages: [] } : base(cap, input);
  const slow = driver(silent, { timeoutMs: 1000 });
  await assert.rejects(() => slow.d.propose({ instruction: "x", agentId: "agt_a", doc, principal: { kind: "person", id: "usr_me" } }), (e: AskDriverError) => e.code === "provider.network" && /in time/.test(e.message));
  assert.ok(slow.calls.some((c) => c.cap === "engine.stop"));
  const ac = new AbortController(); ac.abort();
  const cancelled = driver(silent);
  await assert.rejects(() => cancelled.d.propose({ instruction: "x", agentId: "agt_a", doc, principal: { kind: "person", id: "usr_me" }, signal: ac.signal }), /cancelled/);
  assert.ok(cancelled.calls.some((c) => c.cap === "engine.stop"));
});

test("the proposal is read from plain JSON, a fence or braces inside prose, and nothing else", () => {
  assert.deepEqual(parseProposal('{"subject":"a"}'), { subject: "a" });
  assert.deepEqual(parseProposal('Here you go: {"subject":"a"} done'), { subject: "a" });
  assert.throws(() => parseProposal("shorter please"), /not with a design change/);
  assert.throws(() => parseProposal("[1,2]"), AskDriverError);
  assert.match(askPrompt("Do it", { a: 1 }), /Instruction: Do it/);
});

test("cancel stops only this person's Ask on this design", async () => {
  let release: () => void = () => undefined;
  const gate = new Promise<void>((r) => { release = r; });
  const slow: Reply = (cap, input) => cap === "chat.messages.list" ? gate.then(() => ({ messages: [] })) : base(cap, input);
  const { d, calls } = driver(slow);
  const mine = d.propose({ instruction: "x", agentId: "agt_a", doc, principal: { kind: "person", id: "usr_me" } }).catch((e: AskDriverError) => e);
  const theirs = d.propose({ instruction: "x", agentId: "agt_a", doc, principal: { kind: "person", id: "usr_you" } }).catch((e: AskDriverError) => e);
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(d.cancel("usr_me", "eml_1"), 1);
  assert.equal(d.cancel("usr_me", "eml_other"), 0);
  release();
  assert.match(((await mine) as AskDriverError).message, /cancelled/);
  assert.equal(calls.filter((c) => c.cap === "engine.stop").length >= 1, true);
  assert.equal(d.cancel("usr_me", "eml_1"), 0, "a finished Ask is forgotten");
  void theirs;
});

test("an agent that asks runs as that agent for the person it acts for, never as a person with its id; with nobody to act for it is refused", async () => {
  const agent = { kind: "agent" as const, id: "agt_caller" };
  const act = driver((cap, input) => cap === "chat.messages.list" ? { messages: [{ author: { kind: "agent" }, body: "{\"subject\":\"x\"}" }] } : base(cap, input));
  await act.d.propose({ instruction: "x", agentId: "agt_a", doc, principal: agent, actingFor: "usr_boss" });
  assert.ok(act.calls.length > 0);
  for (const c of act.calls) assert.deepEqual([c.who.principal.kind, c.who.principal.id, c.who.actingFor], ["agent", "agt_caller", "usr_boss"], `${c.cap} keeps the agent principal and who it acts for`);
  assert.equal(act.calls.find((c) => c.cap === "engine.account.resolve")!.input["askerId"], "usr_boss", "the account is the person's");
  const alone = driver(base);
  await assert.rejects(() => alone.d.propose({ instruction: "x", agentId: "agt_a", doc, principal: agent }), (e: AskDriverError) => e.code === "permission.no_grant");
  assert.equal(alone.calls.length, 0, "nothing runs for a caller with no person behind it");
  assert.equal(alone.d.cancel("agt_caller", "eml_1"), 0);
});
