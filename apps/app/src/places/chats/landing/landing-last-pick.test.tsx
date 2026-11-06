// The model a person picked last, anywhere, is what the first screen starts a new chat on (owner, 6 Nov): they never pick it again.
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

function world(opts: { assistantRowAfter: number; last?: Record<string, string> }) {
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
    if (cap === "engine.last_pick.get") return opts.last ?? {};
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

test("a new chat starts on the model, provider and effort the person last picked", async () => {
  const off = installDom();
  try {
    const w = world({ assistantRowAfter: 0, last: { model: "glm-5", provider: "opencode-go", effort: "high" } });
    const opened: string[] = [];
    const r = createRoot();
    await act(async () => { r.render(page(w.rtWith({ id: REAL, name: "Assistant" }), opened)); });
    for (let i = 0; i < 5; i++) await flush();
    const root = r.container as unknown as Node;
    await typeInto(find(root, "composer-field"), "Plan my week");
    await press(find(root, "composer-send"));
    for (let i = 0; i < 20 && opened.length === 0; i++) await flush();
    const start = w.calls.find((c) => c.cap === "chat.start")!;
    assert.equal(start.input["model"], "glm-5");
    assert.equal(start.input["provider"], "opencode-go");
    assert.equal(start.input["effort"], "high");
  } finally { off(); }
});

test("with no pick kept, the chat starts with no model so the Space default answers", async () => {
  const off = installDom();
  try {
    const w = world({ assistantRowAfter: 0 });
    const opened: string[] = [];
    const r = createRoot();
    await act(async () => { r.render(page(w.rtWith({ id: REAL, name: "Assistant" }), opened)); });
    for (let i = 0; i < 5; i++) await flush();
    const root = r.container as unknown as Node;
    await typeInto(find(root, "composer-field"), "Hi");
    await press(find(root, "composer-send"));
    for (let i = 0; i < 20 && opened.length === 0; i++) await flush();
    const start = w.calls.find((c) => c.cap === "chat.start")!;
    assert.equal(start.input["model"], undefined);
  } finally { off(); }
});

test("a remembered Auto starts the new chat on Auto, not on an older model", async () => {
  const off = installDom();
  try {
    const w = world({ assistantRowAfter: 0, last: { model: "auto", provider: "anthropic" } });
    const opened: string[] = [];
    const r = createRoot();
    await act(async () => { r.render(page(w.rtWith({ id: REAL, name: "Assistant" }), opened)); });
    for (let i = 0; i < 5; i++) await flush();
    const root = r.container as unknown as Node;
    await typeInto(find(root, "composer-field"), "Hi");
    await press(find(root, "composer-send"));
    for (let i = 0; i < 20 && opened.length === 0; i++) await flush();
    assert.equal(w.calls.find((c) => c.cap === "chat.start")!.input["model"], "auto");
  } finally { off(); }
});
