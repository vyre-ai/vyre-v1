// Projects: every project record gets its own folder in Files > Projects, linked through the record's folder field, renamed and trashed with it, with access that follows the record.
import test from "node:test";
import assert from "node:assert/strict";
import { DANA, LEO, MAYA, harness } from "../fixtures/harness.ts";
import type { Harness } from "../fixtures/harness.ts";
import { mkProject } from "../fixtures/seed.ts";
import {
  adoptRecord,
  backfill,
  folderNameOf,
  onFolderUnfollowed,
  onRecordEvent,
  syncAccess,
} from "../handlers/folders.ts";
import { FOLLOW_BACKOFF_MS } from "../projections.ts";

/** A project record made the way the Records page makes one: a row with no projects row and no folder. */
function mkRecord(h: Harness, fields: Record<string, unknown>, type = "project"): string {
  const id = h.world.next("rec");
  h.world.records.set(id, { id, type, fields: { ...fields } });
  return id;
}
const created = (h: Harness, recordId: string, type = "project") =>
  onRecordEvent(h.ctx, { name: "record.created", payload: { recordId, type, fields: {} }, actor: DANA });
const named = (h: Harness, name: string) =>
  [...h.world.folders.values()].filter((f) => f.name === name && f.parentId === h.world.root.folderId);

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
  const a = mkRecord(h, { title: "Plan" }),
    b = mkRecord(h, { title: "Plan" }),
    c = mkRecord(h, { title: "Plan" });
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
  const a = mkRecord(h, { title: "Alpha" }),
    b = mkRecord(h, { title: "Beta" });
  await created(h, a);
  await created(h, b);
  h.world.records.get(a)!.fields["title"] = "Gamma";
  await onRecordEvent(h.ctx, {
    name: "record.updated",
    payload: { recordId: a, type: "project", fields: { title: "Gamma" }, prev: { title: "Alpha" } },
  });
  assert.equal(h.world.folders.get(String(h.world.records.get(a)!.fields["folder"]))!.name, "Gamma");
  h.world.records.get(a)!.fields["title"] = "Beta";
  await onRecordEvent(h.ctx, {
    name: "record.updated",
    payload: { recordId: a, type: "project", fields: { title: "Beta" }, prev: { title: "Gamma" } },
  });
  assert.equal(h.world.folders.get(String(h.world.records.get(a)!.fields["folder"]))!.name, "Beta 2");
  // a second update with the same title changes nothing
  h.clear();
  await onRecordEvent(h.ctx, {
    name: "record.updated",
    payload: { recordId: a, type: "project", fields: { title: "Beta" }, prev: { title: "Beta" } },
  });
  assert.equal(h.world.folders.get(String(h.world.records.get(a)!.fields["folder"]))!.name, "Beta 2");
});

test("trashing the project sends its folder to Trash with it, restoring brings it back, and nothing is purged", async () => {
  const h = harness();
  const id = mkRecord(h, { title: "Test" });
  await created(h, id);
  const folderId = String(h.world.records.get(id)!.fields["folder"]);
  await onRecordEvent(h.ctx, {
    name: "record.deleted",
    payload: { recordId: id, type: "project", prev: { title: "Test", folder: folderId } },
  });
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
  h.world.handlers["files.folder.delete"] = () => {
    throw Object.assign(new Error("held"), { error: { code: "permission.on_hold", message: "held" } });
  };
  await onRecordEvent(h.ctx, {
    name: "record.deleted",
    payload: { recordId: id, type: "project", prev: { folder: folderId } },
  });
  assert.ok(h.warned.includes("projects: a project folder was not moved with its record"));
  assert.equal(h.world.folders.get(folderId)!.deleted, undefined);
});

test("the folder takes the record's grants, the maker and the lead at Manage, written with one source", async () => {
  const h = harness();
  const id = mkRecord(h, { title: "Test", lead: LEO });
  h.world.recordShares.set(id, [
    { subject: { kind: "person", id: MAYA }, level: "edit" },
    { subject: { kind: "group", id: "grp_team" }, level: "view" },
    { subject: { kind: "link", id: "lnk_x" }, level: "view" },
  ]);
  await created(h, id);
  const folderId = String(h.world.records.get(id)!.fields["folder"]);
  const got = h.world.grants
    .filter((g) => g.resource.id === folderId)
    .map((g) => [g.subject.id, g.level, g.source])
    .sort();
  assert.deepEqual(
    got,
    [
      [DANA, "manage", `projfolder-maker:${id}`],
      ["grp_team", "view", `projfolder:${id}`],
      [LEO, "manage", `projfolder:${id}`],
      [MAYA, "edit", `projfolder:${id}`],
    ].sort(),
  );
});

