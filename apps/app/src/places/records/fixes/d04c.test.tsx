// P-L9d_04c: the record page as the prototype draws it: a hero (face, kind, title, status chip, owner, when it changed), Overview and Conversation tabs, Previous, Next and the star in the header,
// and the value an agent proposed with Accept and Reject. Screens render with react-dom/server over react-native-web (ruling 28), where effects do not run, so what the page loads after its first
// paint (the proposals, the view's order) is checked through the same capability calls the page makes.
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { RecordPage, RecordPageDataProvider } from "../recordpage/index.ts";
import { SAMPLE_NOW, createSamplePage } from "../recordpage/sample.ts";
import type { SamplePage } from "../recordpage/sample.ts";
import type { RecordRow } from "../recordpage/model.ts";

const page = (s: SamplePage, order?: readonly string[]): string =>
  renderToStaticMarkup(<RecordPageDataProvider value={s.data}><RecordPage type="clients" recordId="cl_0" {...(order ? { order } : {})} /></RecordPageDataProvider>).replaceAll("<!-- -->", "");
const has = (s: string, n: string): boolean => s.includes(n);
const at = (s: string, n: string): number => { const i = s.indexOf(n); assert.ok(i >= 0, `expected ${n}`); return i; };
const row = (s: SamplePage): RecordRow => (s.replica.rows("records:clients") as unknown as RecordRow[]).find((r) => r.id === "cl_0")!;
const call = async <T,>(s: SamplePage, cap: string, input: unknown): Promise<T> => (await s.data.call(cap, input)) as T;

test("hero: the kind, a face, the title, the status chip, the owner and when it was updated", () => {
  const out = page(createSamplePage());
  assert.ok(has(out, 'data-testid="record-kind"') && has(out, ">Client<"));
  assert.ok(at(out, 'data-testid="record-kind"') < at(out, 'data-testid="face-Elena Rivera"') && at(out, 'data-testid="face-Elena Rivera"') < at(out, 'data-testid="title"'), "kind, then face, then title");
  const chips = out.slice(at(out, 'data-testid="record-chips"'), at(out, 'data-testid="record-chips"') + 1500);
  assert.ok(has(chips, ">Active<"), "the status as a chip");
  assert.ok(has(chips, "Maya Chen"), "the owner");
  assert.ok(has(chips, "Updated 2 days ago"), "when it changed");
});

test("Overview and Conversation tabs: Overview is selected, Conversation opens the chat in the pane", () => {
  const out = page(createSamplePage());
  assert.match(out.match(/<[^>]*data-testid="tab-overview"[^>]*>/)?.[0] ?? "", /aria-selected="true"/);
  assert.match(out.match(/<[^>]*data-testid="tab-conversation"[^>]*>/)?.[0] ?? "", /aria-selected="false"/);
  assert.ok(has(out, 'data-testid="open-chat-link"'), "Open in Chats");
});

test("Previous and Next walk the order of the view; at the ends the button is off, and without an order they are not drawn", () => {
  const s = createSamplePage();
  const first = page(s, ["cl_0", "cl_1", "cl_2"]);
  assert.match(first.match(/<[^>]*data-testid="prev"[^>]*>/)?.[0] ?? "", /disabled|aria-disabled="true"/, "nothing before the first");
  assert.doesNotMatch(first.match(/<[^>]*data-testid="next"[^>]*>/)?.[0] ?? "", /aria-disabled="true"/);
  const last = renderToStaticMarkup(<RecordPageDataProvider value={s.data}><RecordPage type="clients" recordId="cl_2" order={["cl_0", "cl_1", "cl_2"]} /></RecordPageDataProvider>);
  assert.match(last.replaceAll("<!-- -->", "").match(/<[^>]*data-testid="next"[^>]*>/)?.[0] ?? "", /disabled|aria-disabled="true"/, "nothing after the last");
  assert.ok(!has(page(createSamplePage()), 'data-testid="prev"'), "no order, no arrows until the type's list arrives");
});

test("the type's own list is the order when none is given", async () => {
  const s = createSamplePage();
  const out = await call<{ rows: { id: string }[] }>(s, "records.query", { type: "clients" });
  assert.deepEqual(out.rows.map((r) => r.id), ["cl_0", "cl_1", "cl_2"]);
});

test("star: drawn when the shell gives it, starts as the shell says, and toggling is one call to the shell", () => {
  const s = createSamplePage();
  const out = page(s);
  assert.match(out.match(/<[^>]*data-testid="star"[^>]*>/)?.[0] ?? "", /aria-pressed="true"/, "Elena is starred in the sample");
  assert.equal(s.data.star!.get("clients", "cl_0"), true);
  s.data.star!.set("clients", "cl_0", false);
  assert.equal(s.data.star!.get("clients", "cl_0"), false);
  assert.match(page(s).match(/<[^>]*data-testid="star"[^>]*>/)?.[0] ?? "", /aria-pressed="false"/);
  const { star: _star, ...bare } = s.data;
  void _star;
  assert.ok(!has(renderToStaticMarkup(<RecordPageDataProvider value={bare}><RecordPage type="clients" recordId="cl_0" /></RecordPageDataProvider>), 'data-testid="star"'), "no star without the shell's hook");
});

test("a proposed value waits with who proposed it; Accept writes it and Reject keeps the field as it was", async () => {
  const s = createSamplePage();
  const waiting = await call<{ values: { recordId: string; field: string; value: string; source: { actor: string; state: string } }[] }>(s, "records.values.pending", { type: "clients" });
  assert.equal(waiting.values.length, 1);
  assert.deepEqual([waiting.values[0]!.recordId, waiting.values[0]!.field, waiting.values[0]!.value, waiting.values[0]!.source.state], ["cl_0", "phone", "+1 415 555 0161", "needs_review"]);
  assert.equal(row(s).fields["phone"], undefined, "nothing is written until a person decides");
  await call(s, "records.values.review", { type: "clients", recordId: "cl_0", field: "phone", decision: "accept" });
  assert.equal(row(s).fields["phone"], "+1 415 555 0161");
  assert.equal((await call<{ values: unknown[] }>(s, "records.values.pending", { type: "clients" })).values.length, 0, "and it leaves the queue");
  const t = createSamplePage();
  await call(t, "records.values.review", { type: "clients", recordId: "cl_0", field: "phone", decision: "reject" });
  assert.equal(row(t).fields["phone"], undefined, "Reject keeps the old value");
  await assert.rejects(() => call(t, "records.values.review", { type: "clients", recordId: "cl_0", field: "phone", decision: "accept" }), /nothing is waiting/);
});

test("no copy on the record page uses an em dash", () => {
  assert.ok(!has(page(createSamplePage(), ["cl_0", "cl_1"]), String.fromCharCode(0x2014)));
  void SAMPLE_NOW;
});
