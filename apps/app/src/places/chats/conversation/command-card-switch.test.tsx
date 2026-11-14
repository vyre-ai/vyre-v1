// The Command card and a chat switch, and its Take back button (findings of reviewer r-ui on a246ed2f9). Its own file: unmounting the conversation mid-test needs the test window to stay up.
import test from "node:test";
import assert from "node:assert/strict";
import { act } from "react";
import { createRoot } from "test-renderer";
import { Dimensions } from "react-native";
import { find, flush, installDom, mount, press, textOf, typeInto } from "../../../../../../ui/src/testing/dom.ts";
import type { Node } from "../../../../../../ui/src/testing/dom.ts";
import { Composer } from "../../../../../../ui/src/Composer/index.tsx";
import { installComposerForTests } from "../../../../../../ui/src/Composer/Deferred.tsx";
import { notices } from "../../../shell/noticeslot/model.ts";
import { Conversation } from "./Conversation.tsx";
import { createSample } from "./sample.ts";

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
type Heard = (e: { key?: string; target?: unknown; preventDefault?: () => void; stopPropagation?: () => void }) => void;
/** installDom's document made to keep the listeners the Escape layer and the card's press-outside register. */
function listeners(): { escape(): Promise<void>; pressAt(target: unknown): Promise<void>; restore(): void } {
  const d = (globalThis as { document: Record<string, unknown> }).document;
  const was = { add: d["addEventListener"], remove: d["removeEventListener"] };
  const keys = new Set<Heard>();
  const downs = new Set<Heard>();
  d["addEventListener"] = (t: string, f: Heard, c?: boolean) =>
    void (t === "keydown" && c ? keys.add(f) : t === "pointerdown" ? downs.add(f) : null);
  d["removeEventListener"] = (t: string, f: Heard) => void (keys.delete(f), downs.delete(f));
  return {
    escape: () =>
      act(async () => void [...keys].forEach((f) => f({ key: "Escape", preventDefault() {}, stopPropagation() {} }))),
    pressAt: (target) => act(async () => void [...downs].forEach((f) => f({ target }))),
    restore: () => {
      d["addEventListener"] = was.add;
      if (was.remove === undefined) delete d["removeEventListener"];
      else d["removeEventListener"] = was.remove;
    },
  };
}
const clearNotices = (): void => {
  for (const n of notices.getSnapshot().live) notices.resolve(n.id);
};

const MY_AI = {
  running: {
    model: "claude-sonnet-5-5",
    paid: "Work · your sign-in",
    account: { name: "Work Claude" },
    context: { used: 31_000, window: 1_000_000 },
  },
  accounts: [
    {
      name: "Work Claude",
      provider: "anthropic",
      kind: "subscription",
      usable: true,
      models: ["claude-sonnet-5-5", "claude-opus-5-5"],
      limits: { state: "read", session: { pct: 42, resetsAt: 2_000_000_000_000 }, week: { pct: 61 } },
    },
    {
      name: "OpenCode Go",
      provider: "opencode_go",
      kind: "key",
      usable: true,
      models: ["glm-5.3"],
      limits: { state: "not_readable", note: "x" },
    },
  ],
  use: {
    today: { turns: 1, input: 18_000, cachedInput: 13_000, output: 200, costMicros: 0 },
    month: { turns: 39, input: 1_500_000, cachedInput: 9_200_000, output: 176_000, costMicros: 0 },
  },
};

async function open(answers: Record<string, (i: unknown) => unknown> = {}) {
  const s = createSample("idle");
  const calls: Array<{ cap: string; input: unknown }> = [];
  const data = {
    ...s.data,
    call: (cap: string, input: unknown) => {
      calls.push({ cap, input });
      const a = answers[cap];
      return a ? Promise.resolve(a(input)) : s.data.call(cap, input);
    },
  };
  const root = await mount(createRoot, <Conversation data={data} />);
  return { root, calls, s };
}
async function command(root: Parameters<typeof find>[0], text: string): Promise<void> {
  await typeInto(find(root, "composer-field"), text);
  await enter(find(root, "composer-field"));
  await flush();
}

test("a command card does not follow the person to another chat", async () => {
  const restore = installDom();
  const l = listeners();
  try {
    clearNotices();
    const s = createSample("idle");
    const data = {
      ...s.data,
      call: (cap: string, i: unknown) => (cap === "engine.my_ai" ? Promise.resolve(MY_AI) : s.data.call(cap, i)),
    };
    const r = createRoot();
    const root = await mount(() => r, <Conversation data={data} />);
    await command(root, "/usage");
    assert.ok(find(root, "command-card"), "open in the first chat");
    await act(async () => r.render(<Conversation data={{ ...data, threadId: "thr_other" }} />));
    await flush();
    assert.ok(find(root, "command-card") === null, "gone in the other chat");
    await act(async () => r.render(<></>));
  } finally {
    l.restore();
    clearNotices();
    restore();
  }
});

test("a second command of the same kind replaces the first: it reads again and shows the new answer", async () => {
  const restore = installDom();
  const l = listeners();
  try {
    clearNotices();
    let n = 0;
    const { root, calls } = await open({
      "engine.my_ai": () => {
        n += 1;
        return { ...MY_AI, accounts: [{ ...MY_AI.accounts[0], name: n === 1 ? "First account" : "Second account" }] };
      },
    });
    await command(root, "/usage");
    assert.match(textOf(find(root, "command-card")), /First account/);
    await press(find(root, "row-cmd-account-First account"));
    assert.ok(find(root, "cmd-models"), "the first card has an account folded open");
    await command(root, "/usage");
    assert.equal(find(root, "cmd-models"), null, "the second card is a new card: nothing carried over from the first");
    const t = textOf(find(root, "command-card"));
    assert.match(t, /Second account/, "the new card shows the new answer");
    assert.ok(!/First account/.test(t), "and not the old one");
    assert.equal(calls.filter((c) => c.cap === "engine.my_ai").length, 2);
  } finally {
    l.restore();
    clearNotices();
    restore();
  }
});
