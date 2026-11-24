// A member's "your mail, calendar, files are here" row says what is true: it waits for a connected mailbox of theirs, never for a built-in calendar or a number.
import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { inboxAnswer, mailboxAnswer, useInboxSources } from "./inbox-sources.ts";
import type { ScreenHooks } from "../../../../../client/src/index.ts";
import type { QueryState } from "../../../../../client/src/index.ts";

const ready = (data: unknown): QueryState<unknown> => ({ status: "ready", data }) as QueryState<unknown>;
const loading = { status: "loading" } as QueryState<unknown>;

test("a connected mailbox is a yes; a disconnected one, no mailbox at all, or only a calendar is a no; nothing answered yet is unknown", () => {
  assert.equal(mailboxAnswer(ready({ mailboxes: [{ state: "syncing" }] })), true);
  assert.equal(mailboxAnswer(ready({ mailboxes: [{ state: "disconnected" }] })), false);
  assert.equal(mailboxAnswer(ready({ mailboxes: [] })), false);
  assert.equal(mailboxAnswer(loading), null);
  // the built-in calendar a fresh Space reports puts Inbox on the rail, but it is not their mail
  const noMail = ready({ mailboxes: [] });
  const calendar = ready({ calendars: [{ id: "cal_space" }] });
  const none = ready({ numbers: [] });
  assert.equal(inboxAnswer([noMail, calendar, none], "usr_a"), true, "the rail still follows any source");
  assert.equal(mailboxAnswer(noMail), false, "the row does not");
});

test("the Inbox draws the last answer it knew at once on a return, before any read answers; a first visit is unknown", () => {
  let snaps: Record<string, QueryState<unknown>> = {};
  const screens = {
    query: (_s: string, name: string) => ({
      subscribe: () => () => undefined,
      getSnapshot: () => snaps[name] ?? loading,
    }),
  } as unknown as ScreenHooks;
  const Probe = (): ReturnType<typeof createElement> =>
    createElement("i", null, String(useInboxSources(screens, "usr_a")));
  const draw = (): string => renderToStaticMarkup(createElement(Probe));
  assert.equal(draw(), "<i>null</i>", "first visit: nothing known");
  snaps = { mailboxes: ready({ mailboxes: [] }), calendars: ready({ calendars: [] }), numbers: ready({ numbers: [] }) };
  assert.equal(draw(), "<i>false</i>", "answered: nothing connected");
  snaps = {};
  assert.equal(draw(), "<i>false</i>", "a return paints the kept answer while the reads load");
});