test("access is brought in line again: a removed share is revoked, a changed level replaced, an equal one untouched", async () => {
  const h = harness();
  const id = mkRecord(h, { title: "Test" });
  h.world.recordShares.set(id, [
    { subject: { kind: "person", id: MAYA }, level: "edit" },
    { subject: { kind: "person", id: LEO }, level: "view" },
  ]);
  await created(h, id);
  const folderId = String(h.world.records.get(id)!.fields["folder"]);
  h.world.recordShares.set(id, [{ subject: { kind: "person", id: MAYA }, level: "view" }]);
  h.clear();
  await syncAccess(h.ctx, "project", id, folderId);
  const got = h.world.grants
    .filter((g) => g.resource.id === folderId)
    .map((g) => [g.subject.id, g.level])
    .sort();
  assert.deepEqual(
    got,
    [
      [DANA, "manage"],
      [MAYA, "view"],
    ].sort(),
    "Leo's share is revoked, Maya's level is replaced, the maker keeps Manage",
  );
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
  assert.equal(
    h.world.grants.some((g) => g.source.startsWith("projfolder:")),
    false,
  );
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
  assert.equal(
    h.rows("SELECT folderId FROM projects_project WHERE recordId = ?", filled)[0]!["folderId"],
    "fld_theirs",
  );
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
  h.world.recordShares.set(id, [
    { subject: { kind: "person", id: MAYA }, level: "edit" },
    { subject: { kind: "person", id: DANA }, level: "view" },
  ]);
  await created(h, id);
  const made = (await adoptRecord(h.ctx, "project", id))!;
  const roles = h
    .rows("SELECT principal, role FROM projects_member WHERE projectId = ?", made.projectId)
    .map((r) => [r["principal"], r["role"]])
    .sort();
  assert.deepEqual(
    roles,
    [
      [DANA, "guest"],
      [LEO, "lead"],
      [MAYA, "member"],
    ].sort(),
  );
  assert.equal(
    h.world.grants.some((g) => g.source.startsWith("projfolder")),
    false,
  );
  assert.ok(
    h.world.grants.some(
      (g) =>
        g.resource.id === made.folderId &&
        g.subject.id === MAYA &&
        g.level === "edit" &&
        g.source === `project:${made.projectId}`,
    ),
  );
});

test("adopting a record that already has a project does nothing", async () => {
  const h = harness();
  const p = await mkProject(h);
  assert.equal(await adoptRecord(h.ctx, "project", p.recordId), undefined);
  assert.equal(h.rows("SELECT * FROM projects_project").length, 1);
});

// ---- the files folder of any record

import { fileIntoRecord, recordFilesFolder } from "../handlers/folders.ts";

test("a record that is not a project gets its files folder under Record files on first use, and the same one after", async () => {
  const h = harness();
  const id = mkRecord(h, { name: "Elena Rivera" }, "contact");
  const none = await recordFilesFolder(h.ctx, { type: "contact", recordId: id, create: false });
  assert.equal(none.folderId, null, "nothing is made when only asking");
  assert.equal(h.only("files.folder.create").length, 0);
  const a = await recordFilesFolder(h.ctx, { type: "contact", recordId: id });
  const b = await recordFilesFolder(h.ctx, { type: "contact", recordId: id });
  assert.equal(a.folderId, b.folderId);
  const made = [...h.world.folders.values()];
  const folder = made.find((f) => f.folderId === a.folderId)!;
  assert.equal(folder.name, `Elena Rivera · ${id.slice(-8)}`);
  const home = made.find((f) => f.folderId === folder.parentId)!;
  assert.equal(home.name, "Record files");
  assert.equal(home.parentId, h.world.root.folderId, "under Projects");
  assert.equal(
    (await recordFilesFolder(h.ctx, { type: "contact", recordId: id, create: false })).folderId,
    a.folderId,
    "found again without making anything",
  );
});

