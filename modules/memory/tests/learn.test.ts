// Learning after every turn (owner ruling 3 Nov 2026): one pass per turn on the asker's own account and the cheapest model it offers; add, update (close and replace, history kept) and
// close decisions against the person's facts, each linked to its chat line; a daily quota that stops at the cap, falls back to the rules and resets at local midnight; provider limits that
// pause learning without a word in the chat; shared chats that keep only what the asker said; and "Don't remember this chat".
import test from "node:test";
import assert from "node:assert/strict";
import { capture, factGet, factsAsOf } from "../handlers/facts.ts";
import { chatLearningGet, chatLearningSet, learningToday, parseOps, shouldLearn } from "../handlers/learn.ts";
import { cheapestModel, tierOf } from "../learn-model.ts";
import { localDay } from "../learn-quota.ts";
import { asPerson, assertEventsConform, contractErrors, DAY, harness, NOW, seedFact } from "../fixtures/harness.ts";
import type { Responder } from "../fixtures/harness.ts";

const THREAD = "thr_learn";
const DANA = "usr_dana";
const OMAR = "usr_omar";
const ACCOUNT = { ref: "#Dana_OpenRouter", driver: "openrouter", kind: "api_key", payer: DANA };
const person = (id: string) => ({ kind: "person", id });
const agent = { kind: "agent", id: "agt_intake" };

interface Msg { messageId: string; threadSeq: number; author: { kind: string; id: string }; body: string }
interface Script { messages: Msg[]; members?: string[]; kind?: string; mode?: string; models?: unknown[]; answer?: (prompt: string) => { text: string; tokensIn?: number; tokensOut?: number } | Error }
interface Seen { complete: Array<{ accountRef: string; model: string; prompt: string; system: string }>; listed: number }

function chat(s: Script, seen: Seen): Record<string, Responder> {
  return {
    "threads.get": (b: Record<string, unknown>) => ({ thread: { threadId: b["threadId"], kind: s.kind ?? "chat", starter: DANA, agents: [{ agentId: "agt_intake", mode: "lead" }], members: (s.members ?? [DANA]).map(person) } }),
    "agents.get": () => ({ agent: { folderId: "fld_intake", ownerId: "usr_boss", captureMode: s.mode ?? "auto" } }),
    "chat.messages.list": (i) => ({ messages: s.messages.filter((m) => i["after"] === undefined || m.threadSeq > Number(i["after"])), hasMore: false }),
    "engine.models.list": () => { seen.listed++; return { models: s.models ?? [] }; },
    "engine.complete": (i) => {
      seen.complete.push({ accountRef: String(i["accountRef"]), model: String(i["model"]), prompt: String(i["prompt"]), system: String(i["system"]) });
      const a = s.answer?.(String(i["prompt"])) ?? { text: "{\"ops\":[]}" };
      if (a instanceof Error) throw a;
      return { text: a.text, tokensIn: a.tokensIn ?? 900, tokensOut: a.tokensOut ?? 40 };
    },
  };
}
const turn = (account: Record<string, unknown> | null = ACCOUNT) => ({ threadId: THREAD, reason: "turn" as const, agentId: "agt_intake", ...(account ? { account: account as never } : {}) });
const say = (seq: number, body: string, who: { kind: string; id: string } = person(DANA)): Msg => ({ messageId: `msg_${seq}`, threadSeq: seq, author: who, body });
const priced = [
  { provider: "openrouter", model: "anthropic/claude-opus", allowed: true, pricing: { prompt: "0.000015", completion: "0.000075" } },
  { provider: "openrouter", model: "google/gemini-flash-lite", allowed: true, pricing: { prompt: "0.0000001", completion: "0.0000004" } },
  { provider: "openrouter", model: "meta/llama-70b:free", allowed: true, pricing: { prompt: "0", completion: "0" } },
  { provider: "openrouter", model: "openai/text-embedding-3-small", allowed: true, pricing: { prompt: "0.00000002", completion: "0" } },
  { provider: "openrouter", model: "x/cheap-but-blocked", allowed: false, pricing: { prompt: "0.00000001", completion: "0" } },
];

