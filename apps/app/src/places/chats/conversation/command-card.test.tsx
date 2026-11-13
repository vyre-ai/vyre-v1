// The Command card (CMD-RESULTS-2026-11-13, kind b), driven through the real conversation and composer: it opens at once above the composer and reads its own data (loading, failed with Retry, empty,
// ready); it closes four ways (Escape, its close control, a press outside that is not the composer, the next send); opening another command replaces it; it is never a message.
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

test("/usage opens a card above the composer with its answer laid out; it is not a message and not above-the-composer text", async () => {
  const restore = installDom();
  const l = listeners();
  try {
    clearNotices();
    const { root, calls } = await open({ "engine.my_ai": () => MY_AI });
    assert.equal(find(root, "command-card"), null);
    await command(root, "/usage");
    const card = find(root, "command-card");
    assert.ok(card, "the card is open");
    assert.equal(card!.props["accessibilityLabel"] ?? card!.props["aria-label"], "Usage");
    const text = textOf(card);
    for (const w of [
      "This chat",
      "Sonnet 5.5",
      "Your Claude sign-in",
      "AI accounts",
      "Work Claude",
      "Session",
      "Week",
      "42%",
      "OpenCode Go",
      "Doesn't report its limits",
      "Your use",
      "1 turn",
      "39 turns",
      "18k",
      "AI accounts in Settings",
    ])
      assert.ok(text.includes(w), `${w} :: ${text}`);
    assert.ok(!/claude-sonnet|usr_|agt_/.test(text), "no raw ids");
    assert.equal(calls.filter((c) => c.cap === "chat.post").length, 0, "nothing was posted");
    assert.equal(find(root, "composer-field")!.props.value, "", "the composer is left empty and in place");
    assert.equal(find(root, "conversation-line"), null);
  } finally {
    l.restore();
    clearNotices();
    restore();
  }
});

test("a press on an account row folds its models open, and Settings then names that account", async () => {
  const restore = installDom();
  const l = listeners();
  try {
    const opened: string[] = [];
    const s = createSample("idle");
    const data = {
      ...s.data,
      call: (cap: string, input: unknown) =>
        cap === "engine.my_ai"
          ? Promise.resolve({ ...MY_AI, accounts: [{ ...MY_AI.accounts[0], ref: "#work" }, MY_AI.accounts[1]] })
          : s.data.call(cap, input),
      nav: {
        ...s.data.nav,
        openAiAccount: (r: string) => void opened.push(r),
        openAiSetup: () => void opened.push("page"),
      },
    };
    const root = await mount(createRoot, <Conversation data={data} />);
    await command(root, "/usage");
    assert.equal(find(root, "cmd-models"), null);
    await press(find(root, "row-cmd-account-Work Claude"));
    assert.match(textOf(find(root, "cmd-models")), /Sonnet 5\.5.*Opus 5\.5/);
    await press(find(root, "cmd-settings"));
    assert.deepEqual(opened, ["#work"], "Settings opens the account that was pressed, not the page top");
    assert.equal(find(root, "command-card"), null, "and the card closes");
  } finally {
    l.restore();
    restore();
  }
});

test("the four ways to close: Escape, the close control, a press outside (not the composer), and the next send", async () => {
  const restore = installDom();
  const l = listeners();
  try {
    clearNotices();
    const { root, calls } = await open({ "engine.my_ai": () => MY_AI });
    await command(root, "/usage");
    assert.ok(find(root, "command-card"));
    await l.escape();
    assert.equal(find(root, "command-card"), null, "Escape");
    await command(root, "/usage");
    await press(find(root, "dialog-close"));
    assert.equal(find(root, "command-card"), null, "the close control");
    await command(root, "/usage");
    const inComposer = { closest: (q: string) => (q.includes("composer") ? {} : null) };
    await l.pressAt(inComposer);
    assert.ok(find(root, "command-card"), "a press in the composer leaves it open: the person is about to type");
    await l.pressAt({ closest: () => null });
    assert.equal(find(root, "command-card"), null, "a press outside");
    await command(root, "/usage");
    await typeInto(find(root, "composer-field"), "hello");
    await enter(find(root, "composer-field"));
    assert.equal(find(root, "command-card"), null, "the next send");
    assert.ok(
      calls.some((c) => c.cap === "chat.post"),
      "and it was sent as a message",
    );
  } finally {
    l.restore();
    clearNotices();
    restore();
  }
});

