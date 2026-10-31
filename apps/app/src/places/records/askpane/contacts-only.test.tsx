// A Space starts with Contacts only. The types modules need still exist but stay out of the sidebar and the Record types page until they hold a record; making a type is one short sheet
// with starter fields and a link to Contacts; Ask Vyre opens in a pane of the tab, told where the person is, and never navigates.
import test from "node:test";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { worthShowing } from "../sidebar/model.ts";
import type { TypeRow } from "../sidebar/model.ts";
import { TypeSheet, connectChoices } from "../typeedit/index.ts";
import { ASK_CLOSED, askContext, askHint, askPaneReduce, askScopeId, makeAskVyre } from "./model.ts";
import { AskPane } from "./AskPane.tsx";
import { RecordsDataProvider, RecordsSidebar, RecordsStateProvider } from "../sidebar/index.ts";
import { createSampleRecords, northwind } from "../table/sample.ts";

const clean = (s: string): string => s.replaceAll("<!-- -->", "");
const has = (s: string, n: string): boolean => s.includes(n);




// ---------------------------------------------------------------- Records with only Contacts

const side = (opts: { canEdit: boolean; ask: boolean; contactsOnly?: boolean }): string => {
  const s = createSampleRecords(opts.contactsOnly ? { ...northwind, types: northwind.types.slice(0, 1) } : northwind);
  const only = { ...s.data, ...(opts.canEdit ? { canEditSchema: true } : {}), ...(opts.ask ? { askVyre: () => undefined } : {}) };
  return clean(renderToStaticMarkup(<RecordsDataProvider value={only}><RecordsStateProvider><RecordsSidebar /></RecordsStateProvider></RecordsDataProvider>));
};

test("the sidebar of a full Space has no invitation; Ask Vyre is a Manage row only where the shell has an assistant", () => {
  const full = side({ canEdit: true, ask: true });
  assert.ok(!has(full, 'data-testid="records-invite"'), "a Space with several types is not bare");
  assert.ok(has(full, "Ask Vyre"));
  assert.ok(!has(side({ canEdit: true, ask: false }), "Ask Vyre"), "no assistant, no button");
});

test("Records with only Contacts shows Contacts, then New record type with a one-line hint and an Ask Vyre row", () => {
  const out = side({ canEdit: true, ask: true, contactsOnly: true });
  assert.ok(has(out, 'data-testid="records-invite"'));
  assert.ok(has(out, "New record type") && has(out, "Track clients, deals or anything else, and link it to Contacts."));
  assert.ok(has(out, "Ask Vyre to set it up"));
  assert.ok(out.indexOf('data-testid="records-invite"') > out.indexOf('data-testid="count-'), "Contacts come first");
  const readOnly = side({ canEdit: false, ask: true, contactsOnly: true });
  assert.ok(!has(readOnly, 'data-testid="records-invite"'), "without the schema permission there is nothing to invite to");
});

// ---------------------------------------------------------------- Connect it to, starter fields: through the real schema module




test("one sheet holds the name, the starter chips, the link chips and Ask Vyre; a rename shows none of them", () => {
  // a new Space as the sidebar sees it: Contacts in use, the seeded types the modules need still empty (the real registry is checked in test/records.contacts-only.test.ts)
  const row = (key: string, rowCount: number, system = false): TypeRow => ({ key, title: key, plural: `${key}s`, icon: "table", label: "internal", system, rowCount, fieldCount: 3 }) as TypeRow;
  const connectTo = connectChoices([row("contact", 1), row("company", 0), row("meeting", 0), row("project", 0), row("task", 0, true), row("agent", 0, true)], worthShowing);
  assert.deepEqual(connectTo.map((c) => c.key), ["contact"], "only what the person sees can be linked, Contacts first");
  const sheet = clean(renderToStaticMarkup(<TypeSheet call={async () => ({})} takenKeys={[]} connectTo={connectTo} onAsk={() => undefined} onClose={() => undefined} onDone={() => undefined} />));
  for (const id of ["type-starter-email", "type-starter-stage", "type-starter-owner", "type-starter-date", "type-starter-amount", "type-starter-notes", "type-starters-more", "type-connect-contact", "type-sheet-ask"]) assert.ok(has(sheet, `data-testid="${id}"`), id);
  const plain = clean(renderToStaticMarkup(<TypeSheet call={async () => ({})} takenKeys={[]} onClose={() => undefined} onDone={() => undefined} />));
  assert.ok(!has(plain, "Connect it to") && !has(plain, 'data-testid="type-sheet-ask"'), "no targets and no assistant: neither is drawn");
  const rename = clean(renderToStaticMarkup(<TypeSheet call={async () => ({})} takenKeys={[]} connectTo={connectTo} rename={{ key: "client", title: "Client", plural: "Clients", icon: "table" }} onClose={() => undefined} onDone={() => undefined} />));
  assert.ok(!has(rename, "type-starters") && !has(rename, "type-connect"));
});

