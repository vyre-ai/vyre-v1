// The Inbox place in the shell: the sidebar and the contact list drawn from the runtime's hooks, the loading frame without a runtime, and the nav a click reaches.
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import type { LiveQuery } from "../../../../../client/src/index.ts";
import { createSampleInbox } from "../../places/inbox/contactlist/sample.ts";
import type { Principal } from "../../places/home/sections-a/data.tsx";
import InboxPlace, { inboxData } from "./inbox.tsx";
import { ShellRuntimeProvider } from "./runtime.tsx";
import type { ShellRuntime, ShellTarget } from "./runtime.tsx";

function runtime(): { rt: ShellRuntime; opened: ShellTarget[] } {
  const s = createSampleInbox();
  const opened: ShellTarget[] = [];
  const me: Principal = { id: "usr_irfad", name: "Irfad Imtiaz", kind: "person" };
  const principals: LiveQuery<Principal[]> = { subscribe: () => () => undefined, getSnapshot: () => ({ status: "ready", data: [me] }) };
  const rt: ShellRuntime = {
    screens: s.data.screens, call: s.data.call, connection: s.data.connection, principals, recordTitle: () => undefined, me, clock: s.data.clock,
    space: { id: "northwind", kind: "team", name: "Northwind" }, assistant: { id: "agt_assistant", name: "Assistant" }, aiConnected: true, calendarConnected: true,
    open: (t) => void opened.push(t), openUrl: () => undefined,
  };
  return { rt, opened };
}

const html = (rt: ShellRuntime | null): string =>
  renderToStaticMarkup(rt ? <ShellRuntimeProvider value={rt}><InboxPlace /></ShellRuntimeProvider> : <InboxPlace />).replaceAll("<!-- -->", "");

test("inbox: with a runtime the sidebar and the contact list draw the Space's contacts", () => {
  const out = html(runtime().rt);
  assert.ok(out.includes('data-testid="inbox-place"'));
  assert.ok(out.includes("Elena Rivera") && out.includes("Marcus Pruitt"), "the contact lines");
  assert.ok(!out.includes("-loading"), "no loading frame once the Space is open");
});

test("inbox: before the runtime exists the place draws its own loading frame", () => {
  const out = html(null);
  assert.ok(out.includes('data-testid="inbox-place-loading"'));
});

test("inbox: opening a contact reaches the place, and the sidebar's other doors ask the shell", () => {
  const { rt, opened } = runtime();
  const picked: string[] = [];
  const data = inboxData(rt, (id) => picked.push(id));
  data.nav.openConversation("elena");
  data.nav.openCall("call_1");
  data.nav.compose();
  assert.deepEqual(picked, ["elena"]);
  assert.deepEqual(opened, [{ subject: { type: "call", id: "call_1" } }, { screen: "mail.message-detail" }]);
});
