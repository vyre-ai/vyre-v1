// Where a command's result goes (CMD-RESULTS-2026-11-13, rules 3 and 4): a one-line result is a notice in the title bar's slot with Undo where it can be undone, Escape closes it, nothing
// stays above the composer; /model opens the composer's own model menu. Driven through the real conversation and its composer.
import test from "node:test";
import assert from "node:assert/strict";
import { act } from "react";
import { createRoot } from "test-renderer";
import { Dimensions } from "react-native";
import { find, flush, installDom, mount, press, textOf, typeInto } from "../../../../../../ui/src/testing/dom.ts";
import type { Node } from "../../../../../../ui/src/testing/dom.ts";
import { Composer } from "../../../../../../ui/src/Composer/index.tsx";
import { installComposerForTests } from "../../../../../../ui/src/Composer/Deferred.tsx";
import { escapeLayers } from "../../../../../../ui/src/Overlay/escape.ts";
import { notices } from "../../../shell/noticeslot/model.ts";
import { Conversation } from "./Conversation.tsx";
import { createSample } from "./sample.ts";
import { lastActionable } from "./commands.ts";
import type { Message } from "./model.ts";

installComposerForTests(Composer);
Dimensions.set({
  window: { width: 1280, height: 800, scale: 1, fontScale: 1 },
  screen: { width: 1280, height: 800, scale: 1, fontScale: 1 },
});

const key = (k: string) => ({
  key: k,
  nativeEvent: { key: k },
  target: {},
  stopPropagation() {},
  preventDefault() {},
  isDefaultPrevented: () => false,
});
const enter = async (n: Node | null): Promise<void> => {
  await act(async () => {
    (n!.props.onKeyDown as (e: unknown) => void)(key("Enter"));
  });
  await flush();
};
const clearNotices = (): void => {
  for (const n of notices.getSnapshot().live) notices.resolve(n.id);
};
/** The test document (installDom's) made to keep the capture listeners, so the layer ui/Overlay/escape registers can be pressed the way a browser would. */
function fakeDocument(): { press(key: string): void; restore(): void } {
  type Fn = (e: { key?: string; preventDefault?: () => void; stopPropagation?: () => void }) => void;
  const d = (globalThis as { document: Record<string, unknown> }).document;
  const was = { add: d["addEventListener"], remove: d["removeEventListener"] };
  const cap = new Set<Fn>();
  d["addEventListener"] = (_t: string, f: Fn, c?: boolean) => void (c && cap.add(f));
  d["removeEventListener"] = (_t: string, f: Fn, c?: boolean) => void (c && cap.delete(f));
  return {
    press: (key) => {
      for (const f of [...cap]) f({ key, preventDefault() {}, stopPropagation() {} });
    },
    restore: () => {
      d["addEventListener"] = was.add;
      if (was.remove === undefined) delete d["removeEventListener"];
      else d["removeEventListener"] = was.remove;
    },
  };
}
async function command(root: Parameters<typeof find>[0], text: string): Promise<void> {
  const field = find(root, "composer-field");
  await typeInto(field, text);
  await enter(find(root, "composer-field"));
}

test("/pin says what it did in the title bar's slot with an Undo that does the opposite, and nothing is drawn above the composer", async () => {
  const restore = installDom();
  try {
    clearNotices();
    const s = createSample("idle");
    const calls: Array<{ cap: string; input: Record<string, unknown> }> = [];
    const data = {
      ...s.data,
      call: (cap: string, input: unknown) => {
        calls.push({ cap, input: input as Record<string, unknown> });
        return s.data.call(cap, input);
      },
    };
    const root = await mount(createRoot, <Conversation data={data} />);
    await command(root, "/pin");
    const live = notices.getSnapshot().live;
    assert.equal(live.length, 1);
    assert.match(live[0]!.text, /^(Pinned|Unpinned) the last message$/);
    assert.equal(live[0]!.action?.label, "Undo");
    assert.equal(find(root, "conversation-line"), null, "no line above the composer");
    assert.equal(find(root, "composer-field")!.props.value, "", "the command is not left in the field");
    const was = calls.find((c) => c.cap === "chat.pin" || c.cap === "chat.unpin")!.cap;
    live[0]!.action!.run();
    await flush();
    const target = lastActionable(
      (
        s.data.screens.query("chats.conversation", "messages", { threadId: s.data.threadId }).getSnapshot() as {
          data: { messages: Message[] };
        }
      ).data.messages,
    )!;
    const pins = calls.filter((c) => c.cap === "chat.pin" || c.cap === "chat.unpin");
    assert.equal(pins.at(-1)!.cap, was === "chat.pin" ? "chat.unpin" : "chat.pin", "Undo does the opposite");
    assert.equal(pins.at(-1)!.input["messageId"], target.messageId);
    assert.equal(notices.getSnapshot().live.length, 0, "pressing Undo clears the line");
  } finally {
    clearNotices();
    restore();
  }
});

test("a command's line is replaced by the next one and closes with Escape, which then reaches whatever is below", async () => {
  const restore = installDom();
  let cleanup = (): void => undefined;
  try {
    clearNotices();
    const s = createSample("idle");
    const doc = fakeDocument();
    cleanup = doc.restore;
    const root = await mount(createRoot, <Conversation data={s.data} />);
    await command(root, "/plan on");
    assert.equal(
      notices
        .getSnapshot()
        .live.map((n) => n.text)
        .join(),
      "Plan mode is on",
    );
    await command(root, "/plan off");
    assert.equal(
      notices
        .getSnapshot()
        .live.map((n) => n.text)
        .join(),
      "Plan mode is off",
      "one line at a time",
    );
    const layers = escapeLayers();
    assert.ok(layers >= 1, "Escape has a layer while the line shows");
    await act(async () => doc.press("Escape"));
    assert.equal(notices.getSnapshot().live.length, 0, "Escape closes it");
    assert.equal(escapeLayers(), layers - 1, "and gives its layer back, so a later Escape reaches whatever is below");
  } finally {
    cleanup();
    clearNotices();
    restore();
  }
});

test("a failed command is a line with Retry that runs it again", async () => {
  const restore = installDom();
  try {
    clearNotices();
    const s = createSample("idle");
    let fail = true;
    const data = {
      ...s.data,
      call: (cap: string, input: unknown) => {
        if (cap === "chat.fork" && fail) return Promise.reject(new Error("chat.fork"));
        if (cap === "chat.fork") return Promise.resolve({ thread: { threadId: "thr_fork" }, copied: 1 });
        return s.data.call(cap, input);
      },
    };
    const root = await mount(createRoot, <Conversation data={data} />);
    await command(root, "/fork");
    const n = notices.getSnapshot().live[0]!;
    assert.equal(n.text, "/fork did not work.");
    assert.equal(n.action?.label, "Retry");
    fail = false;
    n.action!.run();
    await flush();
    assert.equal(notices.getSnapshot().live.length, 0, "it worked: no failure line is left");
  } finally {
    clearNotices();
    restore();
  }
});

test("/model opens the composer's own model menu, not a second picker", async () => {
  const restore = installDom();
  try {
    clearNotices();
    const s = createSample("idle");
    const root = await mount(createRoot, <Conversation data={s.data} />);
    assert.equal(find(root, "composer-panel"), null);
    await command(root, "/model");
    assert.ok(find(root, "composer-panel"), "the composer's menu is open");
    assert.equal(find(root, "menu-item-Model"), null, "no second menu");
    assert.equal(notices.getSnapshot().live.length, 0, "and it says nothing");
  } finally {
    clearNotices();
    restore();
  }
});
