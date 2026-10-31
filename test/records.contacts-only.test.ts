// Contacts-only start and easy type making, through the real schema module and registry. It lives here, not beside the Records screens, because it reaches across the app into a module.
import test from "node:test";
import assert from "node:assert/strict";
import { loadRegistry, openSchema } from "../modules/schema/impl.ts";
import { typeGroups, worthShowing } from "../apps/app/src/places/records/sidebar/model.ts";
import type { TypeRow } from "../apps/app/src/places/records/sidebar/model.ts";
import { STARTER_FIELDS, commitChange, createTypeOps, stageChange, typeSections } from "../apps/app/src/places/records/typeedit/model.ts";
import type { Call } from "../apps/app/src/places/records/typeedit/model.ts";

/** What a new Space lists: every type the default registry seeds, all empty. */
function seededRows(counts: Record<string, number> = {}): TypeRow[] {
  return loadRegistry().recordTypes.map((t) => ({
    key: t.key, title: t.title ?? t.key, plural: t.plural ?? t.key, icon: t.icon ?? "table", label: "internal", system: t.system === true, rowCount: counts[t.key] ?? 0, fieldCount: t.fields.length, ...(t.group ? { group: t.group } : {}),
  }) as TypeRow);
}
const shown = (rows: TypeRow[]): string[] => typeGroups(rows).flatMap((g) => g.items.map((i) => i.key));
const onPage = (rows: TypeRow[]): string[] => typeSections(rows).flatMap((g) => g.items.map((i) => i.key));

const ctx = { trace: { traceId: "0123456789abcdef0123456789abcdef" }, emit: () => undefined, actor: "usr_owner" };

async function realCall(): Promise<{ call: Call; schema: ReturnType<typeof openSchema> }> {
  const schema = openSchema({ path: ":memory:", now: () => 1_800_000_000_000 });
  await schema.start();
  const call: Call = async (cap, input) => (schema.handlers as unknown as Record<string, (c: unknown, i: unknown) => Promise<unknown>>)[cap]!(ctx, input);
  return { call, schema };
}

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

test("every starter chip makes its field with one apply", async () => {
  assert.deepEqual(STARTER_FIELDS.map((f) => f.title), ["Email", "Phone", "Date", "Due date", "Close date", "Amount", "Number", "Stage", "Status", "Choice", "Multi choice", "Checkbox", "Owner", "Files", "URL", "Notes", "Rating"]);
  const { call, schema } = await realCall();
  const made = createTypeOps({ name: "Deal", plural: "", icon: "table", takenKeys: [], starters: STARTER_FIELDS.map((f) => f.key) });
  const staged = await stageChange(call, made.ops);
  assert.ok(staged.ok, staged.ok ? "" : staged.error);
  assert.ok((await commitChange(call, (staged as { ok: true; staged: Parameters<typeof commitChange>[1] }).staged)).ok);
  const deal = ((await call("schema.types.get", { type: "deal" })) as { type: { fields: { key: string; type: string }[] } }).type;
  assert.deepEqual(deal.fields.map((f) => [f.key, f.type]), [["name", "text"], ...STARTER_FIELDS.map((f) => [f.key, f.type === "multichoice" ? "multi_choice" : f.type])]);   // types.get names this one by the store kind
  schema.host?.close();
});
