// Inbox with nothing connected: the empty state is a "Connect a channel" choice (no New message), each tile opens its own existing flow, and the pencil, plus and Dialer open the same
// choice. Once a channel can send, the normal empty Inbox returns with New message.
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { createRoot } from "test-renderer";
import type { ReactElement } from "react";
import { Text } from "react-native";
import { installDom, mount, press, find, textOf } from "../../../onboarding/test-dom.ts";
import { ContactList } from "../contactlist/index.ts";
import { ConnectChannel } from "../connect/index.ts";
import { createSampleInbox, harbor } from "../contactlist/sample.ts";
import type { SampleSpace } from "../contactlist/sample.ts";
import { InboxDataProvider, InboxSidebar, InboxStateProvider, useInboxState } from "../sidebar/index.ts";
import type { InboxState } from "../sidebar/index.ts";

const none: SampleSpace = { ...harbor, mailboxes: [], numbers: [], contacts: [], threads: [], calls: [], calendars: [] };
const connected: SampleSpace = { ...harbor, contacts: [], threads: [], calls: [] };
const numberOnly: SampleSpace = { ...none, numbers: ["+1 415 555 0199"] };

const html = (space: SampleSpace, child: ReactElement, initial: Partial<InboxState> = {}): string =>
  renderToStaticMarkup(<InboxDataProvider value={createSampleInbox(space).data}><InboxStateProvider initial={initial}>{child}</InboxStateProvider></InboxDataProvider>).replaceAll("<!-- -->", "");
const has = (s: string, needle: string): boolean => s.includes(needle);

test("no channel connected: the empty Inbox says Connect a channel with four tiles and no New message", () => {
  const out = html(none, <ContactList />);
  assert.ok(has(out, 'data-testid="inbox-connect-channel"') && has(out, "Connect a channel"));
  for (const k of ["gmail", "outlook", "imap", "twilio"]) assert.ok(has(out, `data-testid="connect-${k}"`), k);
  for (const label of ["Gmail", "Outlook", "Other email", "Twilio"]) assert.ok(has(out, `>${label}<`), label);
  assert.ok(has(out, 'data-appicon="gmail"') && has(out, 'data-appicon="microsoft"') && has(out, 'data-appicon="twilio"'), "real brand marks");
  assert.ok(!has(out, "New message") && !has(out, "No messages yet."));
  // the page is the choice alone: no view menu, filter or dial that could not do anything yet
  assert.ok(!has(out, 'data-testid="inbox-view"') && !has(out, 'data-testid="inbox-filter"') && !has(out, 'data-testid="inbox-dial"'));
});

test("with a mailbox connected the empty Inbox is the normal one, with New message", () => {
  const out = html(connected, <ContactList />);
  assert.ok(has(out, "No messages yet.") && has(out, "New message"));
  assert.ok(!has(out, "inbox-connect-channel"));
  assert.ok(has(out, 'data-testid="inbox-view"') && has(out, 'data-testid="inbox-filter"') && has(out, 'data-testid="inbox-dial"'), "the controls are back once a channel can send");
});

test("a claimed number alone also counts as a channel", () => {
  const out = html(numberOnly, <ContactList />);
  assert.ok(has(out, "No messages yet.") && !has(out, "inbox-connect-channel"));
});

test("each tile opens its own flow", async () => {
  installDom();
  const want: Record<string, string> = { gmail: "connect:gmail", outlook: "connect:outlook", imap: "connect:imap", twilio: "connect:twilio" };
  for (const [tile, opened] of Object.entries(want)) {
    const s = createSampleInbox(none);
    const root = await mount(createRoot, <InboxDataProvider value={s.data}><InboxStateProvider><ConnectChannel /></InboxStateProvider></InboxDataProvider>);
    await press(find(root, `connect-${tile}`));
    assert.deepEqual(s.opened, [opened], tile);
  }
});

function Probe(): ReactElement {
  const { state } = useInboxState();
  return <Text testID="probe">{state.main}</Text>;
}

test("nothing connected: the pencil, the plus, Lists and the Dialer are not drawn; the page is the connect choice", () => {
  const out = html(none, <InboxSidebar />);
  for (const id of ["inbox-new", "inbox-connect", "inbox-dialer", "sec-lists"]) assert.ok(!has(out, `data-testid="${id}"`), id);
  assert.ok(!has(out, ">Lists<") && !has(out, ">Starred<"));
  assert.ok(has(out, ">By contact<") && has(out, ">Calendar<"), "the places stay");
});

test("a Space with no number has no dialer; with one the footer is that number", () => {
  const noNumber = html(connected, <InboxSidebar />);
  assert.ok(has(noNumber, 'data-testid="inbox-new"') && !has(noNumber, 'data-testid="inbox-dialer"'));
  const withNumber = html(numberOnly, <InboxSidebar />);
  assert.ok(has(withNumber, 'data-testid="inbox-dialer"') && has(withNumber, "+1 415 555 0199"));
});

test("with a channel connected the pencil composes and the Dialer opens the dialer", async () => {
  installDom();
  const s = createSampleInbox({ ...connected, numbers: ["+1 415 555 0199"] });
  const root = await mount(createRoot, <InboxDataProvider value={s.data}><InboxStateProvider><InboxSidebar /><Probe /></InboxStateProvider></InboxDataProvider>);
  await press(find(root, "inbox-new"));
  await press(find(root, "inbox-dialer"));
  assert.deepEqual(s.opened, ["compose", "dialer"]);
});

test("with the connect door, each tile opens its own sheet in place (Gmail, Outlook, Other email, Twilio) and navigates nowhere", async () => {
  installDom();
  const { ConnectCtx } = await import("../../../shell/connect/context.ts");
  const needs: unknown[] = [];
  const s = createSampleInbox(none);
  const door = { open: async (need: unknown) => { needs.push(need); return null; }, version: 0 };
  const root = await mount(createRoot, <ConnectCtx.Provider value={door as never}><InboxDataProvider value={s.data}><ConnectChannel /></InboxDataProvider></ConnectCtx.Provider>);
  for (const k of ["gmail", "outlook", "imap", "twilio"]) await press(find(root, `connect-${k}`));
  assert.deepEqual(needs, [{ kind: "mailbox", provider: "google" }, { kind: "mailbox", provider: "microsoft" }, { kind: "mailbox", provider: "imap" }, { kind: "number" }]);
  assert.deepEqual(s.opened.filter((o) => o.startsWith("connect:")), [], "the old navigation is not used when the door exists");
});
