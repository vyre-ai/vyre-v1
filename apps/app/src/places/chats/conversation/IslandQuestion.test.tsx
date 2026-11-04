// The Island as a question: when an agent asks, the pill is the question with its choices; a press or a number key answers (chat.answer_block through onAnswer), Other takes words, "1 of 3" and arrows
// walk several, Escape puts the pill away and leaves the question in the chat, a failed send keeps the question with a plain line, and a number typed in the composer is the composer's.
import test from "node:test";
import assert from "node:assert/strict";
import { act } from "react";
import { createRoot } from "test-renderer";
import { find, flush, installDom, mount, press, textOf, typeInto } from "../../../../../../ui/src/testing/dom.ts";
import type { Node } from "../../../../../../ui/src/testing/dom.ts";
import { createStreamStore } from "../../../../../../ui/src/stream/index.ts";
import type { LiveTurn } from "../../../shell/session/turn-streams.ts";
import { FEED_SELECTOR, Island } from "./Island.tsx";
import type { IslandProps } from "./Island.tsx";
import { cardSeen, choiceForKey, pillChoices, questionCardSelector, questionsOf } from "./island.ts";
import type { IslandQuestion } from "./island.ts";
import type { Message } from "./model.ts";

const NAMES: Record<string, string> = { agt_sol: "Sol", agt_mira: "Mira" };
const SIZE: IslandQuestion = { blockId: "blk_size", agentId: "agt_sol", name: "Sol", prompt: "How large can an upload be?", choices: [
  { id: "2gb", label: "2 GB", detail: "Recommended", recommended: true }, { id: "10gb", label: "10 GB", detail: "Needs a larger disk", recommended: false }, { id: "none", label: "No limit", detail: "Can fill up", recommended: false }], other: true };
const COLD: IslandQuestion = { blockId: "blk_cold", agentId: "agt_mira", name: "Mira", prompt: "Move old files to cold storage after 90 days?", choices: [
  { id: "90", label: "After 90 days", detail: "Recommended", recommended: true }, { id: "fast", label: "Keep everything fast", detail: "", recommended: false }], other: false };
const THIRD: IslandQuestion = { ...COLD, blockId: "blk_third", prompt: "Which region?" };
const PLAIN: IslandQuestion = { blockId: "blk_plain", agentId: "agt_sol", name: "Sol", prompt: "Which region?", choices: [
  { id: "eu", label: "Europe", detail: "", recommended: false }, { id: "us", label: "United States", detail: "", recommended: false }], other: false };
const FREE: IslandQuestion = { blockId: "blk_free", agentId: "agt_sol", name: "Sol", prompt: "What should the folder be called?", choices: [], other: true };
const working: LiveTurn = { turnId: "t_mira", threadId: "thr_1", agentId: "agt_mira", store: createStreamStore(), state: "writing", startedAt: 1_000 };

type KeyHandler = (e: Record<string, unknown>) => void;
async function show(over: Partial<IslandProps>): Promise<{ root: Node; answers: [string, string][]; key: (k: string, target?: unknown) => Promise<void>; rerender: (o: Partial<IslandProps>) => Promise<void> }> {
  const off = installDom();
  void off;
  const doc = (globalThis as { document: { addEventListener: (t: string, f: KeyHandler) => void; removeEventListener: () => void } }).document;
  const handlers: KeyHandler[] = [];
  doc.addEventListener = (_t, f) => { handlers.push(f); };
  doc.removeEventListener = () => undefined;
  const answers: [string, string][] = [];
  const base = (o: Partial<IslandProps>): IslandProps => ({ turns: [], nameOf: (id) => NAMES[id] ?? id, jobs: [], now: () => 41_000, onSteer: () => undefined, onStopJob: () => undefined, onOpenComputer: () => undefined, people: ["Sara", "Irfad"], onAnswer: (b, a) => { answers.push([b, a]); }, ...o });
  const r = createRoot();
  await act(async () => { r.render(<Island {...base(over)} />); });
  await flush();
  return {
    root: r.container as unknown as Node, answers,
    key: async (k, target) => { await act(async () => { for (const h of handlers) h({ key: k, target, preventDefault() { /* kept */ } }); }); await flush(); },
    rerender: async (o) => { await act(async () => { r.render(<Island {...base({ ...over, ...o })} />); }); await flush(); },
  };
}

