// A member's "your mail, calendar, files are here" row says what is true: it waits for a connected mailbox of theirs, never for a built-in calendar or a number.
import test from "node:test";
import assert from "node:assert/strict";
import { inboxAnswer, mailboxAnswer } from "./inbox-sources.ts";
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
