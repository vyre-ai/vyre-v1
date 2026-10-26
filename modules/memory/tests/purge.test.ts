// P-CC_39: memory.notes.erase removes one note for good: the note row and its words, the Markdown file in Files, its graph node with the edges and links that touch it, and its layout positions. A fact that cited the note
// stays and no longer points at it; other notes are untouched; erasing twice is `erased: false`; a file Files no longer has does not stop it, any other refusal does and leaves the note.
import test from "node:test";
import assert from "node:assert/strict";
import { indexGraph } from "../handlers/graph.ts";
import { noteErase } from "../handlers/purge.ts";
import { contractErrors, DAY, eventErrors, harness, NOW } from "../fixtures/harness.ts";
import type { Harness } from "../fixtures/harness.ts";

const FILES: Record<string, { name: string; text: string }> = {
  fil_gone0001: { name: "Pat.md", text: "# Pat\nPat has a secret trust. See [[Intake]]." },
  fil_keep0001: { name: "Intake.md", text: "# Intake\nBack to [[Pat]]." },
};

function setup(extra: Record<string, (i: Record<string, unknown>) => unknown> = {}): Harness {
  return harness({
    respond: {
      "files.get": (i) => { const f = FILES[String(i["fileId"])]!; return { file: { fileId: i["fileId"], folderId: "fld_notes", name: f.name, ownerId: "usr_dana", createdAt: NOW - DAY, updatedAt: NOW, kind: "markdown" } }; },
      "files.folder.get": () => ({ folder: { path: "Agents/Intake/memory/notes" } }),
      "files.read": (i) => ({ text: FILES[String(i["fileId"])]!.text }),
      "agents.list": () => ({ agents: [{ agentId: "agt_intake", name: "Intake" }] }),
      "files.delete": () => ({ ok: true }),
      "files.purge": () => ({ purged: true }),
      ...extra,
    },
  });
}

async function indexed(h: Harness): Promise<{ goneNote: string; keepNote: string }> {
  await indexGraph(h.ctx, { entity: "file", id: "fil_gone0001", seq: 1 });
  await indexGraph(h.ctx, { entity: "file", id: "fil_keep0001", seq: 2 });
  const notes = h.rows("SELECT note_id, file_id FROM memory_notes");
  const noteOf = (file: string): string => String(notes.find((n) => n["file_id"] === file)!["note_id"]);
  return { goneNote: noteOf("fil_gone0001"), keepNote: noteOf("fil_keep0001") };
}

test("erase removes the note, its file, its graph node and links and its words, and leaves the other note", async () => {
  const h = setup();
  const { goneNote, keepNote } = await indexed(h);
  assert.equal(h.rows("SELECT * FROM memory_notes").length, 2);
  h.db.run("UPDATE memory_facts SET note_id = ? WHERE 1 = 0", goneNote);
  const out = await noteErase(h.ctx, { noteId: goneNote, idempotencyKey: "k1" });
  assert.deepEqual(out, { erased: true });
  assert.deepEqual(contractErrors("memory.notes.erase", "out", out), []);
  assert.deepEqual(h.rows("SELECT note_id FROM memory_notes").map((r) => r["note_id"]), [keepNote]);
  assert.deepEqual(h.rows("SELECT node_id FROM memory_graph_nodes").map((r) => r["node_id"]), ["note:fil_keep0001"]);
  assert.equal(h.rows("SELECT * FROM memory_graph_edges WHERE from_id = ? OR to_id = ?", "note:fil_gone0001", "note:fil_gone0001").length, 0);
  assert.deepEqual([h.calls("files.delete")[0]?.input["fileId"], h.calls("files.purge")[0]?.input["fileId"]], ["fil_gone0001", "fil_gone0001"]);
  assert.ok(!JSON.stringify([h.rows("SELECT * FROM memory_notes"), h.rows("SELECT * FROM memory_graph_nodes")]).includes("secret trust"), "the words are gone");
  assert.deepEqual(h.named("note.erased").map((e) => e.payload), [{ noteId: goneNote }]);
  for (const e of h.named("note.erased")) assert.deepEqual(eventErrors(e.name, e.payload), []);
  assert.deepEqual(await noteErase(h.ctx, { noteId: goneNote, idempotencyKey: "k2" }), { erased: false });
});

test("a file Files no longer has does not stop the erase; any other refusal does and leaves the note in place", async () => {
  const a = setup({ "files.delete": () => { throw Object.assign(new Error("gone"), { error: { code: "validation.not_found" } }); } });
  const { goneNote } = await indexed(a);
  assert.deepEqual(await noteErase(a.ctx, { noteId: goneNote, idempotencyKey: "k1" }), { erased: true });
  const b = setup({ "files.purge": () => { throw Object.assign(new Error("hold"), { error: { code: "permission.on_hold" } }); } });
  const { goneNote: n2 } = await indexed(b);
  await assert.rejects(noteErase(b.ctx, { noteId: n2, idempotencyKey: "k1" }), (e) => (e as { error?: { code?: string } }).error?.code === "permission.on_hold");
  assert.equal(b.rows("SELECT * FROM memory_notes WHERE note_id = ?", n2).length, 1);
});