test("an agent's question is the pill: the asker's waiting face, the question, its choices with the recommended one filled, Other and the people button", async () => {
  const s = await show({ questions: [SIZE] });
  assert.match(textOf(find(s.root, "island-question-text")), /How large can an upload be\?/);
  assert.match(String(find(s.root, "island-asker")!.props["aria-label"]), /Sol is waiting for your answer/);
  assert.ok(find(s.root, "island-choice-2gb"), "the recommended choice is a button");
  for (const c of ["10gb", "none"]) assert.equal(find(s.root, `island-choice-${c}`), null, `${c} stays on the card in the chat`);
  assert.ok(find(s.root, "island-other") && find(s.root, "island-people-button"));
  assert.equal(find(s.root, "island-count"), null, "one question shows no counter");
  assert.equal(find(s.root, "island-other-field"), null, "Other is closed until pressed");
  const plain = await show({ questions: [PLAIN] });
  const main = (n: Node, id: string): string => JSON.stringify(find(n, `island-choice-${id}`)!.props["style"] ?? find(n, `island-choice-${id}`)!.props["className"] ?? "");
  assert.notEqual(main(s.root, "2gb"), main(plain.root, "eu"), "the recommended choice is drawn differently from a plain one");
  assert.equal(find(s.root, "island-word"), null, "the Working pill steps aside");
});

test("pressing a choice answers with its id, and the pill goes back to Working", async () => {
  const s = await show({ questions: [SIZE], turns: [working], activityOf: () => ({ get: () => ({ startedAt: 1_000, thinking: "", steps: [], version: 1, done: false }), subscribe: () => () => undefined }) });
  await press(find(s.root, "island-choice-2gb"));
  await flush();
  assert.deepEqual(s.answers, [["blk_size", "2gb"]]);
  assert.equal(find(s.root, "island-question"), null);
  assert.match(textOf(find(s.root, "island-word")), /Thinking/);
});

test("several questions: 1 of 3, arrows walk them, and answering one leaves the rest", async () => {
  const s = await show({ questions: [SIZE, COLD, THIRD] });
  assert.match(textOf(find(s.root, "island-count")), /1 of 3/);
  await press(find(s.root, "island-next"));
  assert.match(textOf(find(s.root, "island-count")), /2 of 3/);
  assert.match(textOf(find(s.root, "island-question-text")), /cold storage/);
  await press(find(s.root, "island-prev"));
  await press(find(s.root, "island-prev"));
  assert.match(textOf(find(s.root, "island-count")), /3 of 3/);
  assert.match(textOf(find(s.root, "island-question-text")), /Which region/);
  await press(find(s.root, "island-choice-90"));
  assert.deepEqual(s.answers, [["blk_third", "90"]]);
  assert.match(textOf(find(s.root, "island-count")), /\d of 2/);
});

test("Other opens a short text field; its words are the answer", async () => {
  const s = await show({ questions: [SIZE] });
  await press(find(s.root, "island-other"));
  assert.ok(find(s.root, "island-other-field"));
  assert.equal(find(s.root, "island-other-send")!.props["disabled"], true, "nothing to send yet");
  await typeInto(find(s.root, "island-other-field"), "5 GB, and warn at 4");
  await press(find(s.root, "island-other-send"));
  await flush();
  assert.deepEqual(s.answers, [["blk_size", "5 GB, and warn at 4"]]);
  assert.equal(find(s.root, "island-question"), null);
});

test("a free-text question shows the field at once and no choices", async () => {
  const s = await show({ questions: [FREE] });
  assert.ok(find(s.root, "island-other-field"));
  assert.equal(find(s.root, "island-other"), null);
  await typeInto(find(s.root, "island-other-field"), "Client uploads");
  await press(find(s.root, "island-other-send"));
  assert.deepEqual(s.answers, [["blk_free", "Client uploads"]]);
});

