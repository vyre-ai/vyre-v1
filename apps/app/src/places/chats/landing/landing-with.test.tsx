// The first screen's With row is the one Add people and agents sheet (lane l-addsheet): it hands the picks back as chips and calls nothing until the chat exists; what chat.start cannot take is
// applied to the new chat afterwards.
import test from "node:test";
import assert from "node:assert/strict";
import { createRoot } from "test-renderer";
import { find, flush, installDom, mount, press, textOf } from "../../../../../../ui/src/testing/dom.ts";
import type { Node } from "../../../../../../ui/src/testing/dom.ts";
import type { LiveQuery, ScreenHooks } from "../../../../../../client/src/index.ts";
import { createSample } from "../conversation/sample.ts";
import { createSampleSidebar } from "../sidebar/sample.ts";
import type { Principal } from "../../../shell/session/runtime-data.ts";
import { INBOX_SOURCE_QUERIES } from "../../../shell/rail/inbox-sources.ts";
import { ResumeContext } from "../../../onboarding/resume-context.ts";
import { publishProgress } from "../../../onboarding/store.ts";
import type { ShellRuntime, ShellTarget } from "../../../shell/providers/runtime.tsx";
import { Landing } from "./Landing.tsx";
import { runAfterStart } from "../addsheet/index.ts";

const ME: Principal = { id: "usr_irfad", name: "Irfad Imtiaz", kind: "person" };
const ready = (data: unknown): LiveQuery<unknown> => { const snap = { status: "ready" as const, data }; return { subscribe: () => () => undefined, getSnapshot: () => snap }; };

/** A first day (nothing waiting, nothing running) with the source reads answering as asked. */
function runtime(mailboxes: unknown[]): { rt: ShellRuntime; opened: ShellTarget[] } {
  const side = createSampleSidebar();
  const conv = createSample("idle");
  const opened: ShellTarget[] = [];
  const fixed: Record<string, LiveQuery<unknown>> = {
    "tasks.my-work.needs": ready({ items: [], total: 0 }),
    "chats.sidebar.recent": ready({ starred: [], today: [], yesterday: [], earlier: [], archived: [], nextUnread: null }),
    [INBOX_SOURCE_QUERIES[0].join(".")]: ready({ mailboxes }),
    [INBOX_SOURCE_QUERIES[1].join(".")]: ready({ calendars: [] }),
    [INBOX_SOURCE_QUERIES[2].join(".")]: ready({ numbers: [] }),
  };
  const screens: ScreenHooks = { query: (id, name, state) => fixed[`${id}.${name}`] ?? (id === "chats.conversation" ? conv.data.screens : side.data.screens).query(id, name, state) };
  const principals: LiveQuery<Principal[]> = { subscribe: () => () => undefined, getSnapshot: () => ({ status: "ready", data: [ME] }) };
  const rt: ShellRuntime = {
    screens, call: conv.data.call, connection: conv.data.connection, principals, recordTitle: () => undefined, me: ME, clock: conv.data.clock,
    space: { id: "northwind", kind: "personal", name: "Personal" }, assistant: { id: "agt_assistant", name: "Assistant" }, aiConnected: true, deferredModules: new Set<string>(), isDeferred: () => false, calendarConnected: false,
    open: (t) => void opened.push(t), openUrl: () => undefined,
  };
  return { rt, opened };
}


const noop = (): void => undefined;
const FIRST_DAY = { flow: "personal" as const, progress: { ai: "done" as const, interview: "done" as const, sessions: "done" as const } };

test("the With row opens the sheet; picks become chips and nothing is called for the chat yet", async () => {
  const off = installDom();
  publishProgress(FIRST_DAY);
  try {
    const { rt } = runtime([]);
    const calls: string[] = [];
    const watched: ShellRuntime = { ...rt, call: ((cap: string, input: unknown) => { calls.push(cap); return rt.call(cap as never, input as never); }) as ShellRuntime["call"] };
    const conv = createSample("idle");
    const root = await mount(createRoot, (
      <ResumeContext.Provider value={{ done: 3, total: 8, open: noop, pill: null }}>
        <Landing rt={watched} nameOf={conv.data.nameOf} kindOf={() => "agent"} openChat={noop} openTasks={noop} openNeed={noop} openProfile={noop} fill={noop} newKey={() => "k"} say={noop} />
      </ResumeContext.Provider>
    ));
    await press(find(root, "with-add"));
    await flush();
    assert.ok(find(root, "add-sheet"), "the same sheet");
    assert.match(textOf(find(root, "add-sheet")), /to this new chat/);
    for (const id of ["agent:agt_docs", "outside:out_cc", "person:usr_maya"]) await press(find(root, `as-row-${id}`));
    await press(find(root, "as-add"));
    await flush();
    assert.ok(find(root, "with-agt_docs") && find(root, "with-usr_maya") && find(root, "with-outside:out_cc"), "chips for the people, the agent and the outside agent");
    assert.ok(!calls.some((c) => c.startsWith("threads.") || c === "chat.start"), "no chat exists yet");
  } finally { publishProgress(null); off(); }
});

test("what chat.start cannot take is applied to the new chat: an outside agent, a guest, a second person", async () => {
  const s = createSample("idle");
  const deps = { call: s.data.call, me: s.data.me, nameOf: s.data.nameOf, newKey: s.data.newKey, toast: s.data.toast };
  const pick = (kind: "outside" | "guest" | "person", id: string, extra: object = {}) => ({ key: `${kind}:${id}`, kind, id, name: id, role: kind === "guest" ? "gview" : "member", ...extra }) as never;
  const out = await runAfterStart(deps, "c1", [pick("person", "usr_maya"), pick("person", "usr_omar"), pick("outside", "out_cc"), pick("guest", "d@e.f", { email: "d@e.f" })]);
  assert.deepEqual(out.failed, []);
  const caps = s.calls.map((c) => [c.cap, (c.input as { threadId?: string }).threadId]).filter(([c]) => String(c).startsWith("threads."));
  assert.deepEqual(caps, [["threads.members.add", "c1"], ["threads.outside_agent.add", "c1"], ["threads.invite_guest", "c1"]].filter(() => true));
});
