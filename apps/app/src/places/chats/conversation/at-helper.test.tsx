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
import { draftOf, scopeOf } from "./drafts.ts";
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
    assert.equal(find(root, "composer-field")!.props.value, "", "the box is emptied once the helper took it");
  } finally {
    restore();
  }
});

test("a name that is not first and a name nobody has post as ordinary words; a helper that has finished is not messaged and nothing is posted for it", async () => {
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
    assert.equal(
      calls.filter((c) => c.cap === "chat.post").length,
      2,
      "the two that were not for a helper are posted; the one for the finished helper is not posted to everyone",
    );
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
    assert.equal(
      find(root, "composer-field")!.props.value,
      "@Numbers use the 8% rate",
      "the person's words are still in the box",
    );
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

test("a name that is a helper AND a person of the chat goes nowhere until the person picks: nothing is steered, nothing is posted, the words stay; naming the helper outright sends it", async () => {
  const restore = installDom();
  try {
    const s = createSample("idle");
    const calls: Array<{ cap: string; input: Record<string, unknown> }> = [];
    const data = {
      ...s.data,
      directory: [...s.data.directory, { id: "usr_numbers", kind: "person", name: "Numbers Ng" }],
      call: (cap: string, input: unknown) => {
        calls.push({ cap, input: input as Record<string, unknown> });
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
        if (cap === "chat.helper.steer") return Promise.resolve({ messageId: "m" });
        return s.data.call(cap, input);
      },
    };
    const root = await mount(
      createRoot,
      <CrewProvider call={data.call as never} threadId={data.threadId}>
        <Conversation data={data as never} />
      </CrewProvider>,
    );
    await flush();
    await send(root, "@Numbers use the 8% rate");
    assert.equal(calls.filter((c) => c.cap === "chat.helper.steer").length, 0, "not silently to the helper");
    assert.equal(calls.filter((c) => c.cap === "chat.post").length, 0, "and not posted either");
    assert.equal(find(root, "composer-field")!.props.value, "@Numbers use the 8% rate", "the words stay in the box");
    await send(root, "@Numbers (helper) use the 8% rate");
    const steer = calls.filter((c) => c.cap === "chat.helper.steer");
    assert.equal(steer.length, 1);
    assert.deepEqual([steer[0]!.input.threadId, steer[0]!.input.body], ["thr_numbers", "use the 8% rate"]);
  } finally {
    restore();
  }
});

test("while a steer is still being taken a second send goes nowhere, and a failure puts back only what was sent in front of what was typed since", async () => {
  const restore = installDom();
  try {
    const s = createSample("idle");
    const calls: string[] = [];
    let fail: (e: Error) => void = () => undefined;
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
        if (cap === "chat.helper.steer") return new Promise((_, rej) => (fail = rej));
        return s.data.call(cap, input);
      },
    };
    const root = await mount(
      createRoot,
      <CrewProvider call={data.call as never} threadId={data.threadId}>
        <Conversation data={data as never} />
      </CrewProvider>,
    );
    await flush();
    await send(root, "@Numbers use the 8% rate");
    await send(root, "@Numbers use the 9% rate");
    assert.equal(calls.filter((c) => c === "chat.helper.steer").length, 1, "one in flight per box");
    assert.equal(calls.includes("chat.post"), false);
    await typeInto(find(root, "composer-field"), "something else I wrote meanwhile");
    await act(async () => fail(new Error("gone")));
    await flush();
    const box = String(find(root, "composer-field")!.props.value);
    assert.ok(box.includes("something else I wrote meanwhile"), "what was typed since is kept");
    assert.ok(box.includes("@Numbers use the 8% rate"), "and the words that were not taken are back");
    assert.ok(box.indexOf("@Numbers use the 8% rate") < box.indexOf("something else"), "in front of it");
  } finally {
    restore();
  }
});

test("words typed while a steer is in flight survive its success: the draft the real composer keeps is what was typed since, not emptied", async () => {
  const restore = installDom();
  const g = globalThis as { localStorage?: unknown };
  const had = g.localStorage;
  const mem = new Map<string, string>();
  g.localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => void mem.set(k, v),
    removeItem: (k: string) => void mem.delete(k),
  };
  try {
    const s = createSample("idle");
    let ok: (v: unknown) => void = () => undefined;
    const data = {
      ...s.data,
      call: (cap: string, input: unknown) => {
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
        if (cap === "chat.helper.steer") return new Promise((r) => (ok = r)); // held: the steer is in flight
        return s.data.call(cap, input);
      },
    };
    const root = await mount(
      createRoot,
      <CrewProvider call={data.call as never} threadId={data.threadId}>
        <Conversation data={data as never} />
      </CrewProvider>,
    );
    await flush();
    await send(root, "@Numbers use the 8% rate");
    await typeInto(find(root, "composer-field"), "my next message"); // typed while the first is still being taken
    await flush();
    assert.equal(
      draftOf(data.threadId, scopeOf(data.me?.id)),
      "my next message",
      "the composer keeps what is typed as the draft",
    );
    await act(async () => ok({ messageId: "m" })); // the helper takes the first message
    await flush();
    assert.equal(
      draftOf(data.threadId, scopeOf(data.me?.id)),
      "my next message",
      "and the success of the first does not empty it",
    );
  } finally {
    g.localStorage = had;
    restore();
  }
});
