// Memory notes and subject lookup (spec 2.15, 2.16): list, read, versions and restore go through Files and keep the layer rules; find_by_subject is for admins and never opens a personal layer.
import test from "node:test";
import assert from "node:assert/strict";
import { findBySubject, notesList, readNote, restoreVersion, versions } from "../handlers/facts.ts";
import { assertEventsConform, asPerson, codeOf, contractErrors, harness, NOW, seedFact, seedNote } from "../fixtures/harness.ts";

const respond = {
  "agents.get": () => ({ agent: { folderId: "fld_intake", ownerId: "usr_boss" } }),
  "projects.get": () => ({ project: { folderId: "fld_harlow", lead: "usr_lead" } }),
  "files.read": (i: Record<string, unknown>) => ({ text: `# Body of ${String(i["fileId"])}`, mime: "text/markdown", size: 3, truncated: false, version: 2 }),
  "files.versions": () => ({ versions: [{ versionId: "ver_two", n: 2, by: "usr_dana", at: NOW, reason: "edit" }, { versionId: "ver_one", n: 1, by: "usr_boss", at: NOW - 1000 }] }),
  "files.restore_version": () => ({ file: {}, versionId: "ver_one" }),
};

function world() {
  const h = harness({ respond });
  const n1 = seedNote(h, { fileId: "fil_a", title: "Clients", body: "Acme and Beta", layer: "agent", agentId: "agt_intake", area: "notes" });
  const n2 = seedNote(h, { fileId: "fil_b", title: "Proposed ideas", body: "Try a newsletter", layer: "agent", agentId: "agt_intake", area: "proposed" });
  const n3 = seedNote(h, { fileId: "fil_c", title: "Harlow plan", body: "Teal", layer: "project", projectId: "prj_harlow" });
  return { h, n1, n2, n3 };
}

test("notes list by agent, area and layer, and a person's own notes show for them alone", async () => {
  const { h } = world();
  const mine = await notesList(h.ctx, { agentId: "agt_intake" });
  assert.deepEqual(mine.notes.map((n) => n.title).sort(), ["Clients", "Proposed ideas"]);
  assert.deepEqual(contractErrors("memory.notes.list", "out", mine), []);
  assert.deepEqual((await notesList(h.ctx, { agentId: "agt_intake", area: "proposed" })).notes.map((n) => n.title), ["Proposed ideas"]);
  assert.deepEqual((await notesList(h.ctx, { layer: "project" })).notes.map((n) => n.title), ["Harlow plan"]);
  h.db.run(
    "INSERT INTO memory_notes (note_id, file_id, path, title, sealed_title, layer, owner_ref, agent_id, project_id, area, body, updated_at) VALUES ('not_p', 'fil_p', 'People/Dana/memory/Intake/x.md', '', ?, 'person', 'usr_dana', 'agt_intake', NULL, 'notes', '', 1)",
    JSON.stringify(h.ctx.seal.seal(new TextEncoder().encode("Dana's travel"), "mem.usr_dana")),
  );
  assert.ok((await notesList(h.ctx, { layer: "person" })).notes.some((n) => n.title === "Dana's travel"));
  const omarCtx = asPerson(h, { kind: "person", id: "usr_omar" }, { respond });
  assert.equal((await notesList(omarCtx.ctx, { layer: "person" })).notes.length, 0);
  h.deny("folder:fld_intake");
  assert.deepEqual((await notesList(h.ctx, { agentId: "agt_intake" })).notes.map((n) => n.layer), ["person"], "only the person's own note is left when the agent's folder is closed");
});

test("a note is read through Files, only where the layer is visible", async () => {
  const { h, n1 } = world();
  const out = await readNote(h.ctx, { noteId: n1 });
  assert.equal(out.markdown, "# Body of fil_a");
  assert.equal(out.note.title, "Clients");
  assert.deepEqual(contractErrors("memory.read_note", "out", out), []);
  assert.deepEqual(h.calls("files.read")[0]?.input, { fileId: "fil_a", as: "text" });
  await assert.rejects(() => readNote(h.ctx, { noteId: "not_missing" }), (e) => codeOf(e) === "validation.not_found");
  h.deny("folder:fld_intake");
  await assert.rejects(() => readNote(h.ctx, { noteId: n1 }), (e) => codeOf(e) === "validation.not_found");
});