test("a record that has its own folder (a project) uses it, and two records share one Record files folder", async () => {
  const h = harness();
  const own = mkRecord(h, { title: "Plan", folder: "fld_theirs" });
  assert.equal((await recordFilesFolder(h.ctx, { type: "project", recordId: own })).folderId, "fld_theirs");
  assert.equal(h.only("files.folder.create").length, 0);
  const x = mkRecord(h, { name: "A" }, "contact");
  const y = mkRecord(h, { name: "B" }, "contact");
  await recordFilesFolder(h.ctx, { type: "contact", recordId: x });
  await recordFilesFolder(h.ctx, { type: "contact", recordId: y });
  assert.equal([...h.world.folders.values()].filter((f) => f.name === "Record files").length, 1);
});

test("a file already in Files is moved into the record's folder, never copied; a missing record is refused", async () => {
  const h = harness();
  const id = mkRecord(h, { name: "Elena" }, "contact");
  const folderId = await fileIntoRecord(h.ctx, { type: "contact", recordId: id, fileId: "fil_1" });
  assert.equal(h.only("files.move").length, 1);
  assert.deepEqual(h.only("files.move")[0]!.input, { fileId: "fil_1", toFolderId: folderId });
  assert.equal(h.only("files.create").length, 0, "no second copy");
  await assert.rejects(recordFilesFolder(h.ctx, { type: "contact", recordId: "rec_none" }), /no such record/);
});

// ---- a file put in a files field is filed in the record's folder

test("a file that lands in a files field of any record is moved into the record's folder, by every path that sets the field", async () => {
  const h = harness();
  h.world.handlers["schema.types.get"] = () => ({
    type: {
      key: "contact",
      fields: [
        { key: "name", type: "text" },
        { key: "id_doc", type: "files" },
        { key: "photo", type: "file" },
      ],
    },
  });
  const id = mkRecord(h, { name: "Ada" }, "contact");
  await onRecordEvent(h.ctx, {
    name: "record.updated",
    payload: {
      recordId: id,
      type: "contact",
      fields: { id_doc: [{ fileId: "fil_a" }, "fil_b"], photo: { fileId: "fil_c" }, name: "Ada" },
    },
    actor: DANA,
  });
  const moves = h
    .only("files.move")
    .map((m) => (m.input as { fileId: string }).fileId)
    .sort();
  assert.deepEqual(moves, ["fil_a", "fil_b", "fil_c"], "each file, once, moved not copied");
  const folder = [...h.world.folders.values()].find((f) => f.name.startsWith("Ada ·"))!;
  assert.ok(h.only("files.move").every((m) => (m.input as { toFolderId: string }).toFolderId === folder.folderId));
  assert.equal(h.only("files.create").length, 0, "no second copy");
  await onRecordEvent(h.ctx, {
    name: "record.created",
    payload: { recordId: id, type: "contact", fields: { name: "Ada" } },
    actor: DANA,
  });
  assert.equal(h.only("files.move").length, 3, "a change to another field moves nothing");
});

test("a file that cannot be moved is left alone and the rest are still filed", async () => {
  const h = harness();
  h.world.handlers["schema.types.get"] = () => ({ type: { key: "contact", fields: [{ key: "docs", type: "files" }] } });
  h.world.handlers["files.get"] = (i: { fileId: string }) =>
    i.fileId === "fil_gone"
      ? ((): never => {
          throw Object.assign(new Error("gone"), { code: "validation.not_found" });
        })()
      : { file: { fileId: i.fileId } };
  const id = mkRecord(h, { name: "Bo" }, "contact");
  await onRecordEvent(h.ctx, {
    name: "record.updated",
    payload: { recordId: id, type: "contact", fields: { docs: ["fil_gone", "fil_ok"] } },
    actor: DANA,
  });
  assert.deepEqual(
    h.only("files.move").map((m) => (m.input as { fileId: string }).fileId),
    ["fil_ok"],
  );
});

