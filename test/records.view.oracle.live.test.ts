// A saved view carries its own filter and sort, and records.view runs them on the server. A person whose grant hides a field must not be handed the rows that field's value picked: before, a view filtered by a hidden
// email returned the contacts with that email (the column cut), so the view said which record had which hidden value, and its total counted them. Real server-role daemon, real access and records modules.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { bootHour } from "./support/member-hour.ts";
import type { Hour } from "./support/member-hour.ts";
import { hiddenMember } from "./support/hidden-member.ts";

let h: Hour;
before(async () => {
  h = await bootHour("vieworacle");
});
after(async () => {
  await h?.stop();
});

test("a view filtered or sorted by a field the grant hides picks and places nothing for that person; the owner's view and a view on a visible field are unchanged", async () => {
  const f = await hiddenMember(h);
  const save = async (title: string, spec: Record<string, unknown>): Promise<string> => {
    const r = (await h.owner.call("views.save", {
      type: "contact",
      kind: "table",
      title: `${title} ${f.rid.slice(-6)}`,
      idempotencyKey: `vo-${title}-${f.rid}`,
      ...spec,
    })) as { view: { viewId: string } };
    await h.owner.call("views.publish", { viewId: r.view.viewId, shared: true });
    return r.view.viewId;
  };
  const byEmail = await save("by email", { filter: { field: "email", op: "eq", value: f.values.newEmail } });
  const byName = await save("by name", { filter: { field: "name", op: "contains", value: "Probe Hana" } });
  const sorted = await save("sorted", { sort: [{ field: "email", dir: "asc" }] });
  const rowsOf = async (
    who: { attempt(cap: string, input?: Record<string, unknown>): Promise<{ ok: boolean; data?: unknown }> },
    viewId: string,
  ): Promise<string[]> => {
    const r = await who.attempt("records.view", { type: "contact", viewId });
    return r.ok ? (r.data as { rows: Array<{ id: string }> }).rows.map((x) => x.id) : [];
  };
  // controls: the owner's views pick the contact by its email and by its name; the person's view on the visible name picks it too
  assert.ok((await rowsOf(h.owner, byEmail)).includes(f.rid), "control: the owner's view by email picks the contact");
  assert.ok(
    (await rowsOf(f.member, byName)).includes(f.rid),
    "control: the person's view by the visible name picks it",
  );
  // the probes
  assert.equal(
    (await rowsOf(f.member, byEmail)).includes(f.rid),
    false,
    "a view filtered by the hidden email picks no row for the person",
  );
  const total = await f.member.attempt("records.view", { type: "contact", viewId: byEmail });
  assert.equal(
    total.ok
      ? (total.data as { total?: number }).total === undefined || (total.data as { total: number }).total === 0
      : true,
    true,
    "and its total does not count the rows the hidden value picked",
  );
  assert.equal(
    (await rowsOf(f.member, sorted)).includes(f.rid),
    false,
    "a view sorted by the hidden email places no row for the person",
  );
});