test("opening another command replaces the card; a one-line command closes it", async () => {
  const restore = installDom();
  const l = listeners();
  try {
    clearNotices();
    const { root } = await open({
      "engine.my_ai": () => MY_AI,
      "gate.allow.list": () => ({ rules: [{ id: "r1", kind: "always", act: "send", target: "Run tests" }] }),
    });
    await command(root, "/usage");
    assert.match(textOf(find(root, "command-card")), /This chat/);
    await command(root, "/permissions");
    const t = textOf(find(root, "command-card"));
    assert.match(t, /Run tests/);
    assert.ok(!/This chat/.test(t), "one card at a time");
    await command(root, "/plan on");
    assert.equal(find(root, "command-card"), null, "a command that says one line closes the card");
  } finally {
    l.restore();
    clearNotices();
    restore();
  }
});

test("loading shows the quiet mark and nothing else; a failure says so plainly with Retry; an answer with no accounts is an empty state with one action", async () => {
  const restore = installDom();
  const l = listeners();
  try {
    clearNotices();
    let release: (v: unknown) => void = () => undefined;
    let mode: "slow" | "fail" | "empty" | "ok" = "slow";
    const { root } = await open({
      "engine.my_ai": () =>
        mode === "slow"
          ? new Promise((r) => (release = r))
          : mode === "fail"
            ? Promise.reject(new Error("engine.my_ai"))
            : mode === "empty"
              ? { accounts: [], use: MY_AI.use }
              : MY_AI,
    });
    await command(root, "/usage");
    assert.ok(find(root, "command-card"), "the card is there before its answer");
    assert.ok(find(root, "quiet"), "the quiet mark waits");
    assert.ok(!/This chat/.test(textOf(find(root, "command-card"))));
    mode = "fail";
    await act(async () => release(null));
    await flush();
    // the slow read resolved with nothing usable: read it again as a failure by pressing Retry after switching modes
    await command(root, "/usage");
    await flush();
    const failed = textOf(find(root, "command-card"));
    assert.match(failed, /Couldn't load usage/);
    assert.match(failed, /The Space didn't answer/);
    assert.ok(!/engine\.my_ai/.test(failed), "no capability name");
    mode = "ok";
    await press(find(root, "retry") ?? find(root, "load-failed-retry") ?? find(root, "state-retry"));
    await flush();
    assert.match(textOf(find(root, "command-card")), /This chat/, "Retry reads again");
    mode = "empty";
    await command(root, "/usage");
    assert.match(textOf(find(root, "command-card")), /No AI connected yet/);
    assert.match(textOf(find(root, "command-card")), /Connect an AI/);
  } finally {
    l.restore();
    clearNotices();
    restore();
  }
});

test("a row in /permissions has Take back: the row goes, a line says so with Undo where it can be undone", async () => {
  const restore = installDom();
  const l = listeners();
  try {
    clearNotices();
    const NOW = createSample("idle").data.clock().now;
    let rules = [{ id: "r1", kind: "always", act: "send", target: "Run tests", expiresAt: NOW + 3 * 86_400_000 }];
    const { root, calls } = await open({
      "gate.allow.list": () => ({ rules }),
      "gate.allow.remove": (i) => {
        rules = rules.filter((r) => r.id !== (i as { id: string }).id);
        return { ok: true };
      },
    });
    await command(root, "/permissions");
    assert.match(textOf(find(root, "command-card")), /Run tests/);
    await press(find(root, "cmd-take-r1"));
    await flush();
    assert.ok(calls.some((c) => c.cap === "gate.allow.remove"));
    assert.ok(!/Run tests/.test(textOf(find(root, "command-card"))), "the row is gone");
    const n = notices.getSnapshot().live[0]!;
    assert.equal(n.text, "Took back: Always allow Run tests");
    assert.equal(n.action?.label, "Undo");
  } finally {
    l.restore();
    clearNotices();
    restore();
  }
});
