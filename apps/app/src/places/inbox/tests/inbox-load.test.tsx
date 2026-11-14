// The Inbox list reads its rows through the one data hook. A read that fails is a plain error with Retry where the list would be; before, it drew the grey loading frame for ever
// (13 Nov 2026: every Inbox screen left a failed read's error unread).
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";
import type { LiveQuery, QueryState } from "../../../../../../client/src/index.ts";
import { ContactList } from "../contactlist/index.ts";
import { createSampleInbox } from "../contactlist/sample.ts";
import { InboxDataProvider, InboxStateProvider, SCREENS } from "../sidebar/index.ts";
import type { InboxData } from "../sidebar/index.ts";

const withRows = (rows: QueryState<unknown>): InboxData => {
  const s = createSampleInbox();
  const query: LiveQuery<unknown> = { subscribe: () => () => undefined, getSnapshot: () => rows };
  return {
    ...s.data,
    screens: {
      ...s.data.screens,
      query: (id: string, name: string, state?: Record<string, unknown>) =>
        id === SCREENS.list && name === "rows" ? query : s.data.screens.query(id, name, state),
    } as InboxData["screens"],
  };
};
const wrap = (data: InboxData, child: ReactElement): string =>
  renderToStaticMarkup(
    <InboxDataProvider value={data}>
      <InboxStateProvider initial={{}}>{child}</InboxStateProvider>
    </InboxDataProvider>,
  ).replaceAll("<!-- -->", "");

test("when the read of the list fails, the list says so plainly with Retry, and keeps its head", () => {
  const out = wrap(withRows({ status: "loading", error: { message: "The server did not answer." } }), <ContactList />);
  assert.match(out, /data-testid="load-failed"/);
  assert.match(out, /Couldn(?:'|&#x27;)t load the Inbox/);
  assert.match(out, /data-testid="state-retry"/);
  assert.match(out, /data-testid="inbox-head"/, "the head (title, view, filter) stays");
  assert.doesNotMatch(out, /inbox-list-loading/, "no endless loading frame");
});

test("while the read is only waiting the list draws its loading frame, not an error", () => {
  const out = wrap(withRows({ status: "loading" }), <ContactList />);
  assert.match(out, /inbox-list-loading/);
  assert.doesNotMatch(out, /load-failed/);
});
