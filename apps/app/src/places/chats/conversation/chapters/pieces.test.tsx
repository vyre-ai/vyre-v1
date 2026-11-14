// The pieces beside the chapters: the Session block (G63), the Kept tab (G62) and the /context card (G44), rendered with the real components.
import test from "node:test";
import { act, useEffect } from "react";
import assert from "node:assert/strict";
import { createRoot } from "test-renderer";
import { find, flush, installDom, mount, press, textOf, typeInto } from "../../../../../../../ui/src/testing/dom.ts";
import { ContextCard, metersOf } from "./ContextCard.tsx";
import { KeptTab } from "./KeptTab.tsx";
import { NO_USAGE, SessionBlock, SessionBlockMount, pct, sessionRows } from "./SessionBlock.tsx";
import { SessionProvider, useSession } from "../../session/context.tsx";
import { NO_SESSION, notesOf, summaryOf } from "../../session/model.ts";
import type { Message } from "../model.ts";

installDom();

const HOUR = 3_600_000;

test("the Session block says time, steps, context and the plan's week, and leaves out what it does not know", async () => {
  const rows = sessionRows({ from: 0, to: 4 * HOUR + 12 * 60_000, steps: 318 }, { ...NO_USAGE, context: 42, plan: 61 });
  assert.deepEqual(
    rows.map((r) => [r.label, r.value]),
    [
      ["Time", "4 h 12 min"],
      ["Steps", "318"],
      ["Context", "42%"],
      ["Plan this week", "61%"],
    ],
  );
  assert.deepEqual(sessionRows({ from: 5, to: 5, steps: 0 }, NO_USAGE), []);
  assert.equal(pct(420_000, 1_000_000), 42);
  assert.equal(pct(1, 0), null);
  const el = await mount(
    createRoot,
    <SessionBlock summary={{ from: 0, to: HOUR, steps: 7 }} usage={{ ...NO_USAGE, context: 42 }} />,
  );
  assert.match(textOf(find(el, "session-block")), /Session/);
  assert.match(textOf(find(el, "session-context")), /42%/);
  assert.equal(find(el, "session-plan"), null);
});

const msg = (id: string, seq: number, blocks: Message["blocks"], o: Partial<Message> = {}): Message =>
  ({
    messageId: id,
    threadId: "t",
    threadSeq: seq,
    author: { kind: "agent", id: "agt_a" },
    kind: "system",
    body: "",
    blocks,
    depth: 0,
    attachments: [],
    reactions: [],
    pinned: false,
    createdAt: 1_000 * seq,
    ...o,
  }) as Message;

test("the Kept tab lists decisions and kept notes, a press goes to the message, and an empty one says so", async () => {
  const messages = [
    msg("d1", 1, [
      {
        type: "link_card",
        v: 1,
        id: "l1",
        data: { lead: "Noted: decision", title: "A file link stays private", target: { type: "fact", id: "f1" } },
      } as never,
    ]),
    msg("a1", 2, [
      {
        type: "link_card",
        v: 1,
        id: "l2",
        data: { lead: "Aside", title: "How big is the cap?", body: "Two gigabytes." },
      } as never,
    ]),
  ];
  const s = summaryOf(messages, "usr_me");
  assert.equal(s.decisions.length, 1);
  assert.deepEqual(
    notesOf(messages).map((n) => n.title),
    ["How big is the cap?"],
  );
  const log: string[] = [];
  const el = await mount(
    createRoot,
    <KeptTab summary={s} onJump={(id) => log.push(id)} trail={(by, at) => `${by}, ${at}`} />,
  );
  assert.match(textOf(find(el, "kept-decisions")), /A file link stays private/);
  assert.match(textOf(find(el, "kept-notes")), /How big is the cap\?/);
  await press(find(el, "row-kept-decision-d1"));
  await press(find(el, "row-kept-note-a1"));
  assert.deepEqual(log, ["d1", "a1"]);
  const none = await mount(createRoot, <KeptTab summary={{ decisions: [], notes: [] }} onJump={() => undefined} />);
  assert.ok(find(none, "kept-empty"));
});

test("the context card shows the meters, opens a field with Keep this every time, and compacts with the words and the box", async () => {
  const calls: Array<[string, boolean]> = [];
  const meters = metersOf({ ...NO_USAGE, context: 42, session: 12, plan: 61 });
  assert.deepEqual(
    meters.map((m) => m.label),
    ["Context", "This session's limit", "Plan this week"],
  );
  const el = await mount(
    createRoot,
    <ContextCard
      meters={meters}
      keepEvery="the open questions"
      onCompact={async (k, a) => void calls.push([k, a])}
      onKnows={() => undefined}
    />,
  );
  assert.match(textOf(find(el, "context-meter-context")), /42%/);
  assert.match(textOf(find(el, "context-keep-every")), /the open questions/);
  assert.equal(find(el, "context-keep"), null, "the field is closed until Compact is pressed");
  await press(find(el, "context-open"));
  await typeInto(find(el, "context-keep"), "the lease questions");
  await press(find(el, "context-always"));
  await press(find(el, "context-go"));
  await flush();
  assert.deepEqual(calls, [["the lease questions", true]]);
  assert.equal(find(el, "context-keep"), null, "closed again after compacting");
});

test("the mount reads the chat's session and engine.usage.get, and draws nothing without a session", async () => {
  const seen: string[] = [];
  const call = async (cap: string): Promise<unknown> => {
    seen.push(cap);
    return { context: { used: 420_000, window: 1_000_000 }, week: { pct: 60.6 } };
  };
  const none = await mount(createRoot, <SessionBlockMount call={call} threadId="t" agentId="agt_a" />);
  assert.equal(find(none, "session-block"), null);
  const Publish = (): null => {
    const s = useSession();
    // the conversation publishes once it has loaded, after the provider has reset for the chat
    useEffect(() => {
      const t = setTimeout(() => s?.publish({ ...NO_SESSION, from: 0, to: 2 * HOUR, steps: 9 }), 0);
      return () => clearTimeout(t);
    }, [s]);
    return null;
  };
  const el = await mount(
    createRoot,
    <SessionProvider threadId="t">
      <Publish />
      <SessionBlockMount call={call} threadId="t" agentId="agt_a" />
    </SessionProvider>,
  );
  await act(async () => {
    await flush();
  });
  assert.match(textOf(find(el, "session-time")), /2 h/);
  assert.match(textOf(find(el, "session-steps")), /9/);
  assert.match(textOf(find(el, "session-context")), /42%/);
  assert.match(textOf(find(el, "session-plan")), /61%/);
  assert.deepEqual(seen, ["engine.usage.get"]);
});
