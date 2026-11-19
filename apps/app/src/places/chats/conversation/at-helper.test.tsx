// "@Numbers use the 8% rate" in the chat's own box (lane r42-subagents, section G): a message that starts with the name of a helper that is at work goes to that helper alone, through chat.helper.steer, and is not posted
// to the chat; any other message, and a name that is not on it, posts as always. Driven through the real conversation and composer.
import test from "node:test";
import assert from "node:assert/strict";
import { act } from "react";
import { createRoot } from "test-renderer";
import { Dimensions } from "react-native";
import { find, flush, installDom, mount, typeInto } from "../../../../../../ui/src/testing/dom.ts";
import type { Node } from "../../../../../../ui/src/testing/dom.ts";
import { Composer } from "../../../../../../ui/src/Composer/index.tsx";
import { installComposerForTests } from "../../../../../../ui/src/Composer/Deferred.tsx";
import { Conversation } from "./Conversation.tsx";
import { createSample } from "./sample.ts";
import { CrewProvider } from "../crew/context.tsx";

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

const NUMBERS = {
  kind: "helper",
  id: "thr_numbers",
  parentThreadId: "thr_0",
  title: "Three-year cost",
  name: "Numbers",
  agentId: "agt_numbers",
  state: "working",
  step: "Running cost.py",
  startedAt: 1_000,
  elapsedMs: 5_000,
  tokensIn: 0,
  tokensOut: 0,
  costMicros: 0,
};
const DONE = {
  ...NUMBERS,
  id: "thr_calendar",
  name: "Calendar",
  title: "Delivery dates",
  state: "done",
  found: "Free the 14th.",
};

async function open(members: unknown[]) {
  const s = createSample("idle");
  const calls: Array<{ cap: string; input: Record<string, unknown> }> = [];
  const data = {
    ...s.data,
    call: (cap: string, input: unknown) => {
      calls.push({ cap, input: input as Record<string, unknown> });
      if (cap === "engine.crew.status")
        return Promise.resolve({
          members,
          totals: {
            members: members.length,
            working: members.filter((m) => (m as { state: string }).state === "working").length,
            done: 0,
            needsYou: 0,
            failed: 0,
            stopped: 0,
            tokensIn: 0,
            tokensOut: 0,
            costMicros: 0,
            filesChanged: 0,
            added: 0,
            deleted: 0,
            elapsedMs: 5_000,
          },
        });
      if (cap === "chat.helper.steer") return Promise.resolve({ messageId: "m_steer" });
      return s.data.call(cap, input);
    },
  };
  const root = await mount(
    createRoot,
    <CrewProvider call={data.call as never} threadId={data.threadId}>
      <Conversation data={data} />
    </CrewProvider>,
  );
  await flush();
  return { root, calls };
}
const send = async (root: Node, text: string): Promise<void> => {
  await typeInto(find(root, "composer-field"), text);
  await enter(find(root, "composer-field"));
  await flush();
};

test("a message that starts with a helper's name goes to that helper alone and is not posted to the chat", async () => {
  const restore = installDom();
  try {
    const { root, calls } = await open([NUMBERS]);
    await send(root, "@Numbers use the 8% rate");
    const steer = calls.filter((c) => c.cap === "chat.helper.steer");
    assert.equal(steer.length, 1);
    assert.deepEqual([steer[0]!.input.threadId, steer[0]!.input.body], ["thr_numbers", "use the 8% rate"]);
    assert.equal(typeof steer[0]!.input.idempotencyKey, "string");
    assert.equal(
      calls.some((c) => c.cap === "chat.post"),
      false,
      "nothing is posted to the chat",
    );
    assert.equal(find(root, "composer-field")!.props.value, "", "the box is emptied");
  } finally {
    restore();
  }
});

test("a name that is not at work, a name that is not first, and an ordinary message post as always", async () => {
  const restore = installDom();
  try {
    const { root, calls } = await open([NUMBERS, DONE]);
    await send(root, "@Calendar thanks");
    await send(root, "please ask @Numbers about it");
    await send(root, "@Zed hello");
    assert.equal(
      calls.filter((c) => c.cap === "chat.helper.steer").length,
      0,
      "a finished helper cannot be steered, and a mention elsewhere is just words",
    );
    assert.equal(calls.filter((c) => c.cap === "chat.post").length, 3);
  } finally {
    restore();
  }
});

test("a helper that cannot take the message says so and the person's words are not lost to the chat", async () => {
  const restore = installDom();
  try {
    const s = createSample("idle");
    const calls: string[] = [];
    const data = {
      ...s.data,
      call: (cap: string, input: unknown) => {
        calls.push(cap);
        if (cap === "engine.crew.status")
          return Promise.resolve({
            members: [NUMBERS],
            totals: {
              members: 1,
              working: 1,
              done: 0,
              needsYou: 0,
              failed: 0,
              stopped: 0,
              tokensIn: 0,
              tokensOut: 0,
              costMicros: 0,
              filesChanged: 0,
              added: 0,
              deleted: 0,
              elapsedMs: 1,
            },
          });
        if (cap === "chat.helper.steer") return Promise.reject(new Error("gone"));
        return s.data.call(cap, input);
      },
    };
    const root = await mount(
      createRoot,
      <CrewProvider call={data.call as never} threadId={data.threadId}>
        <Conversation data={data} />
      </CrewProvider>,
    );
    await flush();
    await send(root, "@Numbers use the 8% rate");
    assert.ok(calls.includes("chat.helper.steer"));
    assert.equal(calls.includes("chat.post"), false, "a failed steer is not silently posted to everyone");
  } finally {
    restore();
  }
});

test("typing @ offers the helper that is at work in the same menu as the agents, and not one that finished", async () => {
  const restore = installDom();
  try {
    const { root } = await open([NUMBERS, DONE]);
    await act(async () => {
      (find(root, "composer-field")!.props.onFocus as (e: unknown) => void)({ nativeEvent: {}, target: {} });
    });
    await typeInto(find(root, "composer-field"), "@");
    await flush();
    const popup = find(root, "composer-popup");
    assert.ok(popup, "the @ menu is open");

    const text = (n: Node | string): string => (typeof n === "string" ? n : (n.children ?? []).map(text).join(" "));
    assert.match(text(popup!), /Numbers/);
    assert.doesNotMatch(text(popup!), /Calendar/);
  } finally {
    restore();
  }
});
