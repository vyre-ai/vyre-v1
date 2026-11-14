// The new tab page as a person uses it: type, press Enter. His words and the tab's name show in the same act as the key; the Ask is its own row with its chord; a moved selection opens its result.
import test from "node:test";
import assert from "node:assert/strict";
import { act } from "react";
import { createRoot } from "test-renderer";
import { View, Text } from "react-native";
import { installDom, mount, find, textOf, typeInto, press } from "../../../../../ui/src/testing/dom.ts";
import { NewTabSearch } from "./CmdK.tsx";
import { createSampleData } from "./sample.ts";
import type { CmdKData } from "./controller.ts";

const keyEvent = (key: string, extra: Record<string, unknown> = {}) => ({
  key,
  ...extra,
  nativeEvent: { key, isComposing: false, ...extra },
  target: { blur() {} },
  currentTarget: { blur() {} },
  preventDefault() {},
  stopPropagation() {},
  isDefaultPrevented: () => false,
  isPropagationStopped: () => false,
  persist() {},
});

async function page(o: { fail?: boolean } = {}) {
  const { data, calls } = createSampleData({ ask: true, serverDelayMs: 5 });
  const started: { key: string; text: string }[] = [];
  let warmed = 0;
  const d: CmdKData = {
    ...data,
    warm: () => {
      warmed += 1;
    },
    newKey: () => `key_${started.length + 1}`,
    startChat: (c) => {
      started.push(c);
      return { title: c.text, sent: o.fail ? Promise.reject(new Error("x")) : new Promise<void>(() => undefined) };
    },
  };
  const restore = installDom();
  const root = await mount(
    createRoot,
    <NewTabSearch
      data={d}
      chatView={(c, a) => (
        <View testID="pending-view">
          <Text testID="pending-text">{c.text}</Text>
          <Text testID="pending-phase">{c.phase}</Text>
          <Text testID="pending-retry" onPress={a.retry}>
            retry
          </Text>
          <Text testID="pending-discard" onPress={a.discard}>
            discard
          </Text>
        </View>
      )}
    />,
  );
  const input = () => find(root, "cmdk-input")!;
  const type = async (t: string) => {
    await typeInto(input(), t);
  };
  const pressKey = async (key: string, extra: Record<string, unknown> = {}) => {
    await act(async () => {
      (input().props.onKeyDown as (e: unknown) => void)(keyEvent(key, extra));
    });
  };
  return { root, type, pressKey, started, calls, restore, warmed: () => warmed };
}

test("type Heyy, press Enter: his words and the working state are on screen in the same act, once, and the page was warmed when it opened", async () => {
  const p = await page();
  try {
    assert.equal(p.warmed(), 1);
    await p.type("Heyy");
    assert.match(textOf(p.root), /Press Enter to start a chat/);
    await p.pressKey("Enter");
    assert.equal(textOf(find(p.root, "pending-text")!), "Heyy");
    assert.equal(textOf(find(p.root, "pending-phase")!), "sending");
    assert.equal(find(p.root, "cmdk-input"), null, "the search is gone: this tab is the chat");
    assert.deepEqual(p.started, [{ key: "key_1", text: "Heyy" }]);
  } finally {
    p.restore();
  }
});

test("Enter on an empty box does nothing; Enter with words and the arrow moved opens the result; the Ask row carries its chord and Alt+Enter runs the Ask", async () => {
  const p = await page();
  try {
    await p.pressKey("Enter");
    assert.equal(find(p.root, "pending-view"), null);
    assert.deepEqual(p.started, []);
    await p.type("what did Elena say about the referral fee");
    assert.match(textOf(p.root), /⌥⏎/, "the chord is shown on the Ask row");
    await p.pressKey("Enter", { altKey: true });
    assert.deepEqual(p.calls.asked, ["what did Elena say about the referral fee"]);
    assert.equal(p.started.length, 0);
    const q = await page();
    try {
      await q.type("referral");
      await q.pressKey("ArrowDown");
      await q.pressKey("Enter");
      assert.equal(q.started.length, 0);
      assert.equal(q.calls.opened.length, 1);
    } finally {
      q.restore();
    }
  } finally {
    p.restore();
  }
});

test("a failed start shows its failed state; Retry sends the same key; Discard brings the search back with his words in the field", async () => {
  const p = await page({ fail: true });
  try {
    await p.type("Heyy");
    await p.pressKey("Enter");
    await act(async () => {
      await new Promise((r) => setTimeout(r, 5));
    });
    assert.equal(textOf(find(p.root, "pending-phase")!), "failed");
    await press(find(p.root, "pending-retry"));
    assert.deepEqual(
      p.started.map((s) => s.key),
      ["key_1", "key_1"],
    );
    await act(async () => {
      await new Promise((r) => setTimeout(r, 5));
    });
    await press(find(p.root, "pending-discard"));
    assert.equal(find(p.root, "pending-view"), null);
    assert.equal(find(p.root, "cmdk-input")!.props.value, "Heyy");
  } finally {
    p.restore();
  }
});

test("Enter that confirms a word in an input method (isComposing, or keyCode 229) never starts a chat; the same key after the composition does", async () => {
  const p = await page();
  try {
    await p.type("こんにちは");
    await p.pressKey("Enter", { isComposing: true });
    await p.pressKey("Enter", { keyCode: 229 });
    assert.equal(p.started.length, 0, "no chat while composing");
    assert.equal(find(p.root, "pending-view"), null);
    await p.pressKey("Enter");
    assert.equal(p.started.length, 1);
  } finally {
    p.restore();
  }
});
