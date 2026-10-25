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
  const suffix = (k: string): string => out.match(new RegExp(`data-testid="row-line:${k}-suffix"[^>]*>([^<]*)<`))?.[1] ?? "";
  assert.equal(suffix("elena"), "Rivera Holdings");
  assert.equal(suffix("marcus"), "Pruitt &amp; Co.");
  assert.equal(suffix("dana"), "Whitfield Group");
  assert.equal(suffix("unk"), "", "an unmatched sender has no organisation");
});

test("Draft ready leads the preview of a line an agent has a draft for, and only that line", () => {
  const out = wrap({}, <ContactList />);
  assert.ok(has(out, "Draft ready · Can you resend invoice 1041?") && has(out, "Draft ready · Re: Spring check-in"));
  assert.ok(!has(out, "Draft ready · Lease documents"));
});

test("the lines are the tall Row, and an unread name is bold", () => {
  const out = wrap({}, <ContactList />);
  const row = (k: string): string => out.match(new RegExp(`<[a-z]+[^>]*data-testid="row-line:${k}"[^>]*>`))?.[0] ?? "";
  assert.ok(row("elena").includes("62px"), `62 px rows: ${row("elena").slice(0, 400)}`);
  assert.ok(out.includes("font-weight:600"), "bold unread titles");
});

test("an unmatched sender is its own accent-wash block with the match button on its right, not a Row", () => {
  const out = wrap({}, <ContactList />);
  assert.ok(has(out, 'data-testid="row-line:unk"') && !has(out, 'data-testid="row-line:unk-leading"'), "no Row slots on the banner");
  assert.ok(has(out, "background-color:var(--accent-wash)") && has(out, 'data-testid="match-unk"') && has(out, 'data-testid="face-ghost"'));
});

test("bell and star marks, DND and Bounced tags show on their lines", () => {
  const out = wrap({}, <ContactList />);
  assert.ok(has(out, 'data-testid="bell-elena"') && has(out, 'data-testid="star-marcus"') && !has(out, 'data-testid="star-elena"'));
  assert.ok(has(out, 'data-testid="dnd-jonas"') && !has(out, 'data-testid="dnd-wei"') && has(out, ">DND<"));
  assert.ok(has(out, 'data-testid="bounced-ben"') && has(out, ">Bounced<") && has(out, "An email to ben@okafor.example bounced"));
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
  const html = (t: string): string => t.replaceAll("'", "&#x27;");
  for (const label of ["Client portal", "Billing's number", "Starred"]) assert.ok(has(out, `>${html(label)}<`), label);
  const shared = out.indexOf(">Shared<"), agents = out.indexOf(">Agents<"), lists = out.indexOf(">Lists<");
  assert.ok(shared < out.indexOf(">Client portal<") && out.indexOf(">Client portal<") < agents);
  assert.ok(agents < out.indexOf(">Billing&#x27;s number<") && out.indexOf(">Billing&#x27;s number<") < lists);
  const counts = s.data.screens.query("inbox.sidebar", "counts").getSnapshot();
  assert.equal(counts.status, "ready");
  const groups = navGroups([], (counts as { status: "ready"; data: Parameters<typeof navGroups>[1] & object }).data, s.data.numbers?.());
  assert.deepEqual(groups.find((g) => g.key === "agent")?.items.map((i) => i.label), ["Billing's number"]);
});
