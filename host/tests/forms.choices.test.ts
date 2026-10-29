import test from "node:test";
import assert from "node:assert/strict";
import { createChoiceSource } from "../src/daemon/forms-choices.ts";

const calls: string[] = [];
const rows: Record<string, { id: string; label: number; fields: Record<string, unknown>; deletedAt?: number }> = {
  rec_ok: { id: "rec_ok", label: 1, fields: { name: "Acme", notes: "private" } },
  rec_conf: { id: "rec_conf", label: 2, fields: { name: "Hidden" } },
  rec_trash: { id: "rec_trash", label: 0, fields: { name: "Old" }, deletedAt: 5 },
  rec_blank: { id: "rec_blank", label: 0, fields: { name: "  " } },
  rec_long: { id: "rec_long", label: 0, fields: { name: "x".repeat(300) } },
  rec_ctl: { id: "rec_ctl", label: 0, fields: { name: "Line\nbreak\u0000" } },
};
let titleLabel: string | undefined; let typeLabel: string | undefined;
const src = createChoiceSource({
  async as(person, cap, input) {
    calls.push(`${person}:${cap}`);
    const i = input as { type: string; recordId?: string };
    if (person === "usr_blind") throw new Error("denied");
    if (cap === "schema.types.get") return { type: { titleField: "name", ...(typeLabel ? { label: typeLabel } : {}), fields: [{ key: "name", ...(titleLabel ? { label: titleLabel } : {}) }] } };
    if (cap === "records.get") { const r = rows[i.recordId!]; if (!r) throw new Error("not found"); return { record: r }; }
    return { rows: Object.values(rows) };
  },
  people: () => [{ id: "usr_maya", name: "Maya" }],
});
const company = { key: "company", title: "Company", type: "relation", options: { target: "company" } };
const owner = { key: "owner", title: "Owner", type: "person" };

test("a record is offered by its title only, at or below internal", async () => {
  assert.deepEqual(await src.describe("usr_a", company, "rec_ok"), { ok: true, label: "Acme" });
  for (const id of ["rec_conf", "rec_trash", "rec_blank", "rec_missing"]) assert.equal((await src.describe("usr_a", company, id)).ok, false, id);
  const long = await src.describe("usr_a", company, "rec_long");
  assert.ok(long.ok && long.label.length === 120);
  const ctl = await src.describe("usr_a", company, "rec_ctl");
  assert.ok(ctl.ok && !/[\u0000-\u001f]/.test(ctl.label));
});
test("a title field above internal refuses the record", async () => {
  for (const level of ["confidential", "restricted", "surprise"]) {
    titleLabel = level;
    assert.equal((await src.describe("usr_a", company, "rec_ok")).ok, false, level);
  }
  titleLabel = "internal";
  assert.equal((await src.describe("usr_a", company, "rec_ok")).ok, true);
  titleLabel = undefined;
});
test("a type classified above internal refuses all its records, even a public-labelled row", async () => {
  typeLabel = "confidential";
  assert.equal((await src.describe("usr_a", company, "rec_blank")).ok, false);
  assert.equal((await src.describe("usr_a", company, "rec_long")).ok, false);
  assert.deepEqual(await src.candidates("usr_a", company, undefined), []);
  typeLabel = undefined;
});
test("everything runs as the publisher, and a publisher who cannot see the type or record is refused", async () => {
  calls.length = 0;
  await src.describe("usr_a", company, "rec_ok");
  assert.ok(calls.every((c) => c.startsWith("usr_a:")));
  assert.equal((await src.describe("usr_blind", company, "rec_ok")).ok, false);
  assert.deepEqual(await src.candidates("usr_blind", company, undefined), []);
});
test("candidates exclude refused records, and people are active members by display name", async () => {
  assert.deepEqual((await src.candidates("usr_a", company, undefined)).map((c) => c.refId).sort(), ["rec_ctl", "rec_long", "rec_ok"]);
  assert.deepEqual(await src.describe("usr_a", owner, "usr_maya"), { ok: true, label: "Maya" });
  assert.equal((await src.describe("usr_a", owner, "agt_bot")).ok, false);
  assert.deepEqual(await src.candidates("usr_a", owner, "may"), [{ refId: "usr_maya", label: "Maya" }]);
});