test("a turn runs one pass on the asker's own account and the cheapest model it offers", async () => {
  const seen: Seen = { complete: [], listed: 0 };
  const s: Script = { messages: [say(1, "I prefer short answers in the morning."), say(2, "Noted.", agent)], models: priced };
  const h = harness({ respond: chat(s, seen) });
  const out = await capture(h.ctx, turn());
  assert.deepEqual(contractErrors("memory.capture", "out", out), []);
  assert.equal(out.via, "model");
  assert.equal(seen.complete.length, 1, "one pass for one turn");
  assert.deepEqual([seen.complete[0]!.accountRef, seen.complete[0]!.model], ["#Dana_OpenRouter", "google/gemini-flash-lite"], "by price; never a free model, a blocked one or an embedding model");
  // the same turn again finds nothing new: no second pass, and the model is remembered for the account
  assert.equal((await capture(h.ctx, turn())).skipped, "nothing_new");
  assert.equal(seen.complete.length, 1);
  s.messages.push(say(3, "My office is in Lahore, near the canal."));
  await capture(h.ctx, turn());
  assert.equal(seen.complete.length, 2);
  assert.equal(seen.listed, 1, "the live list is read once and the pick kept");
  assert.ok(seen.complete[1]!.prompt.includes("[1] You: My office is in Lahore") && !seen.complete[1]!.prompt.includes("short answers"), "a pass reads only what is new since the last one");
});

test("the cheapest model per account kind: Haiku on a Claude subscription, the smallest on Codex, the price on a key, the tier table without prices", () => {
  assert.equal(cheapestModel("claude_code", [{ model: "claude-opus-5" }, { model: "claude-sonnet-5" }, { model: "claude-haiku-5-5" }]), "claude-haiku-5-5");
  assert.equal(cheapestModel("claude_code", []), "haiku", "Claude Code's own alias when the list says nothing");
  assert.equal(cheapestModel("codex", [{ model: "gpt-5-codex" }, { model: "gpt-5-codex-mini" }, { model: "o3" }]), "gpt-5-codex-mini");
  assert.equal(cheapestModel("openai", [{ model: "gpt-5" }, { model: "gpt-5-nano" }, { model: "gpt-5-mini" }, { model: "whisper-1" }]), "gpt-5-nano");
  assert.equal(cheapestModel("opencode_go", [{ model: "big", priceIn: 3, priceOut: 15 }, { model: "small-but-priced", priceIn: 0.2, priceOut: 0.8 }]), "small-but-priced");
  assert.equal(cheapestModel("openrouter", priced), "google/gemini-flash-lite");
  assert.equal(cheapestModel("xai", []), null, "no list and no table entry: the rules, not a guess");
  assert.ok(tierOf("o3-mini") < tierOf("o3") && tierOf("gemini-2.5-flash-lite") < tierOf("gemini-2.5-flash") && tierOf("claude-haiku") < tierOf("claude-sonnet"));
});

test("someone else's account never pays; a turn on the Space AI key learns on it because the turn ran on it", async () => {
  const seen: Seen = { complete: [], listed: 0 };
  const s: Script = { messages: [say(1, "I prefer invoices in euros.")], models: priced };
  const h = harness({ respond: chat(s, seen) });
  const out = await capture(h.ctx, turn({ ...ACCOUNT, ref: "#Omar_Key", payer: OMAR }));
  assert.equal(out.via, "rules");
  assert.equal(seen.complete.length, 0, "the pass did not touch Omar's account");
  assert.equal(h.rows("SELECT id FROM memory_facts WHERE owner_ref = ?", DANA).length, 1, "the rules still learned it, for free");
  s.messages.push(say(2, "My calendar is in Pacific time these days."));
  await capture(h.ctx, turn({ ref: "#Space_AI", driver: "openrouter", payer: DANA, spaceKey: true }));
  assert.deepEqual(seen.complete.map((c) => c.accountRef), ["#Space_AI"]);
});

