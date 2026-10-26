// What a person owns in Memory, for the removal wizard (P-L7_21): the facts that came from them ("From you"); keep leaves them, delete removes them and their text. Real SQLite with the module's tables.
// @reads /modules/memory/migrations/0001_init.sql
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ProjectionHost } from "../../../kernel/src/store/projection.ts";
import { hostCalls } from "../impl.ts";

const sql = readFileSync(new URL("../migrations/0001_init.sql", import.meta.url), "utf8");
const statements = sql.split("\n").filter((l) => !l.trimStart().startsWith("--")).join("\n").split(";").map((x) => x.trim()).filter((x) => x.length > 0);

function db() {
  const host = ProjectionHost.open({ path: ":memory:", space: "spc_t", projections: [] });
  for (const st of statements) host.tx.run(st);
  const fact = (id: string, layer: string, person: string, status: string): void => {
    host.tx.run(
      `INSERT INTO memory_facts (id, layer, owner_ref, kind, text, enc, valid_from, learned_at, source_kind, source_ref, source_person, proposed_by, status) VALUES (?, ?, ?, 'preference', 'prefers calls on Tuesdays', 0, 1, 1, 'chat', 'thr_1', ?, 'agt_x', ?)`,
      id, layer, layer === "person" ? person : "spc_t", person, status,
    );
  };
  fact("fct_space", "space", "usr_pat", "current");
  fact("fct_agent", "agent", "usr_pat", "proposed");
  fact("fct_person", "person", "usr_pat", "current");
  fact("fct_closed", "space", "usr_pat", "closed");
  fact("fct_other", "space", "usr_maya", "current");
  const ctx = { space: "spc_t", now: () => 1_760_000_000_000, db: { all: (q: string, ...a: unknown[]) => host.tx.all(q, ...a), run: (q: string, ...a: unknown[]) => ({ changes: Number(host.tx.run(q, ...a).changes) }) } };
  return { host, ctx };
}

test("owned_by lists the facts that came from the person in shared layers and their own person-layer facts, not closed ones or someone else's", () => {
  const { ctx } = db();
  assert.deepEqual(hostCalls["memory.owned_by"](ctx, { person: "usr_pat" }).memory_from_you.ids.sort(), ["fct_agent", "fct_person", "fct_space"]);
});

test("default removal (keep): a shared fact keeps its text and becomes the Space's, only the authorship link goes; the person's own person-layer facts go", () => {
  const { host, ctx } = db();
  assert.equal(hostCalls["memory.reassign_owned"](ctx, { person: "usr_pat", kind: "memory_from_you", action: "keep" }), 3);
  const rows = host.tx.all<{ id: string; status: string; text: string; source_person: string }>(`SELECT id, status, text, source_person FROM memory_facts ORDER BY id`);
  const by = Object.fromEntries(rows.map((r) => [r.id, r]));
  assert.deepEqual([by["fct_space"]!.status, by["fct_space"]!.text, by["fct_space"]!.source_person], ["current", "prefers calls on Tuesdays", "spc_t"], "the shared fact keeps its text and belongs to the Space");
  assert.deepEqual([by["fct_agent"]!.status, by["fct_agent"]!.text, by["fct_agent"]!.source_person], ["proposed", "prefers calls on Tuesdays", "spc_t"]);
  assert.deepEqual([by["fct_person"]!.status, by["fct_person"]!.text], ["removed", ""], "their own person-layer fact goes");
  assert.equal(by["fct_other"]!.source_person, "usr_maya", "someone else's fact is untouched");
  assert.deepEqual(hostCalls["memory.owned_by"](ctx, { person: "usr_pat" }).memory_from_you.ids, [], "nothing is left under their name");
});

test("delete, only when the admin picks it: the shared facts go too, with their text", () => {
  const { host, ctx } = db();
  assert.equal(hostCalls["memory.reassign_owned"](ctx, { person: "usr_pat", kind: "memory_from_you", action: "delete" }), 3);
  const rows = host.tx.all<{ id: string; status: string; text: string }>(`SELECT id, status, text FROM memory_facts ORDER BY id`);
  const by = Object.fromEntries(rows.map((r) => [r.id, r]));
  for (const id of ["fct_space", "fct_agent", "fct_person"]) assert.deepEqual([by[id]!.status, by[id]!.text], ["removed", ""], id);
  assert.equal(by["fct_other"]!.status, "current");
  assert.equal(hostCalls["memory.reassign_owned"](ctx, { person: "usr_pat", kind: "files", action: "delete" }), 0);
});