test("number keys pick a choice, the arrows walk, and a key typed in the composer or a field is not the Island's", async () => {
  const s = await show({ questions: [PLAIN, COLD] });
  await s.key("2", { tagName: "DIV", isContentEditable: true });
  await s.key("2", { tagName: "TEXTAREA" });
  await s.key("2", { tagName: "DIV", closest: () => ({}) });
  assert.deepEqual(s.answers, [], "typing in the composer never answers");
  await s.key("ArrowRight", { tagName: "BODY" });
  assert.match(textOf(find(s.root, "island-count")), /2 of 2/);
  await s.key("ArrowLeft", { tagName: "BODY" });
  await s.key("9", { tagName: "BODY" });
  await s.key("3", { tagName: "BODY" });
  assert.deepEqual(s.answers, [], "a number past the last choice picks none");
  await s.key("2", { tagName: "BODY" });
  assert.deepEqual(s.answers, [["blk_plain", "us"]]);
  assert.equal(choiceForKey("1", 3), 0);
  assert.equal(choiceForKey("0", 3), null);
  assert.equal(choiceForKey("x", 3), null);
});

test("Escape closes Other first, then puts the pill away; the question stays in the chat and nothing is sent", async () => {
  const s = await show({ questions: [SIZE] });
  await press(find(s.root, "island-other"));
  await s.key("Escape");
  assert.equal(find(s.root, "island-other-field"), null, "the first Escape closes the text field");
  assert.ok(find(s.root, "island-question"));
  await s.key("Escape");
  assert.equal(find(s.root, "island"), null, "the second puts the pill away");
  assert.deepEqual(s.answers, [], "putting it away answers nothing");
});

test("a failed send keeps the question and says so in plain words; the next try works", async () => {
  let fail = true;
  const sent: string[] = [];
  const s = await show({ questions: [SIZE], onAnswer: async (_b, a) => { sent.push(a); if (fail) throw new Error("offline"); } });
  await press(find(s.root, "island-choice-2gb"));
  await flush();
  assert.ok(find(s.root, "island-question"), "the question is still there");
  assert.match(textOf(find(s.root, "island-problem")), /Could not send the answer/);
  fail = false;
  await press(find(s.root, "island-choice-2gb"));
  await flush();
  assert.deepEqual(sent, ["2gb", "2gb"]);
  assert.equal(find(s.root, "island-question"), null);
});

test("the people button lists who can answer", async () => {
  const s = await show({ questions: [SIZE] });
  assert.equal(find(s.root, "island-people"), null);
  await press(find(s.root, "island-people-button"));
  assert.match(textOf(find(s.root, "island-people")), /Sara.*Irfad/s);
});

const ask = (blocks: Message["blocks"], kind: "agent" | "person" = "agent"): Pick<Message, "author" | "blocks"> => ({ author: { id: "agt_sol", kind } as Message["author"], blocks });
const blk = (id: string, data: Record<string, unknown>, state = "waiting"): Message["blocks"][number] => ({ id, type: "question", v: 1, state, data, traceId: "" } as unknown as Message["blocks"][number]);

test("questionsOf: waiting single and free questions from agents; multi, terminal, mount, answered and a person's are left to the chat", () => {
  const nameOf = (id: string): string => NAMES[id] ?? id;
  const out = questionsOf([
    ask([blk("a", { prompt: "How large?", mode: "single", options: [{ key: "2gb", label: "2 GB", detail: "Recommended (fits most)" }, { key: "10gb", label: "10 GB" }], allowOther: true })]),
    ask([blk("b", { prompt: "Name it?", mode: "free" })]),
    ask([blk("c", { prompt: "Pick some", mode: "multi", options: [{ key: "x", label: "X" }] })]),
    ask([blk("d", { prompt: "Run this?", mode: "single", options: [{ key: "run", label: "Run" }], card: { kind: "terminal", command: "ls", risk: "read" } })]),
    ask([blk("e", { prompt: "Mount a folder", mode: "single", options: [{ key: "mount:google_drive", label: "Google Drive" }] })]),
    ask([blk("f", { prompt: "Old one", mode: "single", options: [{ key: "a", label: "A" }] }, "answered")]),
    ask([blk("g", { prompt: "From a person", mode: "single", options: [{ key: "a", label: "A" }] })], "person"),
  ], nameOf);
  assert.deepEqual(out.map((q) => q.blockId), ["a", "b"]);
  assert.equal(out[0]!.name, "Sol");
  assert.deepEqual(out[0]!.choices.map((c) => [c.id, c.recommended]), [["2gb", true], ["10gb", false]]);
  assert.equal(out[0]!.other, true);
  assert.deepEqual([out[1]!.choices.length, out[1]!.other], [0, true]);
});

