// The crew model: every sentence a person reads about the crew, from the numbers engine.crew.status returns.
import test from "node:test";
import assert from "node:assert/strict";
import { rowModel, whyWords } from "./model.ts";
import { mergeStateOf, totalsParts, sortedBy, withTeammates, middle, faceSeed, holdsOf, keyAction, testsWords, clock, counts, isCode, lineOf, modelTag, modelsLine, money, ranTogether, roleOf, shows, sorted, span, stripTitle, stripTone, timeline, tokenSplit, totalsLine, tokens } from "./model.ts";
import type { CrewMember, CrewTotals } from "./model.ts";

const T = (o: Partial<CrewTotals> = {}): CrewTotals => ({ members: 3, working: 0, done: 3, needsYou: 0, failed: 0, stopped: 0, tokensIn: 0, tokensOut: 0, costMicros: 0, filesChanged: 0, added: 0, deleted: 0, elapsedMs: 41_000, ...o });
const M = (o: Partial<CrewMember> = {}): CrewMember => ({ kind: "helper", id: "thr_1", parentThreadId: "thr_0", title: "Calendar", agentId: "agt_1", state: "done", startedAt: 0, elapsedMs: 41_000, tokensIn: 0, tokensOut: 0, costMicros: 0, ...o }) as CrewMember;

test("clocks and spans read as a person says them", () => {
  assert.equal(clock(12_000), "0:12"); assert.equal(clock(65_000), "1:05"); assert.equal(clock(3_723_000), "1:02:03");
  assert.equal(span(41_000), "41 s"); assert.equal(span(80_000), "1 min 20 s"); assert.equal(span(120_000), "2 min"); assert.equal(span(7_500_000), "2 h 5 min");
  assert.equal(money(0), "$0.00"); assert.equal(money(5_000), "under $0.01"); assert.equal(money(120_000), "$0.12");
  assert.equal(tokens(900), "900"); assert.equal(tokens(12_300), "12.3k"); assert.equal(tokens(2_000_000), "2M");
});

test("a row says what it is on, what it found, or what went wrong", () => {
  assert.equal(lineOf({ state: "working", step: "Reading the price table" }), "Reading the price table");
  assert.equal(lineOf({ state: "working" }), "Working");
  assert.equal(lineOf({ state: "needs_you", step: "Needs your OK to read Vendor calls" }), "Needs your OK to read Vendor calls");
  assert.equal(lineOf({ state: "done", found: "Harbor: $4,180." }), "Harbor: $4,180.");
  assert.equal(lineOf({ state: "failed" }), "Could not finish. Try again.");
  assert.equal(lineOf({ state: "stopped" }), "Stopped");
  assert.equal(roleOf({ title: "A very long title for a helper that goes past the limit", name: "Tess" }).length, 28);
  assert.equal(roleOf({ title: "Read page 1" }), "", "a helper with no name is called by its title: no role to repeat it");
  assert.equal(roleOf({ title: "Calendar", name: "Calendar" }), "");
});

test("the strip's line counts them, says who needs you, and the light follows", () => {
  assert.equal(stripTitle(T({ working: 2, done: 1, elapsedMs: 12_000 })), "3 helpers · working · 0:12");
  assert.equal(stripTitle(T({ working: 1, needsYou: 1, done: 1, elapsedMs: 12_000 })), "3 helpers · 1 needs you · 0:12");
  assert.equal(stripTitle(T()), "3 of 3 done · 41 s");
  assert.equal(stripTitle(T({ done: 2, failed: 1 })), "2 of 3 done · 1 failed · 41 s");
  assert.equal(stripTitle(T({ members: 0, done: 0 })), "");
  assert.equal(stripTone(T({ needsYou: 1 })), "need"); assert.equal(stripTone(T({ working: 1 })), "live"); assert.equal(stripTone(T()), "idle");
  assert.deepEqual(counts(T({ working: 2, needsYou: 1, done: 0 })), { active: 3, needsYou: 1 });
  assert.equal(totalsLine(T({ done: 1, working: 2, failed: 0 })), "2 working · 1 done · 41 s");
  assert.equal(totalsLine(T({ done: 2, working: 0, needsYou: 0, members: 2, tokensIn: 60_000, tokensOut: 15_000, costMicros: 130_000 })), "2 done · 41 s · 75k tokens · $0.13");
  assert.equal(middle("Crew test: subagent 1", 16), "Crew tes…agent 1");
  assert.equal(middle("Orin", 16), "Orin");
});

