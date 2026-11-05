// A fresh Personal Space makes its Assistant a moment after the account. The first screen mounts with the placeholder id "assistant"; the server refuses that id (422, /agentIds/0 pattern).
// The chat must start with the real id, whether the real Assistant arrives before the send or after it.
import test from "node:test";
import assert from "node:assert/strict";
import { act } from "react";
import { createRoot } from "test-renderer";
import { find, flush, installDom, press, textOf, typeInto } from "../../../../../../ui/src/testing/dom.ts";
import type { Node } from "../../../../../../ui/src/testing/dom.ts";
import type { LiveQuery, ScreenHooks } from "../../../../../../client/src/index.ts";
import { Composer } from "../../../../../../ui/src/Composer/index.tsx";
import { installComposerForTests } from "../../../../../../ui/src/Composer/Deferred.tsx";
import { createSample } from "../conversation/sample.ts";
import { createSampleSidebar } from "../sidebar/sample.ts";
import type { Principal } from "../../../shell/session/runtime-data.ts";
import { ResumeContext } from "../../../onboarding/resume-context.ts";
import type { ShellRuntime } from "../../../shell/providers/runtime.tsx";
import { Landing } from "./Landing.tsx";

installComposerForTests(Composer);

const ME: Principal = { id: "usr_irfad", name: "Irfad Imtiaz", kind: "person" };
const REAL = "agt_real_assistant";
const ready = (data: unknown): LiveQuery<unknown> => { const snap = { status: "ready" as const, data }; return { subscribe: () => () => undefined, getSnapshot: () => snap }; };
type Call = { cap: string; input: Record<string, unknown> };
const noop = (): void => undefined;

function world(opts: { assistantRowAfter: number }) {
  const side = createSampleSidebar();
  const conv = createSample("idle");
  const calls: Call[] = [];
  const refused: Call[] = [];
  let listed = 0;
  const fixed: Record<string, LiveQuery<unknown>> = {
    "tasks.my-work.needs": ready({ items: [], total: 0 }),
    "chats.sidebar.recent": ready({ starred: [], today: [], yesterday: [], earlier: [], archived: [], nextUnread: null }),
  };
  const screens: ScreenHooks = { query: (id, name, state) => fixed[`${id}.${name}`] ?? (id === "chats.conversation" ? conv.data.screens : side.data.screens).query(id, name, state) };
  const principals: LiveQuery<Principal[]> = { subscribe: () => () => undefined, getSnapshot: () => ({ status: "ready", data: [ME] }) };
  const call = async (cap: string, input: unknown): Promise<unknown> => {
    const c = { cap, input: input as Record<string, unknown> };
    calls.push(c);
    if (cap === "agents.list") return { agents: ++listed > opts.assistantRowAfter ? [{ agentId: REAL, name: "Assistant", kind: "assistant" }] : [] };
    if (cap === "chat.start") {
      const ids = (c.input["agentIds"] ?? []) as string[];
      if (ids.some((x) => x === "assistant" || !x.startsWith("agt_"))) { refused.push(c); throw new Error("422 /agentIds/0 does not match the pattern"); }
      return { thread: { threadId: "thr_new" } };
    }
    if (cap === "chat.post") return { message: { messageId: "msg_1", threadSeq: 1 } };
    return conv.data.call(cap, input);
  };
  const rtWith = (assistant: { id: string; name: string }): ShellRuntime => ({
    screens, call: call as ShellRuntime["call"], connection: conv.data.connection, principals, recordTitle: () => undefined, me: ME, clock: conv.data.clock,
    space: { id: "northwind", kind: "personal", name: "Personal" }, assistant, aiConnected: true, deferredModules: new Set<string>(), isDeferred: () => false, calendarConnected: false,
    open: () => undefined, openUrl: () => undefined,
  });
  return { rtWith, calls, refused };
}

const page = (rt: ShellRuntime, opened: string[]) => (
  <ResumeContext.Provider value={{ done: 8, total: 8, open: noop, pill: null }}>
    <Landing rt={rt} nameOf={(id) => id} kindOf={() => "agent"} agents={[]} people={[]} openChat={(id) => void opened.push(id)} openTasks={noop} openNeed={noop} openProfile={noop} fill={noop} newKey={() => "k"} say={noop} />
  </ResumeContext.Provider>
);

test("mounted before the real Assistant exists, then delivered: the send uses the real id and never the placeholder", async () => {
  const off = installDom();
  try {
    const w = world({ assistantRowAfter: 0 });
    const opened: string[] = [];
    const r = createRoot();
    await act(async () => { r.render(page(w.rtWith({ id: "assistant", name: "Assistant" }), opened)); });
    await flush();
    await act(async () => { r.render(page(w.rtWith({ id: REAL, name: "Assistant" }), opened)); });
    await flush();
    const root = r.container as unknown as Node;
    await typeInto(find(root, "composer-field"), "Plan my week");
    await press(find(root, "composer-send"));
    for (let i = 0; i < 20 && opened.length === 0; i++) await flush();
    const starts = w.calls.filter((c) => c.cap === "chat.start");
    assert.equal(starts.length, 1);
    assert.deepEqual(starts[0]!.input["agentIds"], [REAL]);
    assert.deepEqual(w.refused, [], "no start with the placeholder id reached the server");
    assert.deepEqual(opened, ["thr_new"]);
    assert.equal(find(root, "composer-send-error"), null);
  } finally { off(); }
});

test("sent while the Assistant is still being made: the start waits for the real id, then uses it", async () => {
  const off = installDom();
  try {
    const w = world({ assistantRowAfter: 2 });
    const opened: string[] = [];
    const r = createRoot();
    await act(async () => { r.render(page(w.rtWith({ id: "assistant", name: "Assistant" }), opened)); });
    await flush();
    const root = r.container as unknown as Node;
    await typeInto(find(root, "composer-field"), "Hello");
    await press(find(root, "composer-send"));
    for (let i = 0; i < 60 && opened.length === 0; i++) await flush();
    const order = w.calls.map((c) => c.cap).filter((c) => c === "agents.list" || c === "chat.start");
    assert.equal(order[order.length - 1], "chat.start");
    assert.ok(order.filter((c) => c === "agents.list").length >= 3, "it asked until the Assistant row appeared");
    const starts = w.calls.filter((c) => c.cap === "chat.start");
    assert.equal(starts.length, 1, "nothing started before the real id was known");
    assert.deepEqual(starts[0]!.input["agentIds"], [REAL]);
    assert.deepEqual(w.refused, []);
    assert.deepEqual(opened, ["thr_new"]);
    assert.doesNotMatch(textOf(root), /not ready yet/);
  } finally { off(); }
});
