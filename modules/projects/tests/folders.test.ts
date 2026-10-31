// Projects: every project record gets its own folder in Files > Projects, linked through the record's folder field, renamed and trashed with it, with access that follows the record.
import test from "node:test";
import assert from "node:assert/strict";
import { DANA, LEO, MAYA, harness } from "../fixtures/harness.ts";
import type { Harness } from "../fixtures/harness.ts";
import { mkProject } from "../fixtures/seed.ts";
import { adoptRecord, backfill, folderNameOf, onRecordEvent, syncAccess } from "../handlers/folders.ts";

/** A project record made the way the Records page makes one: a row with no projects row and no folder. */
function mkRecord(h: Harness, fields: Record<string, unknown>, type = "project"): string {
  const id = h.world.next("rec");
  h.world.records.set(id, { id, type, fields: { ...fields } });
  return id;
}
const created = (h: Harness, recordId: string, type = "project") => onRecordEvent(h.ctx, { name: "record.created", payload: { recordId, type, fields: {} }, actor: DANA });
const named = (h: Harness, name: string) => [...h.world.folders.values()].filter((f) => f.name === name && f.parentId === h.world.root.folderId);

test("a project record made on the Records page gets one folder under Projects, and its folder field links to it", async () => {
  const h = harness();
  const id = mkRecord(h, { title: "Test" });
  await created(h, id);
  const folders = named(h, "Test");
  assert.equal(folders.length, 1);
  assert.equal(h.world.records.get(id)!.fields["folder"], folders[0]!.folderId);
});

test("a retried event makes no second folder", async () => {
  const h = harness();
  const id = mkRecord(h, { title: "Test" });
  await created(h, id);
  await created(h, id);
  assert.equal(named(h, "Test").length, 1);
  assert.equal(h.only("files.folder.create").length, 1, "the second run saw the field and stopped");
});

test("a retry after the folder was made but before the field was written finds the same folder", async () => {
  const h = harness();
  const id = mkRecord(h, { title: "Test" });
  h.world.down.add("records.update");
  await assert.rejects(created(h, id));
  h.world.down.delete("records.update");
  await created(h, id);
  assert.equal(named(h, "Test").length, 1);
  assert.equal([...h.world.folders.values()].length, 2, "the Projects root and one project folder");
  assert.equal(h.world.records.get(id)!.fields["folder"], named(h, "Test")[0]!.folderId);
});

test("a project that already has a folder is left alone", async () => {
  const h = harness();
  const id = mkRecord(h, { title: "Test", folder: "fld_theirs" });
  await created(h, id);
  assert.equal(h.only("files.folder.create").length, 0);
  assert.equal(h.world.records.get(id)!.fields["folder"], "fld_theirs");
});

test("a project made by projects.create keeps the one folder it made", async () => {
  const h = harness();
  const made = await mkProject(h);
  await created(h, made.recordId);
  assert.equal(h.only("files.folder.create").length, 1);
  assert.equal(h.world.records.get(made.recordId)!.fields["folder"], made.folderId);
});

test("a record of a type that is not a project type gets no folder", async () => {
  const h = harness();
  const id = mkRecord(h, { title: "Ada" }, "contact");
  await created(h, id, "contact");
  assert.equal(h.only("files.folder.create").length, 0);
  assert.equal(h.world.records.get(id)!.fields["folder"], undefined);
});

test("two projects with one name get Name and Name 2", async () => {
  const h = harness();
  const a = mkRecord(h, { title: "Plan" }), b = mkRecord(h, { title: "Plan" }), c = mkRecord(h, { title: "Plan" });
  for (const id of [a, b, c]) await created(h, id);
  const name = (id: string) => h.world.folders.get(String(h.world.records.get(id)!.fields["folder"]))!.name;
  assert.deepEqual([a, b, c].map(name), ["Plan", "Plan 2", "Plan 3"]);
});

test("a title with a slash or no title still makes a usable folder name", () => {
  assert.equal(folderNameOf("Q1/Q2 plan"), "Q1-Q2 plan");
  assert.equal(folderNameOf("   "), "Untitled project");
  assert.equal(folderNameOf(undefined), "Untitled project");
});