test("versions of a note come from Files in the contract's shape", async () => {
  const { h, n1 } = world();
  const out = await versions(h.ctx, { noteId: n1 });
  assert.deepEqual(out.versions.map((v) => v.versionId), ["ver_two", "ver_one"]);
  assert.deepEqual(contractErrors("memory.versions", "out", out), []);
  await assert.rejects(() => versions(h.ctx, { noteId: "not_missing" }), (e) => codeOf(e) === "validation.not_found");
});

test("restoring a shared note needs edit on its layer, names who did it, and never reaches a personal note", async () => {
  const { h, n1 } = world();
  const out = await restoreVersion(h.ctx, { noteId: n1, versionId: "ver_one" });
  assert.equal(out.note.noteId, n1);
  assert.deepEqual(contractErrors("memory.restore_version", "out", out), []);
  assert.deepEqual(h.calls("files.restore_version")[0]?.input, { fileId: "fil_a", versionId: "ver_one" });
  assert.deepEqual(h.named("memory.note_restored")[0]?.payload, { noteId: n1, versionId: "ver_one", by: "usr_dana" });
  assert.deepEqual(assertEventsConform(h), []);
  h.advance(1);
  const ro = harness({ respond, raw: h.raw, readOnly: ["folder:fld_intake"] });
  await assert.rejects(() => restoreVersion(ro.ctx, { noteId: n1, versionId: "ver_one" }), (e) => codeOf(e) === "permission.no_grant");
  h.db.run(
    "INSERT INTO memory_notes (note_id, file_id, path, title, sealed_title, layer, owner_ref, agent_id, project_id, area, body, updated_at) VALUES ('not_p', 'fil_p', 'People/Dana/memory/Intake/x.md', '', ?, 'person', 'usr_dana', 'agt_intake', NULL, 'notes', '', 1)",
    JSON.stringify(h.ctx.seal.seal(new TextEncoder().encode("Dana's travel"), "mem.usr_dana")),
  );
  await assert.rejects(() => restoreVersion(h.ctx, { noteId: "not_p", versionId: "ver_one" }), (e) => codeOf(e) === "permission.no_grant");
});

test("find by subject is for admins, finds what carries the subject, and keeps personal text to itself", async () => {
  const { h } = world();
  seedFact(h, { id: "fct_s1", layer: "agent", agentId: "agt_intake", text: "Acme renews in March", sourceKind: "record", sourceRef: "rec_acme" });
  seedFact(h, { id: "fct_s2", layer: "space", text: "The acme account is our biggest" });
  seedFact(h, { id: "fct_s3", layer: "person", owner: "usr_dana", agentId: "agt_intake", text: "Dana dislikes the Acme founder", sourceKind: "record", sourceRef: "rec_acme" });
  seedFact(h, { id: "fct_s4", layer: "agent", agentId: "agt_intake", text: "Beta renews in June", sourceKind: "record", sourceRef: "rec_beta" });
  await assert.rejects(() => findBySubject(h.ctx, { subject: "rec_acme" }), (e) => codeOf(e) === "permission.role_lacks_permission");
  h.setAdmin(true);
  const out = await findBySubject(h.ctx, { subject: "rec_acme" });
  assert.deepEqual(out.facts.map((f) => f.factId).sort(), ["fct_s1", "fct_s3"]);
  assert.equal(out.facts.find((f) => f.factId === "fct_s3")?.text, "", "a personal fact is named, never read");
  assert.deepEqual(contractErrors("memory.find_by_subject", "out", out), []);
  const byText = await findBySubject(h.ctx, { subject: "Acme" });
  assert.deepEqual(byText.facts.map((f) => f.factId).sort(), ["fct_s1", "fct_s2"]);
  assert.deepEqual(byText.notes.map((n) => n.title), ["Clients"]);
  const notes = await findBySubject(h.ctx, { subject: "newsletter" });
  assert.deepEqual(notes.notes.map((n) => n.title), ["Proposed ideas"]);
  await assert.rejects(() => findBySubject(h.ctx, { subject: "  " }), (e) => codeOf(e) === "validation.bad_input");
});
