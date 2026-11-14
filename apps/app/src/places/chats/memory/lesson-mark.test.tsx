// The quiet lesson mark on a message's meta row and the small list it opens (owner, 14 Nov 2026): one lesson per line cut with an ellipsis, a press on the words shows all of it, See opens Knows,
// Remove forgets it (Undo on its row), Escape and a press outside close it. Pressed for real in a rendered tree.
import test from "node:test";
import assert from "node:assert/strict";
import { createRoot } from "test-renderer";
import { find, flush, installDom, mount, press, textOf } from "../../../../../../ui/src/testing/dom.ts";
import type { Node } from "../../../../../../ui/src/testing/dom.ts";
import { pushEscapeLayer } from "../../../../../../ui/src/Overlay/escape.ts";
import { createMemoryStore } from "./data.tsx";
import { useThreadMemory } from "./thread.tsx";
import { useEffect } from "react";
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

test("a line is cut to two rows and a press on its words shows all of it; See opens Knows; Remove turns the row into 'Removed. Undo' and Undo puts it back", async () => {
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
    assert.match(says(), /Show all of it\.?$/, "cut to two rows until pressed");
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
    assert.ok(find(root, "lesson-list-m1"), "Remove leaves the list open");
    assert.ok(find(root, `lesson-removed-${LESSON_IDS.dollars}`), "the row says it was removed");
    assert.equal(find(root, `lesson-remove-${LESSON_IDS.dollars}`), null);
    assert.ok(find(root, `lesson-row-${LESSON_IDS.sara}`), "the other lesson is untouched");
    await flush();
    await flush();
    await press(find(root, `lesson-undo-${LESSON_IDS.dollars}`)!);
    await flush();
    assert.deepEqual(
      s.calls.filter((c) => c.cap === "memory.restore").map((c) => c.input),
      [{ factId: LESSON_IDS.dollars }],
      "Undo puts it back",
    );
    assert.ok(find(root, `lesson-remove-${LESSON_IDS.dollars}`), "and the row is a lesson again");
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

test("with a layer drawn over the list, one Escape closes that layer and leaves the list; the next closes the list", async () => {
  const off = installDom();
  const doc = (globalThis as { document: { addEventListener: unknown; removeEventListener: unknown } }).document;
  const handlers = new Set<(e: { key: string; stopPropagation?: () => void; defaultPrevented?: boolean }) => void>();
  doc.addEventListener = (t: string, f: never) => {
    if (t === "keydown") handlers.add(f);
  };
  doc.removeEventListener = (t: string, f: never) => {
    if (t === "keydown") handlers.delete(f);
  };
  let drop: () => void = () => undefined;
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
    assert.ok(find(root, "lesson-list-m1"), "the list opened");
    // the list took its place in the shared Escape stack: a keydown listener is installed for it
    assert.ok(handlers.size > 0, "the open list is a layer of the shared Escape stack (useEscapeLayer)");
    let over = 0;
    drop = pushEscapeLayer(() => {
      over++;
      drop();
    });
    const { act } = await import("react");
    const esc = async (): Promise<void> => {
      await act(async () => {
        let stopped = false;
        for (const h of [...handlers]) if (!stopped) h({ key: "Escape", stopPropagation: () => (stopped = true) });
      });
      await flush();
    };
    await esc();
    assert.equal(over, 1, "the layer over the list took the first Escape");
    assert.ok(find(root, "lesson-list-m1"), "the list is still open after the first Escape");
    await esc();
    assert.equal(find(root, "lesson-list-m1"), null, "the second Escape closes the list");
  } finally {
    drop();
    off();
  }
});

/** A memory whose forget is held until `release()` (or refused with `refuse`), over the sample's other answers. */
function slowForget(refuse?: string) {
  const { s, memory, lessons } = setup();
  let release: () => void = () => undefined;
  const held = new Promise<void>((r) => (release = r));
  const store = createMemoryStore(async (cap, input) => {
    if (cap === "memory.forget") {
      s.calls.push({ cap, input });
      await held;
      if (refuse) throw new Error(refuse);
      return { forgotten: 1 };
    }
    return s.memory.store.call(cap, input);
  });
  return { s, memory: { ...memory, store }, lessons, release };
}

test("a failed Remove puts the row back and says why: it never shows Removed for something the server refused", async () => {
  const off = installDom();
  try {
    const { memory, lessons, release } = slowForget("The server refused it.");
    const root = await mount(
      createRoot,
      <ChatMemoryProvider memory={memory} threadId="c1">
        <LessonMark id="m1" kind="used" lessons={lessons} />
      </ChatMemoryProvider>,
    );
    await flush();
    await press(find(root, "lesson-mark-m1")!);
    await flush();
    await press(find(root, `lesson-remove-${LESSON_IDS.dollars}`)!);
    await flush();
    assert.ok(find(root, `lesson-removing-${LESSON_IDS.dollars}`), "while the call waits the row says Removing");
    assert.equal(find(root, `lesson-removed-${LESSON_IDS.dollars}`), null, "and not Removed");
    release();
    await flush();
    await flush();
    assert.equal(find(root, `lesson-removed-${LESSON_IDS.dollars}`), null, "a refused call is never Removed");
    assert.ok(find(root, `lesson-remove-${LESSON_IDS.dollars}`), "the row is a lesson again, with Remove");
    assert.match(
      textOf(find(root, `lesson-error-${LESSON_IDS.dollars}`)),
      /refused|forget/i,
      "and the reason is in the list",
    );
  } finally {
    off();
  }
});

test("Undo is not offered until the forget has returned; a quick press cannot leave a forgotten lesson under a normal row", async () => {
  const off = installDom();
  try {
    const { s, memory, lessons, release } = slowForget();
    const root = await mount(
      createRoot,
      <ChatMemoryProvider memory={memory} threadId="c1">
        <LessonMark id="m1" kind="used" lessons={lessons} />
      </ChatMemoryProvider>,
    );
    await flush();
    await press(find(root, "lesson-mark-m1")!);
    await flush();
    await press(find(root, `lesson-remove-${LESSON_IDS.dollars}`)!);
    await flush();
    assert.equal(
      find(root, `lesson-undo-${LESSON_IDS.dollars}`),
      null,
      "no Undo to press while the forget is still on its way",
    );
    release();
    await flush();
    await flush();
    assert.ok(find(root, `lesson-undo-${LESSON_IDS.dollars}`), "Undo appears once it has returned");
    await press(find(root, `lesson-undo-${LESSON_IDS.dollars}`)!);
    await flush();
    assert.deepEqual(
      s.calls.filter((c) => c.cap === "memory.restore").map((c) => c.input),
      [{ factId: LESSON_IDS.dollars }],
    );
  } finally {
    off();
  }
});

test("an Undo on the memory flash line that fails says so, never silently", async () => {
  const off = installDom();
  try {
    const { memory } = setup();
    function Flasher() {
      const t = useThreadMemory();
      useEffect(() => {
        t?.flash("Saved.", async () => {
          throw new Error("The server said no.");
        });
      }, []); // eslint-disable-line react-hooks/exhaustive-deps
      return null;
    }
    const root = await mount(
      createRoot,
      <ChatMemoryProvider memory={memory} threadId="c1">
        <Flasher />
      </ChatMemoryProvider>,
    );
    await flush();
    await press(find(root, "memory-flash-undo")!);
    await flush();
    await flush();
    assert.match(textOf(find(root, "memory-flash")), /no|could not/i, "the flash now says the Undo failed");
    assert.equal(find(root, "memory-flash-undo"), null, "and offers no Undo of a failed Undo");
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
