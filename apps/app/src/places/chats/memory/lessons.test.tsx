// Learn from every correction, in the chat (owner approval 3 Nov 2026): the quiet "Learned: ..." line under the message that taught a lesson (only-you, Undo, See), "Used a lesson" under the reply that
// followed it, the lesson list in the Knows tab (Edit, Where it came from, Share with the Space, Make it an instruction, Forget, and the switch), and the writes behind each. Rendered from the Brooks
// weekly update sample with the Assistant's lessons added; every write goes through the store and the next read shows it.
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { Composer } from "../../../../../../ui/src/Composer/index.tsx";
import { installComposerForTests } from "../../../../../../ui/src/Composer/Deferred.tsx";
import { Conversation } from "../conversation/Conversation.tsx";
import { ChatRightPane } from "../rightpane/ChatRightPane.tsx";
import { makeInstruction, setLessonSwitch, shareLesson, undoLearned } from "./actions.ts";
import type { Say } from "./actions.ts";
import { HOW_TEXT, LESSONS_FOOT, LESSONS_HEAD, SCOPE_TEXT, isLesson, lessonUsedLine, messageOf, usedTimes } from "./model.ts";
import { ASSISTANT, LESSON_IDS, MESSAGE_IDS, createChatMemorySample } from "./sample.ts";
import type { ChatMemorySample } from "./sample.ts";
import { ChatMemoryProvider } from "./thread.tsx";
import { ReplyMemory } from "./Used.tsx";

installComposerForTests(Composer);

const clean = (s: string): string => s.replaceAll("<!-- -->", "").replaceAll("&#x27;", "'").replaceAll("&quot;", '"').replaceAll("&amp;", "&");
const has = (s: string, n: string): boolean => s.includes(n);
const KNOWS_READS = (): Array<[string, unknown]> => [
  ["memory.knows", { threadId: "c1", agentId: ASSISTANT }], ["memory.facts.list", { status: ["proposed"], layer: "agent", agentId: ASSISTANT }], ["memory.map.get", { agentId: ASSISTANT }],
  ["memory.used", { threadId: "c1", messageId: MESSAGE_IDS.reply }], ["memory.used", { threadId: "c1", messageId: MESSAGE_IDS.held }],
  ["memory.facts.list", { status: ["current"], agentId: ASSISTANT, kind: "lesson" }], ["memory.facts.list", { status: ["current"], agentId: ASSISTANT }], ["settings.get", { key: "memory.lessons" }],
];
const withWarm = async (): Promise<ChatMemorySample> => { const s = createChatMemorySample({ lessons: true }); await s.warm(KNOWS_READS()); return s; };
const chat = (s: ChatMemorySample): string => clean(renderToStaticMarkup(<Conversation data={s.data} />));
const pane = async (s: ChatMemorySample): Promise<string> => { await s.warm(KNOWS_READS()); return clean(renderToStaticMarkup(<ChatRightPane data={s.pane} open onToggle={() => undefined} tab="memory" paneWidth={340} window={{ start: 0, end: 500 }} />)); };
const says = (): { say: Say; lines: Array<{ text: string; undo?: () => void | Promise<unknown> }> } => { const lines: Array<{ text: string; undo?: () => void | Promise<unknown> }> = []; return { lines, say: (text, undo) => void lines.push({ text, ...(undo ? { undo } : {}) }) }; };

test("the pure rules: a lesson is a fact of kind lesson, its message is the line its link names, and the words are plain", () => {
  assert.equal(isLesson({ kind: "lesson" }), true);
  assert.equal(isLesson({ kind: "preference" }), false);
  assert.equal(isLesson({}), false);
  assert.equal(messageOf({ sourceRef: "thr_1", sourceLink: "/chats/thr_1#msg_7" }), "msg_7", "a fact learned after a turn belongs to the line it was learned from");
  assert.equal(messageOf({ sourceRef: "msg_9", sourceLink: "vyre://thread/thr_1?m=msg_9" }), "msg_9", "a fact remembered from one message keeps that message");
  assert.equal(messageOf({ sourceRef: "msg_3" }), "msg_3");
  assert.deepEqual(Object.keys(HOW_TEXT).sort(), ["edit", "refuse", "reverse", "rewrite"]);
  assert.deepEqual(SCOPE_TEXT, { you: "Only you", proposed: "Proposed", space: "Space" });
  assert.equal(usedTimes(1), "used 1 time");
  assert.equal(usedTimes(4), "used 4 times");
  assert.equal(LESSONS_HEAD("Mira"), "Lessons Mira kept from your corrections");
  assert.equal(lessonUsedLine("Notes to Sara"), "Used a lesson: Notes to Sara");
  for (const t of [LESSONS_FOOT, ...Object.values(HOW_TEXT), ...Object.values(SCOPE_TEXT)]) assert.ok(!/—|§/.test(t), t);
});

test("the message that taught a lesson has 'Learned: <lesson> · Only you · Undo · See'", async () => {
  const s = await withWarm();
  const out = chat(s);
  assert.ok(has(out, `data-testid="learned-line-${LESSON_IDS.sara}"`));
  for (const needle of ["Learned:", "Notes to Sara: three lines, the number first.", `data-testid="learned-scope-${LESSON_IDS.sara}"`, "Only you", `data-testid="learned-undo-${LESSON_IDS.sara}"`, `data-testid="learned-see-${LESSON_IDS.sara}"`]) assert.ok(has(out, needle), needle);
  assert.ok(!has(out, `data-testid="learned-edit-btn-${LESSON_IDS.sara}"`), "a lesson is edited in Knows, so the line says See");
});

