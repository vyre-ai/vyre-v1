// What a person owns in Files, for the removal wizard (P-L7_21): their files and their own folders, and what reassigning does to them. Real SQLite with the module's own tables.
// @reads /generated/modules/files/schema.sql
// @reads /modules/files/migrations/0001_files_tree.sql
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ProjectionHost } from "../../../kernel/src/store/projection.ts";
import { hostCalls } from "../impl.ts";

const read = (rel: string): string => readFileSync(new URL(rel, import.meta.url), "utf8");
const statements = (sql: string): string[] => sql.split("\n").filter((l) => !l.trimStart().startsWith("--")).join("\n").split(";").map((x) => x.trim()).filter((x) => x.length > 0);

function db() {
  const host = ProjectionHost.open({ path: ":memory:", space: "spc_t", projections: [] });
  for (const f of ["../../../generated/modules/files/schema.sql", "../migrations/0001_files_tree.sql"]) for (const st of statements(read(f))) host.tx.run(st);
  const ctx = { now: () => 1_760_000_000_000, db: { all: (sql: string, ...a: unknown[]) => host.tx.all(sql, ...a), run: (sql: string, ...a: unknown[]) => ({ changes: Number(host.tx.run(sql, ...a).changes) }) } };
  return { host, ctx };
}

function seed(h: ReturnType<typeof db>): void {
  const run = (sql: string, ...a: unknown[]): void => { h.host.tx.run(sql, ...a); };
  run(`INSERT INTO files_folder (id, parent_id, name, path, scope, owner, created_at, updated_at) VALUES ('fld_pat', NULL, 'Pat notes', 'Pat notes', 'space', 'usr_pat', 1, 1)`);
  run(`INSERT INTO files_folder (id, parent_id, name, path, scope, owner, system_key, created_at, updated_at) VALUES ('fld_sys', NULL, 'Agents', 'Agents', 'space', 'usr_pat', 'agents', 1, 1)`);
  run(`INSERT INTO files_file (id, folder_id, name, owner, created_at, version) VALUES ('fil_a', 'fld_pat', 'plan.docx', 'usr_pat', 1, 0)`);
  run(`INSERT INTO files_file (id, folder_id, name, owner, created_at, version, deleted_at) VALUES ('fil_gone', 'fld_pat', 'old.docx', 'usr_pat', 1, 0, 5)`);
  run(`INSERT INTO files_file (id, folder_id, name, owner, created_at, version) VALUES ('fil_b', 'fld_pat', 'maya.docx', 'usr_maya', 1, 0)`);
}

test("owned_by lists the person's live files and their own folders, not a system folder, a trashed file or someone else's", () => {
  const h = db();
  seed(h);
  const out = hostCalls["files.owned_by"](h.ctx, { person: "usr_pat" });
  assert.equal(out.files.count, 2);
  assert.deepEqual(out.files.ids.sort(), ["fil_a", "fld_pat"]);
  assert.deepEqual(hostCalls["files.owned_by"](h.ctx, { person: "usr_nobody" }).files.count, 0);
});

test("reassign hands them to the other person; retain touches nothing", () => {
  const h = db();
  seed(h);
  assert.equal(hostCalls["files.reassign_owned"](h.ctx, { person: "usr_pat", kind: "files", action: "retain" }), 0);
  assert.equal(hostCalls["files.reassign_owned"](h.ctx, { person: "usr_pat", kind: "files", action: "reassign", to: "usr_admin" }), 2);
  assert.equal(hostCalls["files.owned_by"](h.ctx, { person: "usr_pat" }).files.count, 0);
  assert.equal(hostCalls["files.owned_by"](h.ctx, { person: "usr_admin" }).files.count, 2);
  assert.equal(h.host.tx.all<{ owner: string }>("SELECT owner FROM files_folder WHERE id = 'fld_sys'")[0]!.owner, "usr_pat", "a system folder keeps its owner");
  assert.equal(hostCalls["files.reassign_owned"](h.ctx, { person: "usr_pat", kind: "agents", action: "reassign", to: "usr_admin" }), 0, "another module's kind is not ours");
});