test("add, update and close: the old fact closes with an end date and stays in the history, and every fact links to its chat line", async () => {
  const seen: Seen = { complete: [], listed: 0 };
  const s: Script = {
    messages: [say(1, "I moved to Lahore, so I'm on Pakistan time now. I stopped going to the gym. Priya runs my calendar."), say(2, "Got it, I will use Pakistan time.", agent)],
    models: priced,
    answer: (prompt) => {
      assert.ok(prompt.includes("fct_tz: Dana's timezone is Eastern") && prompt.includes("fct_gym: Dana goes to the gym on Mondays"), "the related facts are shown with their ids");
      return {
        text: "Sure. " + JSON.stringify({ ops: [
          { op: "update", id: "fct_tz", line: 1, text: "Dana's timezone is Pakistan time" },
          { op: "close", id: "fct_gym", line: 1 },
          { op: "add", line: 1, text: "Priya runs Dana's calendar", kind: "relationship" },
          { op: "add", line: 2, text: "The agent uses Pakistan time", kind: "note" },
          { op: "update", id: "fct_somebody_elses", line: 1, text: "made up" },
          { op: "ignore", line: 1 },
        ] }),
      };
    },
  };
  const h = harness({ respond: chat(s, seen) });
  seedFact(h, { id: "fct_tz", layer: "person", text: "Dana's timezone is Eastern", kind: "profile", agentId: "agt_intake", validFrom: NOW - 40 * DAY });
  seedFact(h, { id: "fct_gym", layer: "person", text: "Dana goes to the gym on Mondays", kind: "preference", agentId: "agt_intake" });
  const out = await capture(h.ctx, turn());
  assert.deepEqual([out.proposed, out.merged, out.updated, out.closed], [2, 2, 1, 1]);
  const old = h.rows("SELECT status, valid_to, closed_at FROM memory_facts WHERE id = 'fct_tz'")[0]!;
  assert.deepEqual([old["status"], old["valid_to"], old["closed_at"]], ["closed", NOW, NOW]);
  const fresh = h.rows("SELECT id, status, replaces, source_link, enc, text FROM memory_facts WHERE replaces = 'fct_tz'")[0]!;
  assert.deepEqual([fresh["status"], fresh["source_link"], fresh["enc"], fresh["text"]], ["current", `/chats/${THREAD}#msg_1`, 2, ""], "current, sealed, linked to the line");
  const got = await factGet(h.ctx, { factId: String(fresh["id"]) });
  assert.equal(got.fact.text, "Dana's timezone is Pakistan time");
  assert.deepEqual(got.history.map((f) => [f.factId, f.text]), [["fct_tz", "Dana's timezone is Eastern"]], "the old version is in the fact's history");
  const before = await factsAsOf(h.ctx, { date: NOW - DAY });
  assert.ok(before.facts.some((f) => f.text === "Dana's timezone is Eastern") && before.facts.some((f) => f.text === "Dana goes to the gym on Mondays"), "as of yesterday the old facts were true");
  const today = await factsAsOf(h.ctx, { date: NOW + 1 });
  assert.deepEqual(today.facts.map((f) => f.text).sort(), ["Dana's timezone is Pakistan time", "Priya runs Dana's calendar"]);
  assert.equal(h.rows("SELECT status FROM memory_facts WHERE id = 'fct_gym'")[0]!["status"], "closed");
  assert.equal(h.rows("SELECT reason FROM memory_trail WHERE fact_id = 'fct_gym' AND action = 'edit'")[0]!["reason"], "no longer true");
  for (const r of h.rows("SELECT f.id FROM memory_facts f WHERE f.learned_at = ? AND f.layer = 'person'", NOW)) {
    assert.deepEqual(h.rows("SELECT ref FROM memory_fact_links WHERE fact_id = ? AND kind = 'message'", r["id"]), [{ ref: "msg_1" }], "each fact names the line it came from");
  }
  assert.equal(h.rows("SELECT id FROM memory_facts").length, 4, "nothing from the agent's line, nothing for an id it was not given");
  assert.equal(h.named("memory.learned").length, 2);
  assert.deepEqual(assertEventsConform(h), []);
});

test("with the agent set to propose, an update waits beside a question and a close becomes a question; nothing current changes", async () => {
  const seen: Seen = { complete: [], listed: 0 };
  const s: Script = {
    mode: "propose", messages: [say(1, "I moved to Lahore and I stopped going to the gym.")], models: priced,
    answer: () => ({ text: JSON.stringify({ ops: [{ op: "update", id: "fct_tz", line: 1, text: "Dana lives in Lahore" }, { op: "close", id: "fct_gym", line: 1 }] }) }),
  };
  const h = harness({ respond: chat(s, seen) });
  seedFact(h, { id: "fct_tz", layer: "person", text: "Dana lives in Karachi", kind: "profile", agentId: "agt_intake" });
  seedFact(h, { id: "fct_gym", layer: "person", text: "Dana goes to the gym on Mondays", kind: "preference", agentId: "agt_intake" });
  const out = await capture(h.ctx, turn());
  assert.deepEqual([out.proposed, out.merged, out.updated ?? 0, out.closed ?? 0], [1, 0, 0, 0]);
  assert.deepEqual(h.rows("SELECT status FROM memory_facts WHERE id IN ('fct_tz', 'fct_gym') ORDER BY id").map((r) => r["status"]), ["current", "current"]);
  assert.deepEqual(h.rows("SELECT kind, fact_a FROM memory_questions ORDER BY kind").map((r) => [r["kind"], r["fact_a"]]), [["contradiction", "fct_tz"], ["stale", "fct_gym"]]);
});