test("a record share taken away while the folder's sync is mid-way is not written back onto the folder", async () => {
  const h = harness();
  const id = mkRecord(h, { title: "Race" });
  h.world.recordShares.set(id, [{ subject: { kind: "person", id: MAYA }, level: "edit" }]);
  await created(h, id);
  const folderId = String(h.world.records.get(id)!.fields["folder"]);
  // Leo is given the record; the sync reads that, and its write of Leo's folder copy is held
  h.world.recordShares.set(id, [
    { subject: { kind: "person", id: MAYA }, level: "edit" },
    { subject: { kind: "person", id: LEO }, level: "view" },
  ]);
  const real = h.world.handlers["access.share"]!;
  let release!: () => void, reached!: () => void;
  const gate = new Promise<void>((r) => {
    release = r;
  });
  const held = new Promise<void>((r) => {
    reached = r;
  });
  h.world.handlers["access.share"] = async (i, o) => {
    if (i.subject?.id === LEO && i.resource?.id === folderId) {
      reached();
      await gate;
    }
    return real(i, o);
  };
  const sync = syncAccess(h.ctx, "project", id, folderId);
  await held;
  h.world.recordShares.set(id, [{ subject: { kind: "person", id: MAYA }, level: "edit" }]); // Leo's record share is taken away now
  release();
  await sync;
  assert.deepEqual(
    h.world.grants.filter((g) => g.resource.id === folderId && g.subject.id === LEO),
    [],
    "Leo holds nothing on the record's folder",
  );
  assert.ok(
    h.world.grants.some((g) => g.resource.id === folderId && g.subject.id === MAYA),
    "Maya keeps hers",
  );
});

test("a folder that cannot follow its record says so as an event, and the host's consumer narrows it to the people added and tells the admins when the record has no owner", async () => {
  const h = harness();
  h.world.refuse.follows = true;
  const id = mkRecord(h, { title: "Private deal" });
  await created(h, id);
  const folder = named(h, "Private deal")[0]!.folderId;
  const ev = h.emitted.find((e) => e.name === "project.folder_unfollowed");
  assert.ok(ev, "the refusal is an event, never a quiet gap");
  assert.equal(ev!.payload["folderId"], folder);
  assert.equal(
    h.only("tasks.create").length,
    0,
    "the caller itself narrows and notifies nothing: it has no Manage to narrow with",
  );
  await onFolderUnfollowed(h.ctx, ev!.payload);
  assert.deepEqual(
    h.only("access.folder_narrow").map((c) => c.input),
    [{ folderId: folder }],
  );
  const tasks = h.only("tasks.create").map((c) => c.input as { title: string; assigned: { kind: string; id: string } });
  assert.equal(tasks.length, 1);
  assert.match(tasks[0]!.title, /limited to the people added/);
  assert.deepEqual(
    tasks[0]!.assigned,
    { kind: "role", id: "rol_admin" },
    "never the caller that was refused: no owner here, so the admins",
  );
});

test("a refused caller that is a service goes to the record's owner, else the Space's admins; a folder the host could not narrow says so", async () => {
  const h = harness();
  h.world.refuse.follows = true; // the host's own attempt is refused too
  const id = mkRecord(h, { title: "Owned deal", assigned: "usr_owner1" });
  await onFolderUnfollowed(h.ctx, { folderId: "fld_x", recordId: id, by: "svc_form_x", why: "no_grant" });
  const t1 = h.only("tasks.create").map((c) => c.input as { assigned: { kind: string; id: string } });
  assert.deepEqual(t1[0]!.assigned, { kind: "person", id: "usr_owner1" });
  const h2 = harness();
  h2.world.refuse.follows = true;
  const id2 = mkRecord(h2, { title: "Nobody's deal" });
  h2.world.down.add("access.folder_narrow");
  await onFolderUnfollowed(h2.ctx, { folderId: "fld_y", recordId: id2, by: `svc_${"a1".repeat(16)}`, why: "no_grant" });
  const t2 = h2.only("tasks.create").map((c) => c.input as { title: string; assigned: { kind: string; id: string } });
  assert.deepEqual(t2[0]!.assigned, { kind: "role", id: "rol_admin" });
  assert.match(t2[0]!.title, /could not be limited/);
});

test("a folder that follows its record makes no task and is not narrowed", async () => {
  const h = harness();
  const id = mkRecord(h, { title: "Open deal" });
  await created(h, id);
  assert.equal(h.only("tasks.create").length, 0);
  assert.equal(h.only("access.folder_narrow").length, 0);
});

