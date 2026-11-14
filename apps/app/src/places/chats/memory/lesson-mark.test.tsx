// The quiet lesson mark on a message's meta row and the small list it opens (owner, 14 Nov 2026): one lesson per line cut with an ellipsis, a press on the words shows all of it, See opens Knows,
// Remove forgets it (Undo on the flash line), Escape and a press outside close it. Pressed for real in a rendered tree.
import test from "node:test";
import assert from "node:assert/strict";
import { createRoot } from "test-renderer";
import { find, flush, installDom, mount, press, textOf } from "../../../../../../ui/src/testing/dom.ts";
import type { Node } from "../../../../../../ui/src/testing/dom.ts";
import { LessonMark } from "./LessonMark.tsx";
import { LESSON_IDS, createChatMemorySample } from "./sample.ts";
import { ChatMemoryProvider } from "./thread.tsx";

const LONG =
  "Show me your draft text here first, before anything is sent, and never write to Andrey on my behalf without it";

function setup() {
  const s = createChatMemorySample({ lessons: true });
  const knows: string[] = [];
  const memory = { ...s.memory, showKnows: () => void knows.push("knows") };
  const lessons = [
    { factId: LESSON_IDS.sara, text: LONG },
    { factId: LESSON_IDS.dollars, text: "Round money in notes to whole dollars." },
  ];
  return { s, knows, memory, lessons };
}

test("the mark says how many lessons, holds none of their words, and a press opens the list where it was pressed", async () => {
  const off = installDom();
  try {
    const { memory, lessons } = setup();
    const root = await mount(
      createRoot,
      <ChatMemoryProvider memory={memory} threadId="c1">
        <LessonMark id="m1" kind="used" lessons={lessons} />
      </ChatMemoryProvider>,
    );
    await flush();
    const mark = find(root, "lesson-mark-m1")!;
    assert.ok(mark);
    assert.equal(textOf(find(root, "lesson-mark-count-m1")).trim(), "2");
    assert.ok(!textOf(root).includes("Round money"), "no lesson text in the column");
    assert.equal(find(root, "lesson-list-m1"), null, "closed until pressed");
    await press(mark);
    await flush();
    assert.ok(find(root, "lesson-list-m1"), "the list opens");
    for (const l of lessons) assert.ok(find(root, `lesson-row-${l.factId}`), l.factId);
    assert.ok(find(root, `lesson-see-${LESSON_IDS.sara}`) && find(root, `lesson-remove-${LESSON_IDS.sara}`));
    // a second press on the mark closes it
    await press(find(root, "lesson-mark-m1")!);
    await flush();
    assert.equal(find(root, "lesson-list-m1"), null);
  } finally {
    off();
  }
});

test("a line is cut to one row and a press on its words shows all of it; See opens Knows; Remove forgets it and the flash has Undo", async () => {
  const off = installDom();
  try {
    const { s, knows, memory, lessons } = setup();
    const root = await mount(
      createRoot,
      <ChatMemoryProvider memory={memory} threadId="c1">
        <LessonMark id="m1" kind="used" lessons={lessons} />
      </ChatMemoryProvider>,
    );
    await flush();
    await press(find(root, "lesson-mark-m1")!);
    await flush();
    const words = (): Node | null => find(root, `lesson-text-${LESSON_IDS.sara}`);
    const says = (): string => String(words()!.props["aria-label"]);
    assert.match(says(), /Show all of it\.?$/, "cut to one row until pressed");
    await press(words()!);
    await flush();
    assert.match(says(), /Show less\.?$/, "the whole lesson shows");
    await press(find(root, `lesson-see-${LESSON_IDS.dollars}`)!);
    await flush();
    assert.deepEqual(knows, ["knows"]);
    assert.equal(find(root, "lesson-list-m1"), null, "See closes the list");
    await press(find(root, "lesson-mark-m1")!);
    await flush();
    await press(find(root, `lesson-remove-${LESSON_IDS.dollars}`)!);
    await flush();
    assert.deepEqual(
      s.calls.filter((c) => c.cap === "memory.forget").map((c) => c.input),
      [{ factIds: [LESSON_IDS.dollars] }],
    );
    assert.equal(find(root, "lesson-list-m1"), null, "Remove closes the list");
  } finally {
    off();
  }
});

test("Escape closes the list and a press outside it closes it", async () => {
  const off = installDom();
  const doc = (globalThis as { document: { addEventListener: unknown } }).document;
  const handlers: Array<(e: { key: string }) => void> = [];
  doc.addEventListener = (t: string, f: (e: { key: string }) => void) => {
    if (t === "keydown") handlers.push(f);
  };
  try {
    const { memory, lessons } = setup();
    const root = await mount(
      createRoot,
      <ChatMemoryProvider memory={memory} threadId="c1">
        <LessonMark id="m1" kind="used" lessons={lessons} />
      </ChatMemoryProvider>,
    );
    await flush();
    await press(find(root, "lesson-mark-m1")!);
    await flush();
    assert.ok(find(root, "lesson-list-m1"));
    assert.ok(handlers.length > 0, "the list listens for Escape");
    const { act } = await import("react");
    await act(async () => {
      for (const h of handlers) h({ key: "Escape" });
    });
    await flush();
    assert.equal(find(root, "lesson-list-m1"), null, "Escape closes it");
    await press(find(root, "lesson-mark-m1")!);
    await flush();
    await press(find(root, "lesson-list-away-m1")!);
    await flush();
    assert.equal(find(root, "lesson-list-m1"), null, "a press outside closes it");
  } finally {
    off();
  }
});

test("a mark with no lessons draws nothing", async () => {
  const off = installDom();
  try {
    const { memory } = setup();
    const root = await mount(
      createRoot,
      <ChatMemoryProvider memory={memory} threadId="c1">
        <LessonMark id="m1" kind="learned" lessons={[]} />
      </ChatMemoryProvider>,
    );
    await flush();
    assert.equal(find(root, "lesson-mark-m1"), null);
  } finally {
    off();
  }
});
