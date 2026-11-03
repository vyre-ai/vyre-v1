// Redaction for AI in memory: the index holds what an agent may read of a note (files.agent_view), so a redacted word never reaches memory search, and an agent reading a note gets [REDACTED]
// where a part is hidden. A person reading the same note gets it as it is.
// @reads /modules/memory/handlers/graph.ts
// @reads /modules/memory/handlers/facts.ts
import test from "node:test";
import assert from "node:assert/strict";
import { indexGraph } from "../handlers/graph.ts";
import { readNote } from "../handlers/facts.ts";
import { harness, seedNote, NOW } from "../fixtures/harness.ts";

const RAW = "# Clients\nElena Rivera, SSN 512-44-8391, came through Maya.";
const REDACTED = "# Clients\n[REDACTED], SSN [REDACTED], came through Maya.";
const respond = {
  "files.get": (i: Record<string, unknown>) => ({ file: { fileId: i["fileId"], folderId: "fld_notes", name: "Clients.md", ownerId: "usr_dana", createdAt: NOW - 1000, updatedAt: NOW, kind: "markdown" } }),
  "files.folder.get": () => ({ folder: { path: "Agents/Intake/memory/notes" } }),
  "files.read": () => ({ text: RAW }),
  "files.agent_view": () => ({ state: "redacted", name: "Clients.md", path: "Agents/Intake/memory/notes", text: REDACTED }),
  "agents.list": () => ({ agents: [{ agentId: "agt_intake", name: "Intake" }] }),
  "agents.get": () => ({ agent: { folderId: "fld_intake", ownerId: "usr_boss" } }),
};

test("the memory index holds the agent's view of a note: a redacted word is never stored", async () => {
  const h = harness({ respond });
  await indexGraph(h.ctx, { entity: "file", id: "fil_clients", seq: 1 });
  const rows = h.rows("SELECT body FROM memory_notes WHERE file_id = ?", "fil_clients") as Array<{ body: string }>;
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.body.includes("512-44-8391"), false);
  assert.equal(rows[0]!.body.includes("Elena Rivera"), false);
  assert.match(rows[0]!.body, /\[REDACTED\]/);
  assert.equal(h.calls("files.read").length, 0, "the raw text is never read into memory");
});

test("an agent reading a note gets [REDACTED] where a part is hidden; a person gets the note as it is", async () => {
  const agent = harness({ respond, principal: { kind: "agent", id: "agt_intake" }, actingFor: "usr_dana" });
  const n = seedNote(agent, { fileId: "fil_clients", title: "Clients", body: REDACTED, layer: "agent", agentId: "agt_intake", area: "notes" });
  const a = await readNote(agent.ctx, { noteId: n });
  assert.equal(a.markdown, REDACTED);
  const person = harness({ respond });
  const n2 = seedNote(person, { fileId: "fil_clients", title: "Clients", body: REDACTED, layer: "agent", agentId: "agt_intake", area: "notes" });
  assert.equal((await readNote(person.ctx, { noteId: n2 })).markdown, RAW);
});
