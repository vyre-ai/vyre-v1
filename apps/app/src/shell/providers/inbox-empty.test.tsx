// An Inbox tab with nothing flowing in (Inbox is off the rail, but a saved tab or a link still opens it): the connect screen of Settings > Email and calendar, never an empty Inbox.
// An item a link or an agent opened still opens; while the reads load the Inbox draws as it always did.
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import type { LiveQuery, ScreenHooks } from "../../../../../client/src/index.ts";
import { createSampleInbox } from "../../places/inbox/contactlist/sample.ts";
import type { Principal } from "../../places/home/sections-a/data.tsx";
import { INBOX_SOURCE_QUERIES } from "../rail/inbox-sources.ts";
import InboxPlace from "./inbox.tsx";
import { PlaceHashProvider } from "../hash/context.tsx";
import { ShellRuntimeProvider } from "./runtime.tsx";
import type { ShellRuntime } from "./runtime.tsx";

/** The sample Inbox, with the three source reads answering as asked: empty, or still loading. */
function runtime(sources: "none" | "loading" | "sample"): ShellRuntime {
  const s = createSampleInbox();
  const me: Principal = { id: "usr_irfad", name: "Irfad Imtiaz", kind: "person" };
  const key = (screen: string, name: string): string => `${screen}.${name}`;
  const empty: Record<string, unknown> = { [key(...INBOX_SOURCE_QUERIES[0])]: { mailboxes: [] }, [key(...INBOX_SOURCE_QUERIES[1])]: { calendars: [] }, [key(...INBOX_SOURCE_QUERIES[2])]: { numbers: [] } };
  const screens: ScreenHooks = {
    query(screen, name, state) {
      const k = key(screen, name);
      if (sources === "sample" || !(k in empty)) return s.data.screens.query(screen, name, state);
      const snap = sources === "none" ? { status: "ready" as const, data: empty[k] } : { status: "loading" as const };
      return { subscribe: () => () => undefined, getSnapshot: () => snap } as LiveQuery<unknown>;
    },
  };
  const principals: LiveQuery<Principal[]> = { subscribe: () => () => undefined, getSnapshot: () => ({ status: "ready", data: [me] }) };
  return {
    screens, call: s.data.call, connection: s.data.connection, principals, recordTitle: () => undefined, me, clock: s.data.clock,
    space: { id: "northwind", kind: "team", name: "Northwind" }, assistant: { id: "agt_assistant", name: "Assistant" }, aiConnected: true, deferredModules: new Set<string>(), isDeferred: () => false, calendarConnected: true,
    open: () => undefined, openUrl: () => undefined,
  };
}

const html = (rt: ShellRuntime, hash = ""): string =>
  renderToStaticMarkup(<ShellRuntimeProvider value={rt}><PlaceHashProvider hash={hash} opened={() => undefined}><InboxPlace /></PlaceHashProvider></ShellRuntimeProvider>).replaceAll("<!-- -->", "");

test("an Inbox tab with nothing connected shows the connect screen, not an empty Inbox", () => {
  const out = html(runtime("none"));
  assert.ok(out.includes('data-testid="inbox-place"') && out.includes('data-testid="inbox-connect-channel"'));
  for (const tile of ["gmail", "outlook", "imap", "twilio"]) assert.ok(out.includes(`data-testid="connect-${tile}"`), tile);
  assert.ok(!out.includes('data-testid="inbox-sidebar-col"') && !out.includes("Marcus Pruitt"), "no sidebar of empty inboxes, no list");
});

test("a link or an agent opening an Inbox item still opens it with nothing connected", () => {
  const out = html(runtime("none"), "subject=conversation:elena");
  assert.ok(out.includes('data-testid="call-conversation"') && !out.includes('data-testid="inbox-connect-channel"'));
  assert.ok(!html(runtime("none"), "screen=inbox.unmatched&conversationId=elena").includes('data-testid="inbox-connect-channel"'));
});

test("while the reads load, and once something is connected, the Inbox draws as it always did", () => {
  for (const rt of [runtime("loading"), runtime("sample")]) {
    const out = html(rt);
    assert.ok(out.includes('data-testid="inbox-sidebar-col"') && !out.includes('data-testid="inbox-connect-channel"'));
  }
  assert.ok(html(runtime("sample")).includes("Marcus Pruitt"));
});