test("rows sort needs you, failed, working, then the rest, and Show keeps one kind", () => {
  const rows = [M({ id: "a", state: "done", startedAt: 1 }), M({ id: "b", state: "working", startedAt: 2 }), M({ id: "c", state: "failed", startedAt: 3 }), M({ id: "d", state: "needs_you", startedAt: 4 }), M({ id: "e", state: "working", startedAt: 0 })];
  assert.deepEqual(sorted(rows).map((r) => r.id), ["d", "c", "e", "b", "a"]);
  assert.deepEqual(rows.filter((r) => shows(r, "working")).map((r) => r.id), ["b", "e"]);
  assert.equal(rows.filter((r) => shows(r, "all")).length, 5);
});

test("the timeline and Ran together come from real start and end times", () => {
  const rows = [M({ startedAt: 0, endedAt: 41_000, elapsedMs: 41_000 }), M({ startedAt: 0, endedAt: 22_000, elapsedMs: 22_000 }), M({ startedAt: 5_000, endedAt: 22_000, elapsedMs: 17_000 })];
  const tl = timeline(rows, 50_000);
  assert.equal(tl[0]!.left, 0); assert.equal(tl[0]!.width, 1);
  assert.ok(tl[2]!.left > 0.1 && tl[2]!.left < 0.13);
  assert.equal(ranTogether(rows), "Ran together: 41 s instead of 1 min 20 s");
  assert.equal(ranTogether([rows[0]!]), null, "one helper ran alone");
  assert.equal(ranTogether([...rows, M({ state: "working", elapsedMs: 3000 })]), null, "not while one still works");
  assert.equal(ranTogether([M({ startedAt: 0, endedAt: 10_000, elapsedMs: 10_000 }), M({ startedAt: 10_000, endedAt: 20_000, elapsedMs: 10_000 })]), null, "one after the other is not together");
});

test("code work shows branch and change, the model tag says what really ran, the token bar splits input from output", () => {
  assert.equal(isCode(M({ branch: "helper/invoice-dates" })), true); assert.equal(isCode(M()), false);
  assert.equal(modelTag({ model: "claude-sonnet-5-5" }), "Sonnet 5.5");
  assert.equal(modelTag({ model: "deepseek-v4.1-flash", fellBackFrom: "claude-sonnet-5-5" }), "DeepSeek V4.1 Flash (not Sonnet 5.5)");
  assert.equal(modelTag({}), "");
  assert.deepEqual(tokenSplit({ tokensIn: 750, tokensOut: 250 }), { input: 0.75, output: 0.25 });
  assert.deepEqual(tokenSplit({ tokensIn: 0, tokensOut: 0 }), { input: 0, output: 0 });
});

test("tests read as a person says them, and the keys do what the pane says", () => {
  assert.equal(testsWords(undefined), "");
  assert.equal(testsWords({ state: "running" }), "Tests running");
  assert.equal(testsWords({ state: "passing" }), "Tests passing");
  assert.equal(testsWords({ state: "passing", passed: 12 }), "12 tests passing");
  assert.equal(testsWords({ state: "failing", failed: 3 }), "3 failing");
  assert.equal(testsWords({ state: "failing" }), "Tests failing");
  const rows = [{ id: "a" }, { id: "b" }, { id: "c" }];
  assert.deepEqual(keyAction({ key: ".", metaKey: true }, rows), { kind: "stop_all" });
  assert.deepEqual(keyAction({ key: ".", ctrlKey: true }, rows), { kind: "stop_all" });
  assert.deepEqual(keyAction({ key: "2", code: "Digit2", altKey: true }, rows), { kind: "jump", id: "b" });
  assert.deepEqual(keyAction({ key: "¡", code: "Digit1", altKey: true }, rows), { kind: "jump", id: "a" }, "Option on a Mac types a symbol; the code still says which digit");
  assert.equal(keyAction({ key: "9", code: "Digit9", altKey: true }, rows), null, "no ninth helper");
  assert.equal(keyAction({ key: "2", code: "Digit2" }, rows), null, "a bare digit is just typing");
  assert.equal(keyAction({ key: ".", }, rows), null);
});

test("only a helper that needs you and holds a request gets an approval card", () => {
  const rows = [M({ id: "a", state: "needs_you", holdTaskId: "tsk_1" } as never), M({ id: "b", state: "needs_you" }), M({ id: "c", state: "working", holdTaskId: "tsk_2" } as never), M({ id: "d", state: "needs_you", holdTaskId: "" } as never)];
  assert.deepEqual(holdsOf(rows as never).map((r) => r.id), ["a"]);
});

test("a helper's face is seeded by its own id, so helpers that run as one agent still look different", () => {
  const a = M({ id: "thr_a1", agentId: "agt_assistant" }), b = M({ id: "thr_b2", agentId: "agt_assistant" });
  assert.notEqual(faceSeed(a), faceSeed(b));
  assert.equal(faceSeed(a), faceSeed(M({ id: "thr_a1", agentId: "agt_other" })), "the same helper, the same face, whoever runs it");
});

