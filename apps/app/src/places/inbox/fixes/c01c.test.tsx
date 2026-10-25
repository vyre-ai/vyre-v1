// P-L9c_01c: the audit fixes on the Inbox list and sidebar: organisation beside the name, bell and star marks, DND and Bounced tags, Draft ready lead-in, the More button on hover,
// Client portal under Shared and Billing's number under Agents, Starred in Lists.
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";
import { ContactList } from "../contactlist/index.ts";
import { createSampleInbox } from "../contactlist/sample.ts";
import { InboxDataProvider, InboxSidebar, InboxStateProvider, navGroups } from "../sidebar/index.ts";
import type { InboxState } from "../sidebar/index.ts";

const wrap = (initial: Partial<InboxState>, child: ReactElement): string => {
  const s = createSampleInbox();
  return renderToStaticMarkup(<InboxDataProvider value={s.data}><InboxStateProvider initial={initial}>{child}</InboxStateProvider></InboxDataProvider>).replaceAll("<!-- -->", "");
};
const has = (s: string, n: string): boolean => s.includes(n);

test("the list names each person's organisation next to the name", () => {
  const out = wrap({}, <ContactList />);
  assert.ok(has(out, "Elena Rivera  Northwind Property") && has(out, "Marcus Pruitt  Pruitt &amp; Co.") && has(out, "Dana Whitfield  Whitfield Group"));
});

test("Draft ready leads the preview of a line an agent has a draft for, and only that line", () => {
  const out = wrap({}, <ContactList />);
  assert.ok(has(out, "Draft ready · Can you resend invoice 1041?") && has(out, "Draft ready · Re: Spring check-in"));
  assert.ok(!has(out, "Draft ready · Lease documents"));
});

test("bell and star marks, DND, Bounced and Unmatched tags show on their lines", () => {
  const out = wrap({}, <ContactList />);
  assert.ok(has(out, 'data-testid="bell-elena"') && has(out, 'data-testid="star-marcus"') && !has(out, 'data-testid="star-elena"'));
  assert.ok(has(out, 'data-testid="dnd-wei"') && has(out, 'data-testid="dnd-hannah"') && has(out, ">DND<"));
  assert.ok(has(out, 'data-testid="bounced-ben"') && has(out, ">Bounced<") && has(out, "An email to ben@okafor.example bounced"));
  assert.ok(has(out, 'data-testid="unmatched-unk"') && has(out, ">Unmatched<"));
  assert.ok(!has(out, 'data-testid="dnd-elena"') && !has(out, 'data-testid="bounced-elena"'));
});

test("the unread time is drawn in the accent colour and the More button waits for hover or selection", () => {
  const out = wrap({}, <ContactList />);
  assert.ok(!has(out, 'data-testid="more-elena"'), "no More button on a quiet line");
  const sel = wrap({ selected: "elena" }, <ContactList />);
  assert.ok(has(sel, 'data-testid="more-elena"') && has(sel, 'aria-label="More"'), "the selected line shows More in place of the time");
  assert.ok(has(out, "var(--accent)"), "unread time token");
});

test("the sidebar has Client portal under Shared, Billing's number under Agents and Starred in Lists", () => {
  const s = createSampleInbox();
  const out = renderToStaticMarkup(<InboxDataProvider value={s.data}><InboxStateProvider initial={{}}><InboxSidebar /></InboxStateProvider></InboxDataProvider>).replaceAll("<!-- -->", "");
  for (const label of ["Client portal", "Billing's number", "Starred"]) assert.ok(has(out, `>${label}<`), label);
  const shared = out.indexOf(">Shared<"), agents = out.indexOf(">Agents<"), lists = out.indexOf(">Lists<");
  assert.ok(shared < out.indexOf(">Client portal<") && out.indexOf(">Client portal<") < agents);
  assert.ok(agents < out.indexOf(">Billing's number<") && out.indexOf(">Billing's number<") < lists);
  const counts = s.data.screens.query("inbox.sidebar", "counts").getSnapshot();
  assert.equal(counts.status, "ready");
  const groups = navGroups([], (counts as { status: "ready"; data: Parameters<typeof navGroups>[1] & object }).data, s.data.numbers?.());
  assert.deepEqual(groups.find((g) => g.key === "agent")?.items.map((i) => i.label), ["Billing's number"]);
});