test("the daily quota stops at the cap, falls back to the rules without a word, and resets at the person's local midnight", async () => {
  const seen: Seen = { complete: [], listed: 0 };
  const s: Script = { messages: [], models: priced, answer: () => ({ text: "{\"ops\":[]}", tokensIn: 1_000 }) };
  const h = harness({ respond: chat(s, seen), settings: { "memory.learn_daily_passes": 2, "profile.timezone": "Asia/Karachi" } });
  let seq = 0;
  const next = async () => { seq++; s.messages.push(say(seq, `I prefer meeting number ${seq} to start on time.`)); return capture(h.ctx, turn()); };
  assert.equal((await next()).via, "model");
  assert.equal((await next()).via, "model");
  const third = await next();
  assert.equal(third.via, "rules", "past the cap the free rules learn");
  assert.equal(third.proposed, 1);
  assert.equal(seen.complete.length, 2, "the cap is never crossed");
  const today = await learningToday(h.ctx, {});
  assert.deepEqual(contractErrors("memory.learning.today", "out", today), []);
  assert.deepEqual([today.passes, today.capPasses, today.tokensIn, today.rulePasses, today.state, today.timezone], [2, 2, 2_000, 1, "rules_only", "Asia/Karachi"]);
  const { resetsAt } = localDay(h.clock.t, "Asia/Karachi");
  assert.equal(new Date(resetsAt + 5 * 3_600_000).toISOString().slice(11, 19), "00:00:00", "midnight in Karachi (UTC+5)");
  h.clock.t = resetsAt + 1;
  assert.equal((await next()).via, "model", "a new day, a new quota");
  assert.equal((await learningToday(h.ctx, {})).passes, 1);
});

test("the token quota is reserved before a pass and never crossed, however many tokens the provider counted", async () => {
  const seen: Seen = { complete: [], listed: 0 };
  const s: Script = { messages: [], models: priced, answer: () => ({ text: "{\"ops\":[]}", tokensIn: 3_000 }) };
  const h = harness({ respond: chat(s, seen), settings: { "memory.learn_daily_tokens": 6_000 } });
  for (let i = 1; i <= 4; i++) { s.messages.push(say(i, `I prefer the weekly report number ${i} on Fridays.`)); await capture(h.ctx, turn()); }
  const today = await learningToday(h.ctx, {});
  assert.ok(today.tokensIn <= 6_000, `used ${today.tokensIn} of 6000`);
  assert.equal(seen.complete.length, 1, "after a 3000-token pass, another would risk the line, so the rules take over");
  assert.equal(today.rulePasses, 3);
});

test("a provider's rate or usage limit pauses learning on that account with a backoff, silently; the chat never sees it", async () => {
  const seen: Seen = { complete: [], listed: 0 };
  let fail = true;
  const s: Script = { messages: [], models: priced, answer: () => (fail ? Object.assign(new Error("429 rate_limit_error: too many requests"), { code: "provider.rate_limited" }) : { text: "{\"ops\":[]}" }) };
  const h = harness({ respond: chat(s, seen) });
  let seq = 0;
  const next = async () => { seq++; s.messages.push(say(seq, `I prefer standup number ${seq} short.`)); return capture(h.ctx, turn()); };
  const first = await next();
  assert.equal(first.via, "rules", "the limit is not an error: the rules learn this one");
  assert.equal(seen.complete.length, 1);
  assert.equal((await learningToday(h.ctx, {})).passes, 0, "a pass the provider refused is given back");
  await next();
  assert.equal(seen.complete.length, 1, "paused: the account is not asked again inside the backoff");
  h.advance(61_000);
  await next();
  assert.equal(seen.complete.length, 2, "asked again after a minute, refused again");
  h.advance(61_000);
  await next();
  assert.equal(seen.complete.length, 2, "the second pause is longer (two minutes)");
  fail = false;
  h.advance(60_000);
  assert.equal((await next()).via, "model");
  assert.equal(h.named("memory.captured").length, 5);
  assert.ok(!h.emitted.some((e) => /error|failed/.test(e.name)), "no event a chat would show");
});