test("renaming the project renames its folder; a clash takes a number", async () => {
  const h = harness();
  const a = mkRecord(h, { title: "Alpha" }), b = mkRecord(h, { title: "Beta" });
  await created(h, a); await created(h, b);
  h.world.records.get(a)!.fields["title"] = "Gamma";
  await onRecordEvent(h.ctx, { name: "record.updated", payload: { recordId: a, type: "project", fields: { title: "Gamma" }, prev: { title: "Alpha" } } });
  assert.equal(h.world.folders.get(String(h.world.records.get(a)!.fields["folder"]))!.name, "Gamma");
  h.world.records.get(a)!.fields["title"] = "Beta";
  await onRecordEvent(h.ctx, { name: "record.updated", payload: { recordId: a, type: "project", fields: { title: "Beta" }, prev: { title: "Gamma" } } });
  assert.equal(h.world.folders.get(String(h.world.records.get(a)!.fields["folder"]))!.name, "Beta 2");
  // a second update with the same title changes nothing
  h.clear();
  await onRecordEvent(h.ctx, { name: "record.updated", payload: { recordId: a, type: "project", fields: { title: "Beta" }, prev: { title: "Beta" } } });
  assert.equal(h.world.folders.get(String(h.world.records.get(a)!.fields["folder"]))!.name, "Beta 2");
});

test("trashing the project sends its folder to Trash with it, restoring brings it back, and nothing is purged", async () => {
  const h = harness();
  const id = mkRecord(h, { title: "Test" });
  await created(h, id);
  const folderId = String(h.world.records.get(id)!.fields["folder"]);
  await onRecordEvent(h.ctx, { name: "record.deleted", payload: { recordId: id, type: "project", prev: { title: "Test", folder: folderId } } });
  assert.equal(h.world.folders.get(folderId)!.deleted, true);
  await onRecordEvent(h.ctx, { name: "record.restored", payload: { recordId: id, type: "project" } });
  assert.equal(h.world.folders.get(folderId)!.deleted, undefined);
  assert.equal(h.world.calls.filter((c) => /purge/.test(c.cap)).length, 0);
});

test("a Gate hold on the folder delete does not fail the event", async () => {
  const h = harness();
  const id = mkRecord(h, { title: "Test" });
  await created(h, id);
  const folderId = String(h.world.records.get(id)!.fields["folder"]);
  h.world.handlers["files.folder.delete"] = () => { throw Object.assign(new Error("held"), { error: { code: "permission.on_hold", message: "held" } }); };
  await onRecordEvent(h.ctx, { name: "record.deleted", payload: { recordId: id, type: "project", prev: { folder: folderId } } });
  assert.ok(h.warned.includes("projects: a project folder was not moved with its record"));
  assert.equal(h.world.folders.get(folderId)!.deleted, undefined);
});

test("the folder takes the record's grants, the maker and the lead at Manage, written with one source", async () => {
  const h = harness();
  const id = mkRecord(h, { title: "Test", lead: LEO });
  h.world.recordShares.set(id, [{ subject: { kind: "person", id: MAYA }, level: "edit" }, { subject: { kind: "group", id: "grp_team" }, level: "view" }, { subject: { kind: "link", id: "lnk_x" }, level: "view" }]);
  await created(h, id);
  const folderId = String(h.world.records.get(id)!.fields["folder"]);
  const got = h.world.grants.filter((g) => g.resource.id === folderId).map((g) => [g.subject.id, g.level, g.source]).sort();
  assert.deepEqual(got, [[DANA, "manage", `projfolder-maker:${id}`], ["grp_team", "view", `projfolder:${id}`], [LEO, "manage", `projfolder:${id}`], [MAYA, "edit", `projfolder:${id}`]].sort());
});

test("access is brought in line again: a removed share is revoked, a changed level replaced, an equal one untouched", async () => {
  const h = harness();
  const id = mkRecord(h, { title: "Test" });
  h.world.recordShares.set(id, [{ subject: { kind: "person", id: MAYA }, level: "edit" }, { subject: { kind: "person", id: LEO }, level: "view" }]);
  await created(h, id);
  const folderId = String(h.world.records.get(id)!.fields["folder"]);
  h.world.recordShares.set(id, [{ subject: { kind: "person", id: MAYA }, level: "view" }]);
  h.clear();
  await syncAccess(h.ctx, "project", id, folderId);
  const got = h.world.grants.filter((g) => g.resource.id === folderId).map((g) => [g.subject.id, g.level]).sort();
  assert.deepEqual(got, [[DANA, "manage"], [MAYA, "view"]].sort(), "Leo's share is revoked, Maya's level is replaced, the maker keeps Manage");
});