test("the coders join the strip that holds the earliest helper, and no other", () => {
  const h1 = M({ id: "h1", startedAt: 10 }), h2 = M({ id: "h2", startedAt: 50 }), mate = M({ id: "t1", kind: "teammate" as never, startedAt: 20 });
  const live = { members: [h1, h2, mate], totals: T() } as never;
  assert.deepEqual(withTeammates([h1], live).map((r) => (r as { id: string }).id), ["h1", "t1"]);
  assert.deepEqual(withTeammates([h2], live).map((r) => (r as { id: string }).id), ["h2"], "a later strip has none");
  assert.deepEqual(withTeammates([h1], null).map((r) => (r as { id: string }).id), ["h1"], "no read, no coders");
});

test("each figure of the totals sorts the helpers by it", () => {
  const rows = [M({ id: "a", elapsedMs: 5000, tokensIn: 100, tokensOut: 0, costMicros: 30_000 }), M({ id: "b", elapsedMs: 9000, tokensIn: 10, tokensOut: 0, costMicros: 90_000 }), M({ id: "c", elapsedMs: 1000, tokensIn: 900, tokensOut: 100, costMicros: 10_000 })];
  assert.deepEqual(sortedBy(rows, "time").map((r) => r.id), ["b", "a", "c"]);
  assert.deepEqual(sortedBy(rows, "tokens").map((r) => r.id), ["c", "a", "b"]);
  assert.deepEqual(sortedBy(rows, "cost").map((r) => r.id), ["b", "a", "c"]);
  assert.deepEqual(totalsParts(T({ done: 2, working: 0, needsYou: 0, members: 2, tokensIn: 60_000, tokensOut: 15_000, costMicros: 130_000 })).map((p) => [p.key, p.text]), [["state", "2 done"], ["time", "41 s"], ["tokens", "75k tokens"], ["cost", "$0.13"]]);
  assert.deepEqual(totalsParts(T({ members: 0 })), []);
});

test("Review all and Merge are not offered while any helper of the strip still works, and are offered once every helper is done; merged when every coder's branch has landed", () => {
  const coder = (state: string, merged = false) => M({ kind: "teammate" as never, state: state as never, merged });
  assert.equal(mergeStateOf([M({ state: "done" })]), "none", "no coder, no merge");
  assert.equal(mergeStateOf([coder("done"), M({ state: "working" })]), "working", "a read-only helper still works: wait");
  assert.equal(mergeStateOf([coder("working"), M({ state: "done" })]), "working");
  assert.equal(mergeStateOf([coder("done"), M({ state: "needs_you" })]), "working", "one waits for a person: wait");
  assert.equal(mergeStateOf([coder("done"), M({ state: "failed" })]), "working", "a failed helper is not done: look at it first");
  assert.equal(mergeStateOf([coder("done"), M({ state: "done" })]), "ready");
  assert.equal(mergeStateOf([coder("done", true), M({ state: "done" })]), "merged");
});

test("a row says the model and the account that pays; the header names who runs on what only when they differ", () => {
  assert.equal(rowModel({ model: "gpt-6", accountLabel: "OpenAI · Irfad's OpenAI" }), "GPT-6 · Irfad's OpenAI");
  assert.equal(rowModel({ model: "glm-5.2", accountLabel: "OpenCode Go · Space OpenCode" }), "GLM 5.2 · Space OpenCode");
  assert.equal(rowModel({ model: "claude-sonnet-5-5" }), "Sonnet 5.5", "no account known: the model alone");
  assert.equal(rowModel({}), "");
  assert.equal(whyWords("you asked"), "You asked");
  assert.equal(whyWords("Picked: cheap reader"), "Cheap reader");
  assert.equal(whyWords(undefined), "");
  const orin = { kind: "helper" as const, title: "Compare quotes", name: "Orin", model: "gpt-6", why: "you asked" };
  const pia = { kind: "helper" as const, title: "northwind.com", name: "Pia", model: "glm-5.2", why: "you asked" };
  assert.equal(modelsLine([orin, pia]), "Orin on GPT-6 (you asked), Pia on GLM 5.2 (you asked)");
  assert.equal(modelsLine([orin, { ...pia, model: "gpt-6" }]), "", "one model: the rows already say it");
  assert.equal(modelsLine([orin, { ...pia, model: undefined }]), "", "a model not known yet: nothing to compare");
  assert.equal(modelsLine([orin, { ...pia, why: undefined }]), "Orin on GPT-6 (you asked), Pia on GLM 5.2", "no reason, no brackets");
});
