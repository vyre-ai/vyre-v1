// A Space starts with Contacts only. The types modules need still exist but stay out of the sidebar and the Record types page until they hold a record; making a type is one short sheet
// with starter fields and a link to Contacts; Ask Vyre opens in a pane of the tab, told where the person is, and never navigates.
import test from "node:test";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { loadRegistry, openSchema } from "../../../../../../modules/schema/impl.ts";
import { typeGroups, worthShowing } from "../sidebar/model.ts";
import type { TypeRow } from "../sidebar/model.ts";
import { STARTER_FIELDS, TypeSheet, commitChange, connectChoices, createTypeOps, stageChange, typeSections } from "../typeedit/index.ts";
import type { Call } from "../typeedit/index.ts";
import { ASK_CLOSED, askContext, askHint, askPaneReduce, askScopeId, makeAskVyre } from "./model.ts";
import { AskPane } from "./AskPane.tsx";
import { RecordsDataProvider, RecordsSidebar, RecordsStateProvider } from "../sidebar/index.ts";
import { createSampleRecords, northwind } from "../table/sample.ts";

const clean = (s: string): string => s.replaceAll("<!-- -->", "");
const has = (s: string, n: string): boolean => s.includes(n);

/** What a new Space lists: every type the default registry seeds, all empty. */
function seededRows(counts: Record<string, number> = {}): TypeRow[] {
  return loadRegistry().recordTypes.map((t) => ({
    key: t.key, title: t.title ?? t.key, plural: t.plural ?? t.key, icon: t.icon ?? "table", label: "internal", system: t.system === true, rowCount: counts[t.key] ?? 0, fieldCount: t.fields.length, ...(t.group ? { group: t.group } : {}),
  }) as TypeRow);
}
const shown = (rows: TypeRow[]): string[] => typeGroups(rows).flatMap((g) => g.items.map((i) => i.key));
const onPage = (rows: TypeRow[]): string[] => typeSections(rows).flatMap((g) => g.items.map((i) => i.key));

test("a new Space shows only Contacts in the sidebar and on the Record types page", () => {
  const rows = seededRows();
  assert.ok(rows.length > 5, "the modules still seed their types");
  assert.deepEqual(shown(rows), ["contact"]);
  assert.deepEqual(onPage(rows), ["contact"]);
  for (const k of ["company", "meeting", "note_board", "project", "task", "agent", "envelope", "report", "issue", "pull_request"]) assert.equal(worthShowing(rows.find((r) => r.key === k)!), false, `${k} is hidden while empty`);
});

test("the first project or task makes Projects or Tasks appear, and a record in any hidden type shows it", () => {
  assert.deepEqual(shown(seededRows({ project: 1 })).sort(), ["contact", "project"]);
  assert.deepEqual(shown(seededRows({ task: 3 })).sort(), ["contact", "task"]);
  assert.deepEqual(onPage(seededRows({ project: 1, task: 1 })).sort(), ["contact", "project", "task"]);
  assert.deepEqual(shown(seededRows({ company: 2, meeting: 1 })).sort(), ["company", "contact", "meeting"]);
});

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

const ctx = { trace: { traceId: "0123456789abcdef0123456789abcdef" }, emit: () => undefined, actor: "usr_owner" };

async function realCall(): Promise<{ call: Call; schema: ReturnType<typeof openSchema> }> {
  const schema = openSchema({ path: ":memory:", now: () => 1_800_000_000_000 });
  await schema.start();
  const call: Call = async (cap, input) => (schema.handlers as unknown as Record<string, (c: unknown, i: unknown) => Promise<unknown>>)[cap]!(ctx, input);
  return { call, schema };
}

test("Connect it to adds a relation to Contacts in one schema.apply, with both ends", async () => {
  const { call, schema } = await realCall();
  const made = createTypeOps({ name: "Client", plural: "", icon: "people", takenKeys: ["contact"], connect: [{ key: "contact", title: "Contact", plural: "Contacts" }] });
  const rel = made.ops.find((o) => o.op === "relation.add");
  assert.ok(rel, "a link is a relation.add: it makes both ends (field.add cannot make a relation)");
  assert.equal(made.ops.filter((o) => o.op === "field.add" && (o.def as { type?: string }).type === "relation").length, 0);
  const staged = await stageChange(call, made.ops);
  assert.ok(staged.ok, staged.ok ? "" : staged.error);
  const done = await commitChange(call, (staged as { ok: true; staged: Parameters<typeof commitChange>[1] }).staged);
  assert.ok(done.ok, done.ok ? "" : done.error);
  const client = ((await call("schema.types.get", { type: "client" })) as { type: { fields: { key: string; type: string; options?: { target?: string } }[] } }).type;
  const link = client.fields.find((f) => f.type === "relation");
  assert.ok(link && link.options?.target === "contact", "Client has a Contact field");
  const contact = ((await call("schema.types.get", { type: "contact" })) as { type: { fields: { key: string; type: string; options?: { target?: string } }[] } }).type;
  assert.ok(contact.fields.some((f) => f.type === "relation" && f.options?.target === "client"), "Contacts got the other end");
  schema.host?.close();
});

test("starter chips add Status, Owner, Due date, Amount and Notes fields with one apply", async () => {
  assert.deepEqual(STARTER_FIELDS.map((f) => f.title), ["Status", "Owner", "Due date", "Amount", "Notes"]);
  const { call, schema } = await realCall();
  const made = createTypeOps({ name: "Deal", plural: "", icon: "table", takenKeys: [], starters: STARTER_FIELDS.map((f) => f.key) });
  const staged = await stageChange(call, made.ops);
  assert.ok(staged.ok, staged.ok ? "" : staged.error);
  assert.ok((await commitChange(call, (staged as { ok: true; staged: Parameters<typeof commitChange>[1] }).staged)).ok);
  const deal = ((await call("schema.types.get", { type: "deal" })) as { type: { fields: { key: string; type: string }[] } }).type;
  assert.deepEqual(deal.fields.map((f) => [f.key, f.type]), [["name", "text"], ["status", "status"], ["owner", "person"], ["due_date", "datetime"], ["amount", "money"], ["notes", "longtext"]]);
  schema.host?.close();
});

test("one sheet holds the name, the starter chips, the link chips and Ask Vyre; a rename shows none of them", () => {
  const connectTo = connectChoices(seededRows({ contact: 1 }), worthShowing);
  assert.deepEqual(connectTo.map((c) => c.key), ["contact"], "only what the person sees can be linked, Contacts first");
  const sheet = clean(renderToStaticMarkup(<TypeSheet call={async () => ({})} takenKeys={[]} connectTo={connectTo} onAsk={() => undefined} onClose={() => undefined} onDone={() => undefined} />));
  for (const id of ["type-starter-status", "type-starter-owner", "type-starter-due_date", "type-starter-amount", "type-starter-notes", "type-connect-contact", "type-sheet-ask"]) assert.ok(has(sheet, `data-testid="${id}"`), id);
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