test("questionsOf: the recommended index fills that option; the Recommended text is only the fallback for a question without it", () => {
  const opts = [{ key: "a", label: "A", detail: "Recommended" }, { key: "b", label: "B" }, { key: "c", label: "C" }];
  const [withIndex, without] = questionsOf([
    ask([blk("x", { prompt: "Pick", mode: "single", options: opts, recommended: 2 })]),
    ask([blk("y", { prompt: "Pick", mode: "single", options: opts })]),
  ], (id) => id);
  assert.deepEqual(withIndex!.choices.map((c) => c.recommended), [false, false, true], "the index wins over the text");
  assert.deepEqual(without!.choices.map((c) => c.recommended), [true, false, false]);
});

test("the pill offers the recommended choice alone with Other; with no recommendation it offers every choice; free text is only the field", () => {
  assert.deepEqual(pillChoices(SIZE).choices.map((c) => c.id), ["2gb"]);
  assert.equal(pillChoices(SIZE).other, true);
  assert.deepEqual(pillChoices({ ...COLD, other: false }).choices.map((c) => c.id), ["90"]);
  assert.equal(pillChoices({ ...COLD, other: false }).other, true, "Other is there whenever choices were left to the card, so every answer stays reachable");
  assert.deepEqual(pillChoices(PLAIN).choices.map((c) => c.id), ["eu", "us"]);
  assert.equal(pillChoices(PLAIN).other, false);
  assert.deepEqual([pillChoices(FREE).choices.length, pillChoices(FREE).other], [0, true]);
});

test("cardSeen: whole inside the feed (which ends at the composer), and not found is not seen", () => {
  const feed = { top: 100, bottom: 700 };
  assert.equal(cardSeen({ top: 200, bottom: 400 }, feed), true);
  assert.equal(cardSeen({ top: 60, bottom: 300 }, feed), true, "a little under the top edge still counts");
  assert.equal(cardSeen({ top: 20, bottom: 300 }, feed), false, "scrolled off the top");
  assert.equal(cardSeen({ top: 300, bottom: 690 }, feed), true, "down to the foot of the feed, which ends where the composer begins");
  assert.equal(cardSeen({ top: 300, bottom: 720 }, feed), false, "cut off by the composer");
  assert.equal(cardSeen(null, feed), false);
  assert.equal(cardSeen({ top: 200, bottom: 400 }, null), false);
});

test("a question whose card is on screen is not in the pill; it appears when the card scrolls away and goes when it is back", async () => {
  const s = await show({ questions: [SIZE], turns: [working], activityOf: () => ({ get: () => ({ startedAt: 1_000, thinking: "", steps: [], version: 1, done: false }), subscribe: () => () => undefined }) });
  const doc = (globalThis as { document: Record<string, unknown> }).document;
  const feed = { top: 100, bottom: 700 };
  let card: { top: number; bottom: number } | null = { top: 200, bottom: 400 };
  const feedEl = { getBoundingClientRect: () => feed };
  doc["querySelector"] = (q: string) => (q === questionCardSelector("blk_size") && card ? { getBoundingClientRect: () => card, closest: (c: string) => (c === FEED_SELECTOR ? feedEl : null) } : null);
  await act(async () => { await new Promise((r) => setTimeout(r, 620)); });
  await flush();
  assert.equal(find(s.root, "island-question"), null, "the card is on screen: the pill is just Working");
  assert.match(textOf(find(s.root, "island-word")), /Thinking/);
  card = { top: -300, bottom: -100 };
  await act(async () => { await new Promise((r) => setTimeout(r, 620)); });
  await flush();
  assert.ok(find(s.root, "island-question"), "the card scrolled away: the pill carries the question");
  card = { top: 200, bottom: 400 };
  await act(async () => { await new Promise((r) => setTimeout(r, 620)); });
  await flush();
  assert.equal(find(s.root, "island-question"), null, "scrolled back to the card: the pill steps aside again");
});