test("in a shared chat only what the asker said about themselves is kept, as that place's memory (rule 8); other people's words never reach the pass", async () => {
  const seen: Seen = { complete: [], listed: 0 };
  const s: Script = {
    members: [DANA, OMAR], models: priced,
    messages: [say(1, "My salary is 90k and I prefer tea.", person(OMAR)), say(2, "I prefer morning meetings. We decided to ship on Friday.")],
    answer: (prompt) => ({ text: JSON.stringify({ ops: [{ op: "add", line: 1, text: "Dana prefers morning meetings", kind: "preference" }, { op: "add", line: 9, text: "Omar earns 90k", kind: "profile" }] }), tokensIn: prompt.length }),
  };
  const h = harness({ respond: chat(s, seen) });
  await capture(h.ctx, turn());
  const prompt = seen.complete[0]!.prompt;
  assert.ok(!prompt.includes("salary") && !prompt.includes("tea"), "Omar's line is not in the pass");
  assert.ok(prompt.includes("Other people are in this chat"));
  const dana = h.rows("SELECT id, owner_ref, layer FROM memory_facts");
  // owner ruling: what is said in a place others read is the place's memory, kept by the agent that is in it; never Dana's private layer
  assert.deepEqual(dana.map((r) => [r["owner_ref"], r["layer"]]), [["agt_intake", "agent"]]);
  assert.equal(h.rows("SELECT COUNT(*) AS n FROM memory_facts WHERE layer = 'person'")[0]!["n"], 0);
  assert.deepEqual(h.rows("SELECT ref FROM memory_fact_links WHERE kind = 'heard_in'"), [{ ref: THREAD }], "the chat it was said in travels with it (the audience rule)");
  const facts = await factsAsOf(h.ctx, { date: NOW + 1 });
  assert.deepEqual(facts.facts.map((f) => f.text), ["Dana prefers morning meetings"]);
  // the rules in a shared chat: Dana's own lines become the place's memory (a decision too, so it is not lost behind the pass's cursor), and nothing of Omar's
  const { answer: _unused, ...plain } = s;
  const rules = harness({ respond: chat(plain, { complete: [], listed: 0 }) });
  await capture(rules.ctx, turn(null));
  assert.equal(rules.rows("SELECT id FROM memory_facts").length, 2);
  const omar = asPerson(rules, { kind: "person", id: OMAR }, { respond: chat(s, { complete: [], listed: 0 }) });
  // Omar is in the room, so he reads the room's memory (Dana's preference); nothing of his own words was stored
  assert.deepEqual((await factsAsOf(omar.ctx, { date: NOW + 1 })).facts.map((f) => f.text).sort(), ["I prefer morning meetings.", "We decided to ship on Friday."]);   // two facts learned in one instant: no order is promised
});

test("Don't remember this chat: nothing is learned from it by a turn pass or at its end, and only who turned it off, or the starter, turns it back on", async () => {
  const seen: Seen = { complete: [], listed: 0 };
  const s: Script = { members: [DANA, OMAR], messages: [say(1, "I prefer the blue theme. Remember that the launch is in May.")], models: priced };
  const h = harness({ principal: { kind: "person", id: OMAR }, respond: chat(s, seen) });
  assert.equal((await chatLearningGet(h.ctx, { threadId: THREAD })).remember, true);
  const off = await chatLearningSet(h.ctx, { threadId: THREAD, remember: false });
  assert.deepEqual(contractErrors("memory.chat_learning.set", "out", off), []);
  assert.deepEqual([off.remember, off.by], [false, OMAR]);
  const dana = asPerson(h, { kind: "person", id: DANA }, { respond: chat({ ...s, members: [DANA, OMAR] }, seen) });
  assert.equal((await capture(dana.ctx, turn())).skipped, "forgotten");
  assert.deepEqual(await capture(dana.ctx, { threadId: THREAD, reason: "idle" }), { proposed: 0, merged: 0 });
  assert.equal(seen.complete.length, 0);
  assert.equal(h.rows("SELECT id FROM memory_facts").length, 0);
  const ben = asPerson(h, { kind: "person", id: "usr_ben" }, { respond: chat(s, seen) });
  await assert.rejects(chatLearningSet(ben.ctx, { threadId: THREAD, remember: true }), (e) => (e as { error?: { code?: string } }).error?.code === "permission.no_grant");
  assert.equal((await chatLearningSet(dana.ctx, { threadId: THREAD, remember: true })).remember, true, "Dana started the chat");
  assert.equal((await capture(dana.ctx, turn())).via, "model");
  const stranger = asPerson(h, { kind: "person", id: "usr_x" }, { respond: { "threads.get": () => { throw new Error("not found"); } } });
  await assert.rejects(chatLearningGet(stranger.ctx, { threadId: THREAD }), (e) => (e as { error?: { code?: string } }).error?.code === "validation.not_found");
});

