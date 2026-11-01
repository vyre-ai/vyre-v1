// Records sharing (DESIGN-records-sharing): the contract's shares as the Share sheet's rows, the calls its choices make, and the marks the table draws.
import test from "node:test";
import assert from "node:assert/strict";
import { audienceCall, exportersCall, flagCall, hasShared, marksOf, sharedWithMe, shareCall, sheetModel, subtitleOf } from "../sharing/model.ts";
import type { MarksOut, SharesOut } from "../sharing/model.ts";

const name = (id: string): string => ({ usr_ada: "Ada", usr_bea: "Bea", usr_cal: "Cal" }[id] ?? "Someone");
const grant = (subject: string, level: "view" | "edit" | "manage", over: Record<string, unknown> = {}) => ({
  id: `gnt_${subject}`, subject: { kind: "person", id: subject }, resource: { type: "record_type", id: "deal" }, level, conditions: {}, by: "usr_ada", createdAt: 1, ...over,
});

test("the owner has their own line, the keepers an audience choice made stay out, and the switches ride on the row", () => {
  const out = {
    shares: [
      { grant: grant("usr_ada", "manage"), through: "owner" },
      { grant: grant("usr_bea", "edit", { conditions: { export: true, reshare: true } }), through: "direct" },
      { grant: grant("usr_cal", "view"), through: "direct" },
      { grant: { ...grant("rol_admin", "manage", { source: "audience" }), subject: { kind: "role", id: "rol_admin" } }, through: "role" },
    ],
    audience: "added", exporters: "chosen", can: { manage: true, share: true, export: true },
  } as unknown as SharesOut;
  const m = sheetModel(out, name);
  assert.deepEqual(m.owner, { id: "usr_ada", name: "Ada" });
  assert.deepEqual(m.rows.map((r) => [r.name, r.level, r.canExport === true, r.canShare === true, r.via]), [["Bea", "edit", true, true, "grant"], ["Cal", "view", false, false, "grant"]]);
  assert.equal(m.audience, "added");
  assert.equal(m.exporters, "chosen");
  assert.equal(m.follows, null);
  assert.equal(m.can.manage, true);
});

test("a record shows the grants of its type as coming from the type, and says which type it follows", () => {
  const out = { shares: [{ grant: grant("usr_cal", "view"), through: "folder" }], audience: "space", exporters: "admins", inherits: "deal", can: { manage: false, share: true, export: false } } as unknown as SharesOut;
  const m = sheetModel(out, name);
  assert.deepEqual(m.rows.map((r) => [r.via, r.fromFolderId]), [["folder", "deal"]]);
  assert.equal(m.follows, "deal");
});

test("a server that sends no rights draws none", () => {
  const m = sheetModel({ shares: [] } as unknown as SharesOut, name);
  assert.deepEqual(m.can, { manage: false, share: false, export: false });
  assert.equal(m.audience, "space");
  assert.equal(m.exporters, "admins");
});

test("each choice is one call: a level keeps the switches, a switch sets only itself, the audience and the exporters are their own", () => {
  const t = { type: "record_type" as const, id: "deal" };
  assert.deepEqual(shareCall(t, { kind: "person", id: "usr_cal" }, "edit"), { resource: t, subject: { kind: "person", id: "usr_cal" }, level: "edit" });
  const row = { subjectKind: "person" as const, subjectId: "usr_cal", level: "view" as const };
  assert.deepEqual(flagCall(t, row, "export", true), { resource: t, subject: { kind: "person", id: "usr_cal" }, level: "view", export: true });
  assert.deepEqual(flagCall(t, row, "reshare", false), { resource: t, subject: { kind: "person", id: "usr_cal" }, level: "view", reshare: false });
  assert.deepEqual(audienceCall(t, "me"), { resource: t, audience: "me" });
  assert.deepEqual(exportersCall(t, "viewers"), { resource: t, exporters: "viewers" });
});

test("the line under the title is short", () => {
  assert.equal(subtitleOf({ type: "record_type" }), "Every record of this type");
  assert.equal(subtitleOf({ type: "record" }), "This record");
});

test("rows that differ from their type are marked; Shared with me keeps the rows given by name, or every row when the type was", () => {
  const out = {
    typeShared: false, audience: "added", can: { manage: false, share: false, export: false },
    rows: [{ id: "rec_a", audience: "me", direct: 0, mine: false }, { id: "rec_b", audience: "space", direct: 2, mine: true }, { id: "rec_c", audience: "added", direct: 1, mine: true }],
  } as unknown as MarksOut;
  assert.deepEqual([...marksOf(out)], [["rec_a", "private"], ["rec_b", "shared"], ["rec_c", "private"]]);
  assert.deepEqual(sharedWithMe(out), ["rec_b", "rec_c"]);
  assert.equal(hasShared(out), true);
  const whole = { ...out, typeShared: true } as MarksOut;
  assert.equal(sharedWithMe(whole), null);
  assert.equal(hasShared({ ...out, rows: [] } as MarksOut), false);
  assert.equal(hasShared(null), false);
  assert.equal(marksOf(null).size, 0);
});
