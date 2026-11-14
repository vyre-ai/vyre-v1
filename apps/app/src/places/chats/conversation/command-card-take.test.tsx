// The Command card and its Take back button (findings of reviewer r-ui on a246ed2f9). Its own file: unmounting the conversation mid-test needs the test window to stay up.
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

test("Take back is a real button, and pressing it twice before the answer takes the rule back once", async () => {
  const restore = installDom();
  const l = listeners();
  try {
    clearNotices();
    const NOW = createSample("idle").data.clock().now;
    let rules = [{ id: "r1", kind: "always", act: "send", target: "Run tests", expiresAt: NOW + 3 * 86_400_000 }];
    let release: () => void = () => undefined;
    const { root, calls } = await open({
      "gate.allow.list": () => ({ rules }),
      "gate.allow.remove": () =>
        new Promise(
          (res) =>
            (release = () => {
              rules = [];
              res({ ok: true });
            }),
        ),
    });
    await command(root, "/permissions");
    const b = find(root, "cmd-take-r1")!;
    assert.equal(b.props["role"] ?? b.props["accessibilityRole"], "button");
    await press(b);
    await press(find(root, "cmd-take-r1"));
    await act(async () => release());
    await flush();
    assert.equal(calls.filter((c) => c.cap === "gate.allow.remove").length, 1, "taken back once");
  } finally {
    l.restore();
    clearNotices();
    restore();
  }
});