test("Undo on the line forgets the lesson; it becomes 'Moved to Trash. Restore' and the Knows list no longer has it", async () => {
  const s = await withWarm();
  chat(s);
  assert.equal(await undoLearned(s.memory, LESSON_IDS.sara), null);
  await s.warm(KNOWS_READS());
  const out = await pane(s);
  assert.ok(!has(out, "Notes to Sara: three lines, the number first."), "gone from the lessons list");
  assert.ok(has(out, "Round money in notes to whole dollars."), "the other lesson stays");
});

test("a reply that was given a lesson says so on a line of its own, whatever its words; the count of memories leaves it out", async () => {
  const s = await withWarm();
  const out = clean(renderToStaticMarkup(<ChatMemoryProvider memory={s.memory} threadId="c1"><ReplyMemory messageId={MESSAGE_IDS.reply} threadId="c1" reply="Sure, done." /></ChatMemoryProvider>));
  assert.ok(has(out, `data-testid="mused-lesson-${LESSON_IDS.sara}"`));
  assert.ok(has(out, "Used a lesson") && has(out, "Notes to Sara: three lines, the number first."));
  // the sample's reply recalled one exact quote; the lesson is not counted beside it
  assert.ok(has(out, "Used 1 memory") && !has(out, "Used 2 memories"), `the lesson is not one of the counted memories: ${out.match(/Used \d+ memor[a-z]*/)?.[0]}`);
});

test("Knows: the lessons the agent kept, each with how it was caught, when, how often it was used and who may read it, and the switch", async () => {
  const out = await pane(await withWarm());
  assert.ok(has(out, "Lessons Assistant kept from your corrections"));
  assert.ok(has(out, 'data-testid="lessons-switch"') && has(out, "Learn from my corrections"));
  for (const id of Object.values(LESSON_IDS)) assert.ok(has(out, `data-testid="lesson-${id}"`), id);
  assert.ok(has(out, "Said no") && has(out, "Rewrote an answer"));
  assert.ok(has(out, "used 1 time") && has(out, "used 4 times"));
  assert.ok(has(out, `data-testid="lesson-scope-${LESSON_IDS.sara}"`) && has(out, "Only you") && has(out, ">Space<"));
  assert.ok(has(out, LESSONS_FOOT));
  // each lesson has its actions; one already shared with the Space cannot be shared again
  for (const a of ["edit", "from", "make", "forget"]) assert.ok(has(out, `data-testid="lesson-${a}-${LESSON_IDS.sara}"`) && has(out, `data-testid="lesson-${a}-${LESSON_IDS.dollars}"`), a);
  assert.ok(has(out, `data-testid="lesson-share-${LESSON_IDS.sara}"`) && !has(out, `data-testid="lesson-share-${LESSON_IDS.dollars}"`));
  // a lesson is not also a fact in the You group
  assert.ok(!has(out, `data-testid="know-text-${LESSON_IDS.sara}"`) && !has(out, `data-testid="know-${LESSON_IDS.sara}"`));
});

test("Share with the Space goes through the ordinary promotion and says it waits; Make it an instruction adds one line with Undo; the switch has Undo", async () => {
  const s = await withWarm();
  const a = says();
  await shareLesson(s.memory, LESSON_IDS.sara, ASSISTANT, a.say);
  assert.deepEqual(s.calls.filter((c) => c.cap === "memory.promote").map((c) => c.input), [{ factId: LESSON_IDS.sara, toLayer: "agent", agentId: ASSISTANT }]);
  assert.equal(a.lines[0]!.text, "Sent to Proposed. A person accepts it first.");
  await s.warm(KNOWS_READS());
  assert.ok(has(await pane(s), "Proposed"), "the chip now says Proposed");

  const b = says();
  await makeInstruction(s.memory, ASSISTANT, "Notes to Sara: three lines, the number first.", b.say);
  assert.deepEqual(s.calls.filter((c) => c.cap === "agents.instruction.append").map((c) => c.input), [{ agentId: ASSISTANT, line: "Notes to Sara: three lines, the number first." }]);
  assert.equal(b.lines[0]!.text, "Added to the agent's instructions as a new version.");
  await b.lines[0]!.undo!();
  assert.deepEqual(s.calls.filter((c) => c.cap === "agents.restore_version").map((c) => c.input), [{ agentId: ASSISTANT, versionId: "ver_1", file: "AGENT.md" }]);

  const c = says();
  await setLessonSwitch(s.memory, false, c.say);
  await s.warm(KNOWS_READS());
  const off = await pane(s);
  assert.ok(has(off, 'data-testid="lessons-off"') && has(off, "Off. Nothing is kept from what you change."));
  assert.ok(!has(off, `data-testid="lesson-${LESSON_IDS.sara}"`), "off hides the list");
  await c.lines[0]!.undo!();
  await s.warm(KNOWS_READS());
  assert.ok(has(await pane(s), `data-testid="lesson-${LESSON_IDS.sara}"`));
});

test("an older server with no lessons draws nothing new: no lesson lines, no section", async () => {
  const s = createChatMemorySample();
  await s.warm(KNOWS_READS());
  const out = await pane(s);
  assert.ok(!has(out, "kept from your corrections") && !has(out, "lessons-switch"));
  assert.ok(!has(chat(s), "learned-scope-"));
});
