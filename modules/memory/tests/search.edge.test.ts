// memory.search answers over awkward rows: notes with no words, a lone space-layer note, pages with nothing in them. Scores stay numbers and the answer matches its contract.
import test from "node:test";
import assert from "node:assert/strict";
import { search } from "../handlers/facts.ts";
import { pagePut } from "../handlers/pages.ts";
import { asPerson, contractErrors, harness, NOW } from "../fixtures/harness.ts";

const AGENT = "agt_dex";
const seed = (h: ReturnType<typeof harness>, id: string, layer: string, title: string, body: string): void => {
  h.db.run(
    "INSERT INTO memory_notes (note_id, file_id, path, title, sealed_title, layer, owner_ref, agent_id, project_id, area, body, updated_at) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, NULL, 'notes', ?, ?)",
    id, `fil_${id}`, `Agents/Dex/memory/${id}.md`, title, layer, layer === "space" ? "spc_memorytest" : "usr_dana", layer === "agent" ? AGENT : null, body, NOW,
  );
};
for (const mode of ["keyword", "semantic", "hybrid"] as const) {
  for (const [name, notes] of [
    ["one empty note", [["not_n1", "agent", "memory", ""]]],
    ["empty notes only", [["not_n1", "agent", "memory", ""], ["not_n2", "agent", "AGENT", ""]]],
    ["empty and full notes", [["not_n1", "agent", "memory", ""], ["not_n2", "agent", "clients", "Sara Whitfield likes short notes"]]],
    ["a space note with no title", [["not_n1", "space", "", "Office closes at five"]]],
  ] as const) {
    test(`${mode}: ${name}`, async () => {
      const h = harness({ principal: { kind: "agent", id: AGENT }, actingFor: "usr_dana" });
      await search(h.ctx, { q: "warm", mode: "keyword" });
      for (const n of notes) seed(h, n[0], n[1], n[2], n[3]);
      await pagePut(asPerson(h).ctx, { title: "Empty page", layer: "space", notes: "" }).catch(() => undefined);
      for (const q of ["what do you remember", "memory", "notes", "sara"]) {
        const out = await search(h.ctx, { q, agentId: AGENT, mode });
        assert.deepEqual(contractErrors("memory.search", "out", out), [], `${q}: ${JSON.stringify(out).slice(0, 300)}`);
        for (const hit of out.hits) assert.ok(Number.isFinite(hit.score), `${q}: score ${hit.score}`);
      }
    });
  }
}