test("in a Personal Space no grant is written: the owner is the access", async () => {
  const h = harness();
  h.world.handlers["spaces.matrix"] = () => ({ kind: "personal" });
  const id = mkRecord(h, { title: "Test" });
  await created(h, id);
  assert.equal(h.world.grants.length, 0);
  assert.equal(named(h, "Test").length, 1);
});

test("a project made by projects.create keeps its role grants; the record mirror writes none for it", async () => {
  const h = harness();
  const made = await mkProject(h);
  const before = h.world.grants.length;
  h.world.recordShares.set(made.recordId, [{ subject: { kind: "person", id: MAYA }, level: "edit" }]);
  await backfill(h.ctx);
  assert.equal(h.world.grants.length, before);
  assert.equal(h.world.grants.some((g) => g.source.startsWith("projfolder:")), false);
});

test("the boot sweep adopts a bare project record: a project row, one channel, and the folder field filled; a filled one keeps its folder", async () => {
  const h = harness();
  const empty = mkRecord(h, { title: "Test" });
  const filled = mkRecord(h, { title: "Other", folder: "fld_theirs" });
  const made = await backfill(h.ctx);
  assert.equal(made, 1);
  assert.equal(named(h, "Test").length, 1);
  assert.equal(h.world.records.get(empty)!.fields["folder"], named(h, "Test")[0]!.folderId);
  assert.equal(h.world.records.get(filled)!.fields["folder"], "fld_theirs");
  assert.equal(named(h, "Other").length, 0);
  assert.equal(h.rows("SELECT * FROM projects_project").length, 2);
  assert.equal(h.world.channels.size, 2);
  assert.equal(h.rows("SELECT folderId FROM projects_project WHERE recordId = ?", filled)[0]!["folderId"], "fld_theirs");
  assert.equal(h.world.records.get(empty)!.fields["channel"] !== undefined, true);
  assert.equal(await backfill(h.ctx), 0, "a second sweep makes nothing");
  assert.equal(h.world.channels.size, 2);
  assert.equal(h.only("files.folder.create").length, 1);
});

test("adopting a record whose folder the event already made reuses that folder and makes no second", async () => {
  const h = harness();
  const id = mkRecord(h, { title: "Test" });
  await created(h, id);
  const folderId = String(h.world.records.get(id)!.fields["folder"]);
  const made = await adoptRecord(h.ctx, "project", id);
  assert.equal(made?.folderId, folderId);
  assert.equal(h.only("files.folder.create").length, 1);
  assert.equal(h.world.channels.size, 1);
});

test("adopting turns the record's lead and shares into roles on the project and its folder, and drops the mirror grants", async () => {
  const h = harness();
  const id = mkRecord(h, { title: "Test", lead: LEO });
  h.world.recordShares.set(id, [{ subject: { kind: "person", id: MAYA }, level: "edit" }, { subject: { kind: "person", id: DANA }, level: "view" }]);
  await created(h, id);
  const made = (await adoptRecord(h.ctx, "project", id))!;
  const roles = h.rows("SELECT principal, role FROM projects_member WHERE projectId = ?", made.projectId).map((r) => [r["principal"], r["role"]]).sort();
  assert.deepEqual(roles, [[DANA, "guest"], [LEO, "lead"], [MAYA, "member"]].sort());
  assert.equal(h.world.grants.some((g) => g.source.startsWith("projfolder")), false);
  assert.ok(h.world.grants.some((g) => g.resource.id === made.folderId && g.subject.id === MAYA && g.level === "edit" && g.source === `project:${made.projectId}`));
});

test("adopting a record that already has a project does nothing", async () => {
  const h = harness();
  const p = await mkProject(h);
  assert.equal(await adoptRecord(h.ctx, "project", p.recordId), undefined);
  assert.equal(h.rows("SELECT * FROM projects_project").length, 1);
});