test("only a refusal of rights narrows a folder: a neighbour that is down or a record that is gone emits nothing and closes nothing; and a folder the host can attach after all is not narrowed", async () => {
  for (const code of ["internal.unavailable", "validation.not_found"]) {
    const h = harness();
    h.world.refuse.follows = true;
    h.world.refuse.code = code;
    const id = mkRecord(h, { title: `Deal ${code}` });
    await created(h, id);
    assert.ok(!h.emitted.some((e) => e.name === "project.folder_unfollowed"), `${code}: no event`);
    assert.equal(h.only("access.folder_narrow").length, 0, `${code}: nothing narrowed`);
    assert.equal(h.only("tasks.create").length, 0);
    // even a forged event with such a refusal changes nothing when the host's own follows attempt fails for a non-rights reason
    await onFolderUnfollowed(h.ctx, { folderId: "fld_z", recordId: id, by: "svc_form_x", why: "x" });
    assert.equal(h.only("access.folder_narrow").length, 0, `${code}: the consumer narrows nothing either`);
  }
  const h = harness();
  h.world.refuse.follows = true;
  const id = mkRecord(h, { title: "Late fix" });
  await created(h, id);
  const ev = h.emitted.find((e) => e.name === "project.folder_unfollowed")!;
  h.world.refuse.follows = false; // the host's own attempt now succeeds: the folder follows, so it is not narrowed
  await onFolderUnfollowed(h.ctx, ev.payload);
  assert.equal(h.only("access.folder_narrow").length, 0);
  assert.equal(h.only("tasks.create").length, 0);
});

test("a transient error is tried again with a short backoff and the folder follows; it is never narrowed for it", async () => {
  const h = harness();
  h.world.refuse.follows = true;
  h.world.refuse.code = "internal.unavailable";
  h.world.refuse.times = 1; // down once, then up
  const id = mkRecord(h, { title: "Flaky" });
  await created(h, id);
  assert.equal(
    h.only("access.audience_set").filter((c) => (c.input as { follows?: string }).follows === id).length,
    2,
    "asked again",
  );
  assert.ok(!h.emitted.some((e) => e.name === "project.folder_unfollowed"));
  assert.equal(h.only("access.folder_narrow").length, 0);
  assert.ok(FOLLOW_BACKOFF_MS.length > 0);
});

test("the boot sweep never narrows: a transient error across many folders, and even a real refusal, only re-attempt the follows", async () => {
  for (const code of ["internal.unavailable", "permission.no_grant"]) {
    const h = harness();
    const ids = [1, 2, 3, 4, 5].map((n) => mkRecord(h, { title: `Deal ${code} ${n}` }));
    for (const id of ids) await created(h, id);
    h.world.refuse.follows = true;
    h.world.refuse.code = code;
    await backfill(h.ctx);
    assert.ok(h.only("access.audience_set").length > 0, `${code}: the sweep tried`);
    assert.ok(!h.emitted.some((e) => e.name === "project.folder_unfollowed"), `${code}: no event from the sweep`);
    assert.equal(h.only("access.folder_narrow").length, 0, `${code}: nothing narrowed`);
    assert.equal(h.only("tasks.create").length, 0);
  }
});

test("a real refusal narrows exactly that folder, and only when the host's own attempt is refused too; a folder that already follows is left alone", async () => {
  const h = harness();
  const a = mkRecord(h, { title: "Refused deal" });
  const b = mkRecord(h, { title: "Fine deal" });
  await created(h, b);
  h.world.refuse.follows = true;
  await created(h, a);
  const evs = h.emitted.filter((e) => e.name === "project.folder_unfollowed");
  assert.equal(evs.length, 1, "one refusal, one event");
  await onFolderUnfollowed(h.ctx, evs[0]!.payload, "evt_1");
  assert.deepEqual(
    h.only("access.folder_narrow").map((c) => c.input),
    [{ folderId: named(h, "Refused deal")[0]!.folderId }],
  );
  // a folder whose parent is already the record is not touched
  const h2 = harness();
  const id2 = mkRecord(h2, { title: "Already" });
  await created(h2, id2);
  const f2 = [...h2.world.folders.values()].find((f) => f.name === "Already")!;
  f2.parentId = id2;
  h2.world.refuse.follows = true;
  await onFolderUnfollowed(h2.ctx, { folderId: f2.folderId, recordId: id2, by: "svc_form_x", why: "x" }, "evt_2");
  assert.equal(h2.only("access.folder_narrow").length, 0);
  assert.equal(h2.only("tasks.create").length, 0);
});