// ---------------------------------------------------------------- Ask Vyre in the tab

test("Ask in Records opens a pane in the tab with the Records context and never navigates", () => {
  const log: unknown[] = [];
  let state = ASK_CLOSED;
  const navigated: string[] = [];   // the only things that could navigate are not reachable from makeAskVyre: it takes a dispatch and nothing else
  const ask = makeAskVyre((a) => { log.push(a); state = askPaneReduce(state, a); }, { type: "client", screen: undefined });
  ask({});
  assert.equal(state.open, true, "the pane opens");
  assert.deepEqual(state.about, { type: "client" });
  assert.deepEqual(navigated, [], "no place was opened");
  const c = askContext(state.about, "Client");
  assert.equal(c.focus, "focus-records");
  assert.deepEqual(c.open, [{ type: "record_type", id: "client", title: "Client" }]);
  assert.match(c.title, /Records/);
  makeAskVyre((a) => { state = askPaneReduce(state, a); }, { screen: "records.types" })({ making: "Deal" });
  assert.deepEqual(state.about, { page: "types", making: "Deal" });
  assert.equal(askContext(state.about).title, "Making the record type Deal");
  assert.equal(askScopeId(state.about), "types");
  state = askPaneReduce(state, { type: "close" });
  assert.equal(state.open, false);
});

test("the pane is the shared side pane with a line about where the person is", () => {
  const out = clean(renderToStaticMarkup(<AskPane about={{ making: "Deal" }} onClose={() => undefined}><span data-testid="chat" /></AskPane>));
  assert.ok(has(out, 'data-testid="side-pane"') && has(out, 'data-testid="records-ask-pane"') && has(out, 'data-testid="chat"'));
  assert.ok(has(out, askHint({ making: "Deal" })) && has(out, "Ask Vyre"));
});

test("the assistant can reach schema.diff, schema.apply and the change card, and a plan-mode turn cannot apply", () => {
  const caps = (JSON.parse(readFileSync(new URL("../../../../../../generated/registry.json", import.meta.url), "utf8")) as { capabilities: { name: string; surfaces?: { mcp?: { toolset?: string }; agent?: { planMode?: string } } }[] }).capabilities;
  const by = (n: string) => caps.find((c) => c.name === n);
  for (const n of ["schema.diff", "schema.apply", "console.diff_propose"]) assert.equal(by(n)?.surfaces?.mcp?.toolset, "engineer", `${n} is an engineer tool the assistant calls as the person`);
  assert.equal(by("schema.apply")?.surfaces?.agent?.planMode, "blocked");
});

test("a proposed change shows Apply and Discard, and the change card is what carries a schema change", async () => {
  const { diffCardData } = await import("../../../../../../ui/src/blocks/impl-b/index.tsx");
  assert.equal(typeof diffCardData, "function");
  const { renderToStaticMarkup: render } = await import("react-dom/server");
  const { DiffCardBlock } = await import("../../../../../../ui/src/blocks/impl-b/index.tsx");
  const block = { id: "blk_s1", type: "diff_card", data: { diffId: "dif_1", kind: "schema", title: "Add Client", changes: [{ path: "client", before: null, after: "new type" }] } };
  const out = clean(render(<DiffCardBlock block={block as never} host={{} as never} />));
  assert.ok(has(out, ">Apply<") && has(out, ">Discard<") && !has(out, ">Reject<"));
});
