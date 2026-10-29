// What a computer that joined may do in an agent's home: only the home folder and what is below it, decided from the Files tables on this server.
import test from "node:test";
import assert from "node:assert/strict";
import { homeCallAllowed } from "../src/daemon/home-confine.ts";

const folders: Record<string, string | null> = { fld_home: "fld_agents", fld_sub: "fld_home", fld_deep: "fld_sub", fld_agents: null, fld_clients: "fld_agents", fld_loop_a: "fld_loop_b", fld_loop_b: "fld_loop_a" };
const files: Record<string, string> = { fil_in: "fld_deep", fil_out: "fld_clients", fil_root: "fld_home" };
const db = { all: (sql: string, id: string) => (sql.includes("files_folder") ? (id in folders ? [{ parent_id: folders[id] }] : []) : id in files ? [{ folder_id: files[id] }] : []) };
const scope = { homeFolder: "fld_home", ownerId: "usr_owner", agentId: "agt_a" };
const ok = (cap: string, input: unknown) => homeCallAllowed(db, scope, cap, input);

test("the home folder and anything below it, at any depth, is reachable; its siblings and parents are not", () => {
  assert.equal(ok("files.list", { folder: "fld_home" }), true);
  assert.equal(ok("files.list", { folder: "fld_deep" }), true);
  assert.equal(ok("files.list", { folder: "fld_clients" }), false);
  assert.equal(ok("files.list", { folder: "fld_agents" }), false);
  assert.equal(ok("files.list", {}), false);
  assert.equal(ok("files.read", { fileId: "fil_in" }), true);
  assert.equal(ok("files.read", { fileId: "fil_out" }), false);
  assert.equal(ok("files.write", { fileId: "fil_out" }), false);
  assert.equal(ok("files.delete", { fileId: "fil_root" }), true);
  assert.equal(ok("files.delete", { fileId: "fil_out" }), false);
  assert.equal(ok("files.create", { folderId: "fld_sub" }), true);
  assert.equal(ok("files.create", { folderId: "fld_clients" }), false);
  assert.equal(ok("files.folder.create", { parentId: "fld_home" }), true);
  assert.equal(ok("files.folder.create", { parentId: "fld_agents" }), false);
});

test("an unknown id, a loop in the tree, an unknown call and a wrong shape are refused, never guessed", () => {
  assert.equal(ok("files.list", { folder: "fld_nope" }), false);
  assert.equal(ok("files.list", { folder: "fld_loop_a" }), false, "a cycle ends in a refusal");
  assert.equal(ok("files.read", { fileId: "fil_nope" }), false);
  assert.equal(ok("secrets.reveal", {}), false);
  assert.equal(ok("files.list", "fld_home"), false);
  assert.equal(ok("files.list", { folder: { id: "fld_home" } }), false);
});

test("the agent's own record, a task for its owner about files inside the home: yes; anyone else's, no", () => {
  assert.equal(ok("agents.get", { agentId: "agt_a" }), true);
  assert.equal(ok("agents.get", { agentId: "agt_b" }), false);
  assert.equal(ok("agents.suggestion.propose", { agentId: "agt_b" }), false);
  const task = (assigned: unknown, fileIds: unknown) => ok("tasks.create", { assigned, fileIds });
  assert.equal(task({ kind: "person", id: "usr_owner" }, ["fil_in"]), true);
  assert.equal(task({ kind: "person", id: "usr_other" }, ["fil_in"]), false);
  assert.equal(task({ kind: "person", id: "usr_owner" }, ["fil_out"]), false);
  assert.equal(task({ kind: "agent", id: "usr_owner" }, []), false);
  assert.equal(ok("files.upload_url", { size: 10 }), true);
});
