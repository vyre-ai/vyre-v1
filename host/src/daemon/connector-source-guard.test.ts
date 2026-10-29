import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { createSourceGuard, isGuardedCap } from "./connector-source-guard.ts";
import type { CtxSeed } from "../invoke.ts";

// tree: shared > connectors > acme (the mapped source) > actions ; shared > other
function world(o: { initializing?: boolean } = {}) {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE files_folder (id TEXT PRIMARY KEY, parent_id TEXT, deleted_at INTEGER);
    CREATE TABLE files_file (id TEXT PRIMARY KEY, folder_id TEXT);
    CREATE TABLE files_changeset (id TEXT PRIMARY KEY, folder_id TEXT);
    CREATE TABLE cn_connectors (key TEXT PRIMARY KEY);
    CREATE TABLE cn_source_folders (key TEXT PRIMARY KEY, folder_id TEXT, created_by TEXT, created_at INTEGER);
    INSERT INTO files_folder VALUES ('fld_shared', NULL, NULL), ('fld_connectors', 'fld_shared', NULL), ('fld_acme', 'fld_connectors', NULL), ('fld_actions', 'fld_acme', NULL), ('fld_other', 'fld_shared', NULL);
    INSERT INTO files_file VALUES ('fil_main', 'fld_acme'), ('fil_action', 'fld_actions'), ('fil_notes', 'fld_other');
    INSERT INTO files_changeset VALUES ('chg_src', 'fld_acme'), ('chg_other', 'fld_other');
    INSERT INTO cn_source_folders VALUES ('acme', 'fld_acme', 'usr_dev', 0);`);
  if (!o.initializing) db.exec("INSERT INTO cn_connectors VALUES ('acme')");
  const asked: { perm: string | null | undefined; level: string; type: string; id: string | null; principal: string }[] = [];
  // usr_dev may edit connector acme and, on the Space, create connectors; usr_member may do neither
  const guard = createSourceGuard({
    db: { all: (sql, ...a) => db.prepare(sql).all(...(a as never[])) }, connectors: { all: (sql, ...a) => db.prepare(sql).all(...(a as never[])) },
    space: "spc_x",
    authorize: (r) => { asked.push({ perm: r.action.perm, level: r.action.level, type: r.resource.type, id: r.resource.id, principal: r.actingFor ?? r.principal }); return { effect: (r.actingFor ?? r.principal) === "usr_dev" ? "allow" : "deny" }; },
  });
  const seed = (id: string, actingFor?: string): CtxSeed => ({ space: "spc_x", principal: { kind: id.startsWith("agt_") ? "agent" : "person", id }, ...(actingFor ? { actingFor } : {}) });
  return { guard, asked, seed, db };
}
const check = (w: ReturnType<typeof world>, who: string, cap: string, input: object, actingFor?: string) => w.guard.check({ cap, input, seed: w.seed(who, actingFor), now: 1 });

test("a Member is refused every write into the source and below it; the developer who may edit the connector is not", () => {
  const w = world();
  const cases: [string, object][] = [
    ["files.write", { fileId: "fil_main" }], ["files.write", { fileId: "fil_action" }], ["files.save", { fileId: "fil_main" }], ["files.rename", { fileId: "fil_main" }], ["files.delete", { fileId: "fil_action" }],
    ["files.create", { folderId: "fld_actions" }], ["files.create", { folderId: "fld_acme" }], ["files.folder.create", { parentId: "fld_acme" }], ["files.upload_url", {}],
    ["files.move", { fileId: "fil_notes", toFolderId: "fld_acme" }], ["files.move", { fileId: "fil_main", toFolderId: "fld_other" }], ["files.copy", { fileId: "fil_notes", toFolderId: "fld_actions" }],
    ["files.folder.settings", { folderId: "fld_acme" }], ["files.folder.rename", { folderId: "fld_actions" }], ["files.folder.delete", { folderId: "fld_actions" }],
  ];
  for (const [cap, input] of cases) {
    if (cap === "files.upload_url") continue;   // names no folder: nothing to map
    assert.deepEqual(check(w, "usr_member", cap, input)?.key, "acme", `${cap} ${JSON.stringify(input)} is refused for a Member`);
    assert.equal(check(w, "usr_dev", cap, input), null, `${cap} ${JSON.stringify(input)} passes for a developer`);
  }
});

test("a change to a folder above the source (rename, move, delete) takes the source with it, so it is guarded; a sibling is not", () => {
  const w = world();
  for (const cap of ["files.folder.rename", "files.folder.delete", "files.folder.move", "files.folder.restore"]) {
    assert.equal(check(w, "usr_member", cap, { folderId: "fld_connectors", toParentId: "fld_other" })?.key, "acme", `${cap} on the parent folder is refused`);
  }
  assert.equal(check(w, "usr_member", "files.folder.move", { folderId: "fld_acme", toParentId: "fld_other" })?.key, "acme", "moving the source out is refused");
  assert.equal(check(w, "usr_member", "files.folder.move", { folderId: "fld_other", toParentId: "fld_actions" })?.key, "acme", "moving a folder into the source is refused");
  assert.equal(check(w, "usr_member", "files.folder.delete", { folderId: "fld_other" }), null, "a sibling folder is not the source");
  assert.equal(check(w, "usr_member", "files.write", { fileId: "fil_notes" }), null, "a file outside the source is not guarded");
  assert.equal(check(w, "usr_member", "files.create", { folderId: "fld_connectors" }), null, "a new file beside the source is not guarded");
});

test("changeset approval, edits and discard on a source are guarded; a changeset elsewhere is not; reads never are", () => {
  const w = world();
  for (const cap of ["changesets.approve", "changesets.discard", "changesets.revert_change", "changesets.edit", "changesets.request_changes"]) {
    assert.equal(check(w, "usr_member", cap, { changesetId: "chg_src" })?.key, "acme", `${cap} on a source changeset is refused`);
    assert.equal(check(w, "usr_dev", cap, { changesetId: "chg_src" }), null);
    assert.equal(check(w, "usr_member", cap, { changesetId: "chg_other" }), null);
  }
  for (const cap of ["files.read", "files.get", "files.list", "changesets.get", "changesets.diff", "files.versions"]) assert.equal(isGuardedCap(cap), false, `${cap} is a read`);
});

test("the question is asked as the original caller: an agent acting for a Member is refused, an agent acting for the developer passes", () => {
  const w = world();
  assert.equal(check(w, "agt_helper", "files.write", { fileId: "fil_main" }, "usr_member")?.key, "acme");
  assert.equal(check(w, "agt_helper", "files.write", { fileId: "fil_main" }, "usr_dev"), null);
  assert.ok(w.asked.every((a) => a.perm === "connectors.manage" && a.level === "edit" && a.type === "connector" && a.id === "acme"));
});

test("emptying Trash is guarded when it would purge a trashed source folder", () => {
  const w = world();
  assert.equal(check(w, "usr_member", "files.trash.empty", {}), null, "nothing of the source is in Trash");
  w.db.exec("UPDATE files_folder SET deleted_at = 5 WHERE id = 'fld_actions'");
  assert.equal(check(w, "usr_member", "files.trash.empty", {})?.key, "acme");
});

test("while a connector is being created only the person who made the mapping, with edit on the Space, may write; nobody else, and no Space check is skipped", () => {
  const w = world({ initializing: true });
  assert.equal(check(w, "usr_dev", "files.create", { folderId: "fld_acme" }), null, "the creator writes the first files");
  assert.deepEqual(w.asked.at(-1), { perm: "connectors.manage", level: "edit", type: "space", id: "spc_x", principal: "usr_dev" });
  assert.equal(check(w, "usr_member", "files.create", { folderId: "fld_acme" })?.key, "acme", "someone else cannot write into a source still being made");
  w.db.exec("UPDATE cn_source_folders SET created_by = 'usr_member'");
  assert.equal(check(w, "usr_member", "files.create", { folderId: "fld_acme" })?.key, "acme", "a creator without Space edit is refused");
});

test("no mapping, no work: a Space with no connector sources never queries the tree", () => {
  const w = world();
  w.db.exec("DELETE FROM cn_source_folders");
  assert.equal(check(w, "usr_member", "files.write", { fileId: "fil_main" }), null);
});
