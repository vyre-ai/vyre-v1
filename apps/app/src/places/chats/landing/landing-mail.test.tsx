// The first screen's setup checklist carries an Email and calendar row while nothing flows into Inbox (Inbox is off the rail until then); it opens Settings > Email and calendar
// and leaves once a mailbox, calendar or number arrives.
import test from "node:test";
import assert from "node:assert/strict";
import { createRoot } from "test-renderer";
import { find, installDom, mount, press, textOf } from "../../../../../../ui/src/testing/dom.ts";
import type { Node } from "../../../../../../ui/src/testing/dom.ts";
import type { LiveQuery, ScreenHooks } from "../../../../../../client/src/index.ts";
import { createSample } from "../conversation/sample.ts";
import { createSampleSidebar } from "../sidebar/sample.ts";
import type { Principal } from "../../home/sections-a/data.tsx";
import { INBOX_SOURCE_QUERIES } from "../../../shell/rail/inbox-sources.ts";
import { ResumeContext } from "../../../onboarding/resume-context.ts";
import { publishProgress } from "../../../onboarding/store.ts";
import type { ShellRuntime, ShellTarget } from "../../../shell/providers/runtime.tsx";
import { Landing } from "./Landing.tsx";

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
const screen = (rt: ShellRuntime) => (
  <ResumeContext.Provider value={{ done: 3, total: 8, open: noop, pill: null }}>
    <Landing rt={rt} nameOf={(id) => id} kindOf={() => "agent"} agents={[]} people={[]} openChat={noop} openTasks={noop} openNeed={noop} openProfile={noop} fill={noop} newKey={() => "k"} say={noop} />
  </ResumeContext.Provider>
);
const FIRST_DAY = { flow: "personal" as const, progress: { ai: "done" as const, interview: "done" as const, sessions: "done" as const } };

/** The checklist reads the published setup progress after mount, so the screen is mounted (not drawn to a string) with a first day published. */
async function mounted<T>(mailboxes: unknown[], run: (root: Node, opened: ShellTarget[]) => Promise<T>): Promise<T> {
  const off = installDom();
  publishProgress(FIRST_DAY);
  try {
    const { rt, opened } = runtime(mailboxes);
    return await run(await mount(createRoot, screen(rt)), opened);
  } finally {
    publishProgress(null);
    off();
  }
}

test("with nothing flowing in, the checklist has an Email and calendar row after the steps and before the more line", async () => {
  await mounted([], async (root) => {
    assert.ok(find(root, "landing-setup-mail"));
    const text = textOf(root);
    assert.ok(text.includes("Chrome extension"), "the setup steps are still there");
    const mail = text.indexOf("Email and calendar");
    const more = text.indexOf("more to set up");
    assert.ok(mail > text.indexOf("Chrome extension") && more > mail, "after the steps, before the more line");
  });
});

test("the row leaves once a mailbox is connected", async () => {
  await mounted([{ state: "syncing" }], async (root) => {
    assert.equal(find(root, "landing-setup-mail"), null);
    assert.ok(textOf(root).includes("Chrome extension"));
  });
});

test("the row opens Settings > Email and calendar", async () => {
  await mounted([], async (root, opened) => {
    await press(find(root, "landing-setup-mail"));
    assert.deepEqual(opened, [{ screen: "settings.page", args: { page: "mail" } }]);
  });
});
