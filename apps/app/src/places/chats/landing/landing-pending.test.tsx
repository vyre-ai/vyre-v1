// The first message of a new chat paints before the server has answered: his words, the tab's name and the working mark are on screen from the key press, whatever the network does. If the start fails, the
// failure shows under his message with Retry; Retry sends the same key and the same words, so a lost answer never makes a twin, and the chat opens once.
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


type Held = { resolve(v: unknown): void; reject(e: unknown): void };

function world() {
  const side = createSampleSidebar();
  const conv = createSample("idle");
  const calls: Call[] = [];
  const held: Held[] = [];
  const fixed: Record<string, LiveQuery<unknown>> = {
    "tasks.my-work.needs": ready({ items: [], total: 0 }),
    "chats.sidebar.recent": ready({ starred: [], today: [], yesterday: [], earlier: [], archived: [], nextUnread: null }),
  };
  const screens: ScreenHooks = { query: (id, name, state) => fixed[`${id}.${name}`] ?? (id === "chats.conversation" ? conv.data.screens : side.data.screens).query(id, name, state) };
  const principals: LiveQuery<Principal[]> = { subscribe: () => () => undefined, getSnapshot: () => ({ status: "ready", data: [ME] }) };
  const call = (cap: string, input: unknown): Promise<unknown> => {
    calls.push({ cap, input: input as Record<string, unknown> });
    if (cap === "agents.list") return Promise.resolve({ agents: [{ agentId: REAL, name: "Assistant", kind: "assistant" }] });
    // the server never answers on its own: the test answers (or refuses) each start, the way a slow or lost network does
    if (cap === "chat.start") return new Promise((resolve, reject) => { held.push({ resolve, reject }); });
    return conv.data.call(cap, input);
  };
  const rt: ShellRuntime = {
    screens, call: call as ShellRuntime["call"], connection: conv.data.connection, principals, recordTitle: () => undefined, me: ME, clock: conv.data.clock,
    space: { id: "northwind", kind: "team", name: "Northwind" }, assistant: { id: REAL, name: "Assistant" }, aiConnected: true, deferredModules: new Set<string>(), isDeferred: () => false, calendarConnected: false,
    open: () => undefined, openUrl: () => undefined,
  };
  return { rt, calls, held, starts: () => calls.filter((c) => c.cap === "chat.start") };
}

function mount(w: ReturnType<typeof world>, opened: string[], titles: string[], startWith?: { id: string; name: string }) {
  let n = 0;
  return (
    <ResumeContext.Provider value={{ done: 8, total: 8, open: noop, pill: null }}>
      <Landing rt={w.rt} nameOf={(id) => id} kindOf={() => "agent"} openChat={(id) => void opened.push(id)} openTasks={noop} openNeed={noop} openProfile={noop} fill={noop} newKey={() => `key_${++n}`} say={noop} title={(t) => void titles.push(t)} {...(startWith ? { startWith } : {})} />
    </ResumeContext.Provider>
  );
}

async function send(root: Node, text: string): Promise<void> {
  await typeInto(find(root, "composer-field"), text);
  await press(find(root, "composer-send"));
  await flush();
}

test("the server has not answered: his message, the working mark and the tab's name are on screen, and the chat has not opened", async () => {
  const off = installDom();
  try {
    const w = world();
    const opened: string[] = []; const titles: string[] = [];
    const r = createRoot();
    await act(async () => { r.render(mount(w, opened, titles)); });
    await flush();
    const root = r.container as unknown as Node;
    await send(root, "Plan the quarterly review for the Lisbon team and the budget");
    assert.equal(w.starts().length, 1, "the chat is being started");
    assert.match(textOf(find(root, "msg-pending")!), /Plan the quarterly review for the Lisbon team and the budget/, "his own message is in a message row");
    assert.ok(find(root, "working-mark"), "the agent shows it is working");
    assert.deepEqual(titles, ["Plan the quarterly review for the"], "the tab is named for the chat at once");
    assert.equal(find(root, "landing-failed"), null);
    assert.deepEqual(opened, [], "the chat opens when the server has given it an id");
    w.held[0]!.resolve({ thread: { threadId: "thr_new" } });
    for (let i = 0; i < 10 && opened.length === 0; i++) await flush();
    assert.deepEqual(opened, ["thr_new"]);
  } finally { off(); }
});

test("a start that fails shows under his words with Retry; Retry sends the same key and words, and the chat opens once", async () => {
  const off = installDom();
  try {
    const w = world();
    const opened: string[] = []; const titles: string[] = [];
    const r = createRoot();
    await act(async () => { r.render(mount(w, opened, titles)); });
    await flush();
    const root = r.container as unknown as Node;
    await send(root, "Draft the hiring note for the Oslo office");
    w.held[0]!.reject(new Error("502"));
    for (let i = 0; i < 10 && find(root, "landing-failed") === null; i++) await flush();
    assert.ok(find(root, "landing-failed"), "it says it failed");
    assert.match(textOf(find(root, "landing-failed")!), /Could not start the chat/);
    assert.match(textOf(find(root, "msg-pending")!), /Draft the hiring note for the Oslo office/, "his words stay");
    assert.equal(find(root, "working-mark"), null, "nothing is working on a chat that did not start");
    assert.deepEqual(opened, []);
    await press(find(root, "landing-retry"));
    await flush();
    assert.equal(w.starts().length, 2, "Retry starts again");
    const [first, again] = w.starts();
    assert.equal(again!.input["idempotencyKey"], first!.input["idempotencyKey"], "the same key, so a lost answer is not a second chat");
    assert.equal(again!.input["first"], first!.input["first"], "the same words");
    assert.ok(find(root, "working-mark"), "working again while it retries");
    assert.equal(find(root, "landing-failed"), null);
    w.held[1]!.resolve({ thread: { threadId: "thr_new" } });
    for (let i = 0; i < 10 && opened.length === 0; i++) await flush();
    assert.deepEqual(opened, ["thr_new"], "one chat");
  } finally { off(); }
});

test("a slash command still waits for its chat (it has no message to show), and a failed start keeps the draft in the composer", async () => {
  const off = installDom();
  try {
    const w = world();
    const opened: string[] = []; const titles: string[] = [];
    const r = createRoot();
    await act(async () => { r.render(mount(w, opened, titles)); });
    await flush();
    const root = r.container as unknown as Node;
    await send(root, "/help");
    assert.equal(find(root, "msg-pending"), null, "no message row for a command");
    assert.deepEqual(titles, []);
    w.held[0]!.reject(new Error("502"));
    for (let i = 0; i < 10 && find(root, "composer-send-error") === null; i++) await flush();
    assert.ok(find(root, "composer-send-error"), "the composer says it could not start");
  } finally { off(); }
});

test("a new chat started from an agent's page has that agent picked, and nothing is made until he sends", async () => {
  const off = installDom();
  try {
    const w = world();
    const opened: string[] = []; const titles: string[] = [];
    const r = createRoot();
    await act(async () => { r.render(mount(w, opened, titles, { id: "agt_intake", name: "Intake" })); });
    await flush();
    const root = r.container as unknown as Node;
    assert.equal(w.starts().length, 0, "no chat exists before he sends");
    assert.ok(find(root, "with-agt_intake"), "the agent is picked in With");
    await send(root, "Book the Rivera call");
    assert.deepEqual(w.starts()[0]!.input["agentIds"], ["agt_intake"]);
    assert.deepEqual(titles, ["Book the Rivera call"]);
  } finally { off(); }
});
