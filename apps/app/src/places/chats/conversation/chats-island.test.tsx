// The question island: the open questions agents asked in a chat sit docked to the top of its composer. The newest shows; the first answer is the primary action, Other holds the rest and a box for words,
// the people icon and dismiss are there, and "1 of 3" steps between questions. Answering sends chat.answer_block through the page's own call.
import test from "node:test";
import assert from "node:assert/strict";
import { createRoot } from "test-renderer";
import { Dimensions } from "react-native";
import { renderToStaticMarkup } from "react-dom/server";
import { find, flush, installDom, mount, press, textOf, typeInto } from "../../../../../../ui/src/testing/dom.ts";
import { Composer } from "../../../../../../ui/src/Composer/index.tsx";
import { installComposerForTests } from "../../../../../../ui/src/Composer/Deferred.tsx";
import { Conversation } from "./Conversation.tsx";
import { QuestionIsland } from "./QuestionIsland.tsx";
import { islandView, openQuestions } from "./island.ts";
import type { OpenQuestion } from "./island.ts";
import { createSample } from "./sample.ts";
import type { Message } from "./model.ts";

installComposerForTests(Composer);
Dimensions.set({ window: { width: 1280, height: 800, scale: 1, fontScale: 1 }, screen: { width: 1280, height: 800, scale: 1, fontScale: 1 } });

const clean = (s: string): string => s.replaceAll("<!-- -->", "").replaceAll("&#x27;", "'").replaceAll("&quot;", '"').replaceAll("&amp;", "&");
const q = (id: string, at: number, over: Record<string, unknown> = {}, state = "waiting", who = "agt_intake"): Message => ({
  messageId: `m_${id}`, threadId: "c1", threadSeq: at, author: { kind: "agent", id: who }, kind: "agent", body: "", depth: 0, attachments: [], reactions: [], pinned: false, createdAt: at,
  blocks: [{ type: "question", v: 1, id, state, data: { prompt: `Question ${id}?`, options: [{ key: "a", label: "Yes" }, { key: "b", label: "No" }, { key: "c", label: "Later" }], ...over }, traceId: `tr_${id}` }],
}) as unknown as Message;

test("the open questions of a chat: waiting question blocks from agents, oldest first; answered, terminal and mount asks are left out", () => {
  const list = openQuestions([
    q("q2", 20), q("q1", 10),
    q("done", 5, {}, "done"), q("ans", 6, { answer: "a" }),
    q("term", 7, { card: { kind: "terminal", command: "ls", risk: "read" } }),
    q("mnt", 8, { options: [{ key: "mount:google_drive", label: "Google Drive" }] }),
    q("noprompt", 9, { prompt: "" }),
  ]);
  assert.deepEqual(list.map((x) => x.id), ["q1", "q2"]);
  assert.deepEqual(list[0]!.options.map((o) => o.id), ["a", "b", "c"]);
});

test("the island shows the newest not put away; stepping picks another; a put-away one is not in the list", () => {
  const all = openQuestions([q("q1", 10), q("q2", 20), q("q3", 30)]);
  assert.equal(islandView(all, new Set(), null).index, 2, "the newest");
  assert.deepEqual(islandView(all, new Set(), "q1"), { list: all, index: 0 });
  const v = islandView(all, new Set(["q3"]), null);
  assert.deepEqual([v.list.length, v.index], [2, 1], "q3 is away: q2 is the newest");
  assert.equal(islandView(all, new Set(["q1", "q2", "q3"]), null).list.length, 0);
});

function island(list: OpenQuestion[], index: number) {
  const log: string[] = [];
  const el = <QuestionIsland list={list} index={index} nameOf={(id) => (id === "agt_intake" ? "Intake" : id)} onStep={(d) => log.push(`step:${d}`)} onAnswer={(x, a) => log.push(`answer:${x.id}:${a}`)} onDismiss={(x) => log.push(`dismiss:${x.id}`)} onPeople={() => log.push("people")} />;
  return { el, log };
}

test("the island: the agent's name and question, the first answer as the primary, Other, people, dismiss; one question has no count", async () => {
  const restore = installDom();
  try {
    const { el, log } = island(openQuestions([q("q1", 10)]), 0);
    const root = await mount(createRoot, el);
    assert.match(textOf(find(root, "question-island")), /Question q1\?/);
    assert.equal(textOf(find(root, "island-primary")).trim(), "Yes");
    assert.equal(find(root, "island-count"), null, "one question: no 1 of 1");
    await press(find(root, "island-primary")); await flush();
    await press(find(root, "island-people")); await flush();
    await press(find(root, "island-dismiss")); await flush();
    assert.deepEqual(log, ["answer:q1:a", "people", "dismiss:q1"]);
  } finally { restore(); }
});

test("with three questions: '2 of 3' with arrows that step; Other lists the other answers and a box for words, which sends the words", async () => {
  const restore = installDom();
  try {
    const { el, log } = island(openQuestions([q("q1", 10), q("q2", 20), q("q3", 30)]), 1);
    const root = await mount(createRoot, el);
    assert.match(textOf(find(root, "island-count")), /2 of 3/);
    await press(find(root, "island-next")); await press(find(root, "island-prev")); await flush();
    assert.deepEqual(log, ["step:1", "step:-1"]);
    await press(find(root, "island-other")); await flush();
    assert.ok(find(root, "menu-item-No") && find(root, "menu-item-Later"), "the rest of the answers");
    await press(find(root, "menu-item-Later")); await flush();
    assert.equal(log.at(-1), "answer:q2:c");
    await press(find(root, "island-other")); await flush();
    await press(find(root, "menu-item-Write an answer…")); await flush();
    await typeInto(find(root, "island-input"), "Ask Maya first");
    await press(find(root, "island-send")); await flush();
    assert.equal(log.at(-1), "answer:q2:Ask Maya first");
  } finally { restore(); }
});

test("a chat with a waiting question draws the island above its composer; one without does not", () => {
  const s = createSample("plan");
  const out = clean(renderToStaticMarkup(<Conversation data={s.data} />));
  assert.match(out, /data-testid="question-island"/);
  assert.match(out, /Who signs the engagement letter\?/);
  assert.ok(out.indexOf('data-testid="question-island"') < out.indexOf('data-testid="composer"'), "above the composer, in its own space");
  const idle = clean(renderToStaticMarkup(<Conversation data={createSample("idle").data} />));
  assert.doesNotMatch(idle, /question-island/);
});

test("a channel keeps a fixed row above the composer for who is typing; other chats have none", () => {
  const s = createSample("channel");
  const out = clean(renderToStaticMarkup(<Conversation data={{ ...s.data, typing: ["Omar"] }} />));
  assert.match(out, /data-testid="typing-row"[^>]*>.*Omar is typing/);
  const none = clean(renderToStaticMarkup(<Conversation data={s.data} />));
  assert.match(none, /data-testid="typing-row"/, "the row is there, empty");
  assert.doesNotMatch(none, /is typing/);
  assert.doesNotMatch(clean(renderToStaticMarkup(<Conversation data={createSample("idle").data} />)), /typing-row/);
});