test("a later, separate failure for the same folder raises its own task", async () => {
  const h = harness();
  h.world.refuse.follows = true;
  const id = mkRecord(h, { title: "Twice" });
  await onFolderUnfollowed(h.ctx, { folderId: "fld_t", recordId: id, by: "svc_form_x", why: "x" }, "evt_a");
  h.world.closed.delete("fld_t"); // reopened by a person since
  await onFolderUnfollowed(h.ctx, { folderId: "fld_t", recordId: id, by: "svc_form_x", why: "x" }, "evt_b");
  const keys = h.only("tasks.create").map((c) => (c.input as { idempotencyKey: string }).idempotencyKey);
  assert.equal(new Set(keys).size, 2);
});

test("a Personal Space has no sharing: access answers needs_team, which is not a refusal; no event, no narrowing, no task", async () => {
  const h = harness();
  h.world.refuse.follows = true;
  h.world.refuse.code = "permission.needs_team";
  const id = mkRecord(h, { title: "My own file" });
  await created(h, id);
  assert.ok(!h.emitted.some((e) => e.name === "project.folder_unfollowed"), "nothing to report");
  assert.equal(h.only("access.folder_narrow").length, 0);
  assert.equal(h.only("tasks.create").length, 0);
  // and even an event that arrives anyway narrows nothing and files nothing
  await onFolderUnfollowed(
    h.ctx,
    { folderId: "fld_p", recordId: id, by: "svc_host", why: "permission.needs_team" },
    "evt_p",
  );
  assert.equal(h.only("access.folder_narrow").length, 0);
  assert.equal(h.only("tasks.create").length, 0);
});

test("narrowing a folder that is already closed to the people added changes nobody's access: no narrowing call, no task", async () => {
  const h = harness();
  h.world.refuse.follows = true;
  const id = mkRecord(h, { title: "Closed already" });
  await created(h, id);
  const ev = h.emitted.find((e) => e.name === "project.folder_unfollowed")!;
  const folder = String(ev.payload["folderId"]);
  h.world.closed.add(folder);
  await onFolderUnfollowed(h.ctx, ev.payload, "evt_c");
  assert.equal(h.only("access.folder_narrow").length, 0);
  assert.equal(h.only("tasks.create").length, 0);
});

test("class guard: a Space's first run files no Needs-you task whatever the follow answers that is not a real refusal of rights", async () => {
  // a fresh Space (Personal or team): the folders follow, or cannot because there is no sharing, or a neighbour is slow to wake, or the record is gone; none of that is a task for a person
  for (const code of [
    "permission.needs_team",
    "internal.unavailable",
    "validation.not_found",
    "provider.unavailable",
  ]) {
    for (const times of [undefined, 1]) {
      const h = harness();
      h.world.refuse.follows = true;
      h.world.refuse.code = code;
      if (times !== undefined) h.world.refuse.times = times;
      for (const n of [1, 2, 3]) await created(h, mkRecord(h, { title: `First run ${code} ${n} ${times}` }));
      await backfill(h.ctx);
      for (const e of h.emitted.filter((x) => x.name === "project.folder_unfollowed"))
        await onFolderUnfollowed(h.ctx, e.payload, "evt_g");
      assert.equal(h.only("tasks.create").length, 0, `${code} (${times ?? "always"}): no task`);
      assert.equal(h.only("access.folder_narrow").length, 0, `${code} (${times ?? "always"}): nothing narrowed`);
    }
  }
  const fresh = harness();
  for (const n of [1, 2]) await created(fresh, mkRecord(fresh, { title: `Plain ${n}` }));
  await backfill(fresh.ctx);
  assert.equal(fresh.only("tasks.create").length, 0, "a Space where everything follows files nothing");
});

test("a record event asks the schema for its type once, not once for the files and once for the project template", async () => {
  const h = harness();
  const id = mkRecord(h, { title: "Ada" }, "contact");
  await onRecordEvent(h.ctx, {
    name: "record.created",
    payload: { recordId: id, type: "contact", fields: { name: "Ada" } },
    actor: DANA,
  } as never);
  assert.equal(h.only("schema.types.get").length, 1, "one read of the type for the event");
});