test("the thread setting memory.off (the composer switch) stops every learning path through shouldLearn", async () => {
  const seen: Seen = { complete: [], listed: 0 };
  const s: Script = { messages: [say(1, "I prefer the blue theme for reports.")], models: priced };
  for (const thread of [{ "memory.off": true }, { settings: { "memory.off": true } }]) {
    const respond = { ...chat(s, seen), "threads.get": (b: Record<string, unknown>) => ({ thread: { threadId: b["threadId"], kind: "chat", starter: DANA, agents: [{ agentId: "agt_intake", mode: "lead" }], members: [person(DANA)], ...thread } }) };
    const h = harness({ respond });
    assert.equal(shouldLearn(h.ctx, THREAD, thread), false);
    assert.equal((await capture(h.ctx, turn())).skipped, "forgotten");
    assert.deepEqual(await capture(h.ctx, { threadId: THREAD, reason: "closed" }), { proposed: 0, merged: 0 });
    assert.equal(h.rows("SELECT id FROM memory_facts").length, 0);
  }
  assert.equal(seen.complete.length, 0, "no model pass, nothing written");
  assert.equal(shouldLearn(harness().ctx, THREAD, { settings: { "memory.off": false } }), true);
});

test("lines a turn pass read are not captured again when the chat goes quiet; lines it did not read still are", async () => {
  const seen: Seen = { complete: [], listed: 0 };
  const s: Script = { messages: [say(1, "I prefer tea in the afternoon.")], models: priced, answer: () => ({ text: JSON.stringify({ ops: [{ op: "add", line: 1, text: "Dana prefers tea in the afternoon", kind: "preference" }] }) }) };
  const h = harness({ respond: chat(s, seen) });
  await capture(h.ctx, turn());
  s.messages.push(say(2, "I prefer email over calls."));
  const idle = await capture(h.ctx, { threadId: THREAD, reason: "idle" });
  assert.equal(idle.proposed, 1, "only the line no pass read");
  assert.equal(h.rows("SELECT id FROM memory_facts").length, 2);
});

test("a line a turn pass read but learned nothing from still goes through the rules when the chat goes quiet", async () => {
  const seen: Seen = { complete: [], listed: 0 };
  // the model reads both lines and keeps only the first; the second it read is not lost
  const s: Script = { messages: [say(1, "I prefer tea in the afternoon."), say(2, "I prefer email over calls.")], models: priced, answer: () => ({ text: JSON.stringify({ ops: [{ op: "add", line: 1, text: "Dana prefers tea in the afternoon", kind: "preference" }] }) }) };
  const h = harness({ respond: chat(s, seen) });
  const pass = await capture(h.ctx, turn());
  assert.equal(pass.via, "model");
  assert.equal(pass.proposed, 1);
  const idle = await capture(h.ctx, { threadId: THREAD, reason: "idle" });
  assert.equal(idle.proposed, 1, "the rules keep the line the pass read and learned nothing from; the line it learned from is left alone");
  assert.equal(h.rows("SELECT id FROM memory_facts").length, 2);
  // a pass that learned nothing at all: every line it read still reaches the rules
  const s2: Script = { messages: [say(1, "I prefer short answers in the morning.")], models: priced, answer: () => ({ text: "{\"ops\":[]}" }) };
  const h2 = harness({ respond: chat(s2, seen) });
  assert.equal((await capture(h2.ctx, turn())).proposed, 0);
  assert.equal((await capture(h2.ctx, { threadId: THREAD, reason: "closed" })).proposed, 1);
});

test("parseOps keeps only well-formed ops", () => {
  assert.deepEqual(parseOps("nothing"), []);
  assert.deepEqual(parseOps("{\"ops\":[{\"op\":\"add\",\"line\":\"2\",\"text\":\"Likes tea\",\"kind\":\"weird\"},{\"op\":\"close\",\"line\":1},{\"op\":\"update\",\"id\":\"fct_a\",\"line\":1,\"text\":\"x\"}]}"),
    [{ op: "add", line: 2, text: "Likes tea", kind: "note" }]);
});
