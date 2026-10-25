// P-L9b_06c: Needs you as the prototype draws it: a Withdrawn section that does not count, amber "new rate" tags in the invoice table, the participants button, Approve filled
// black with its A key hint, and Harbor Studio showing its own two requests.
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { NeedsYou } from "../needsyou/NeedsYou.tsx";
import { blockView, filterCounts, isWithdrawn, participants, peopleCount, sortItems, splitWithdrawn } from "../needsyou/model.ts";
import type { Item } from "../needsyou/model.ts";
import { createSample } from "../needsyou/sample.ts";
import type { Sample, Variant } from "../needsyou/sample.ts";

const ALL = { start: 0, end: 500 };
const html = (v: Variant, sel?: string): string =>
  renderToStaticMarkup(<NeedsYou data={createSample(v).data} window={ALL} {...(sel ? { initialSelected: sel } : {})} />).replaceAll("<!-- -->", "").replaceAll("&amp;", "&");
const has = (s: string, needle: string): boolean => s.includes(needle);
const items = (s: Sample): Item[] => s.replica.rows("needs") as unknown as Item[];

test("withdrawn requests sit under a Withdrawn label, dimmed, and are not counted", () => {
  const out = html("northwind");
  assert.ok(has(out, 'data-testid="needs-withdrawn-label"') && has(out, ">Withdrawn<"));
  assert.ok(out.indexOf("Send the Pruitt fee letter") > out.indexOf('data-testid="needs-withdrawn-label"'), "after the label");
  assert.ok(out.indexOf('data-testid="needs-withdrawn-label"') > out.indexOf("Month-end export is waiting on a sign-in"), "after every live request");
  assert.ok(has(out, "Withdrawn: the fee changed and Docs is redrafting it."));
  assert.ok(has(out, 'data-testid="needs-count"') && has(out, ">7<"), "the count stays seven");
  const s = createSample("northwind");
  const { live, withdrawn } = splitWithdrawn(items(s));
  assert.equal(live.length, 7);
  assert.deepEqual(withdrawn.map((i) => i.task.id), ["n8"]);
  assert.equal(filterCounts(items(s)).all, 7);
  assert.equal(sortItems(items(s)).at(-1)?.task.id, "n8", "withdrawn sorts last");
  assert.ok(isWithdrawn(withdrawn[0]!));
});

test("a withdrawn request opens with nothing to do but Dismiss", () => {
  const out = html("northwind", "n8");
  assert.ok(has(out, "Withdrawn by Docs, nothing to do.") && has(out, 'data-testid="needs-primary"') && has(out, ">Dismiss<"));
  assert.ok(!has(out, 'data-testid="needs-sendback"'));
});

test("the invoice table marks the two clients with new rates in amber", () => {
  const out = html("northwind", "n1");
  assert.equal(out.split('data-testid="row-tag"').length - 1, 2);
  assert.ok(has(out, "new rate"));
  const n1 = items(createSample("northwind")).find((i) => i.task.id === "n1")!;
  const view = blockView(n1.task.blocks[0]!);
  assert.deepEqual(view.type === "table" ? view.tags : null, ["", "new rate", "", "", "new rate"]);
});

test("the participants button shows how many people are on the request and lists them", () => {
  const out = html("northwind", "n1");
  assert.ok(has(out, 'data-testid="needs-participants"') && has(out, 'aria-label="Participants, 1"'));
  const n1 = items(createSample("northwind")).find((i) => i.task.id === "n1")!.task;
  const list = participants(n1, (id) => (id.startsWith("usr_") ? "person" : "agent"));
  assert.deepEqual(list.map((p) => [p.id, p.role]), [["agt_billing", "Requester, Assigned"], ["usr_irfad", "Approver"]]);
  assert.equal(peopleCount(list), 1);
});

test("Approve is the black button with its A key hint, Send back follows with B", () => {
  const out = html("northwind", "n1");
  const at = out.indexOf('data-testid="needs-primary"');
  assert.ok(at > 0 && out.slice(at, at + 900).includes(">A<"));
  assert.ok(out.indexOf('data-testid="needs-sendback"') > at && out.slice(out.indexOf('data-testid="needs-sendback"')).includes(">B<"));
  assert.ok(out.slice(at - 400, at + 400).includes("var(--ink)"), "filled with the ink token, not the accent");
});

test("Harbor Studio shows its two requests", () => {
  const out = html("harbor");
  assert.ok(has(out, "Confirm 3 studio visits") && has(out, "Abel homepage copy") && has(out, ">2<"));
  assert.ok(!has(out, 'data-testid="needs-empty"'));
  assert.ok(has(html("quiet"), 'data-testid="needs-empty"'), "a Space with nothing waiting still says so");
});
