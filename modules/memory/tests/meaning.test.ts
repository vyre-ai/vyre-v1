// Meaning search (owner design 30 Oct 2026, ruling 7): the question "bank reconciliation" finds "the Chase feed didn't match", a text it shares no word with; the blend keeps keyword hits; a missing,
// loading or failing model leaves keyword search in charge and says why; a personal layer is never kept as vectors.
import test from "node:test";
import assert from "node:assert/strict";
import { search, erase } from "../handlers/facts.ts";
import { meaningRank, meaningStatusRead } from "../handlers/meaning.ts";
import { setEmbedder } from "../meaning.ts";
import { stubEmbedder } from "../fixtures/embedder.ts";
import { contractErrors, harness, seedFact } from "../fixtures/harness.ts";
import type { Harness } from "../fixtures/harness.ts";

function world(settings: Record<string, unknown> = {}): Harness {
  const h = harness({ admin: true, settings });
  seedFact(h, { id: "fct_chase", layer: "space", text: "The Chase feed didn't match", kind: "note" });
  seedFact(h, { id: "fct_hire", layer: "space", text: "We interview a candidate on Tuesday", kind: "note" });
  seedFact(h, { id: "fct_rain", layer: "space", text: "The forecast says rain on Friday", kind: "note" });
  seedFact(h, { id: "fct_tea", layer: "person", owner: "usr_dana", text: "I take my tea with oat milk", kind: "preference" });
  return h;
}
const ids = (r: { hits: Array<{ factId?: string }> }): string[] => r.hits.map((x) => x.factId ?? "");

test("meaning finds a text with no word in common; keyword and trigram search cannot", async () => {
  const h = world();
  setEmbedder("local", null);
  const without = await search(h.ctx, { q: "bank reconciliation" });
  assert.deepEqual(ids(without), [], "no words shared, no meaning model: nothing");
  assert.equal(without.meaning?.state, "not_set_up", "no model reads healthy: not set up");
  assert.match(without.meaning?.hint ?? "", /Keyword search is in use/);
  const e = stubEmbedder();
  setEmbedder("local", e);
  try {
    const found = await search(h.ctx, { q: "bank reconciliation" });
    assert.deepEqual(contractErrors("memory.search", "out", found), []);
    assert.deepEqual(ids(found), ["fct_chase"], "the Chase feed that did not match is what a bank reconciliation question means");
    assert.equal(found.meaning?.state, "on");
    assert.equal(found.meaning?.model, "stub-concepts-v1");
    // keyword mode never asks the model
    const calls = e.calls.length;
    assert.deepEqual(ids(await search(h.ctx, { q: "bank reconciliation", mode: "keyword" })), []);
    assert.equal(e.calls.length, calls);
    // a word match still wins its place beside meaning
    const both = await search(h.ctx, { q: "Chase interview", limit: 5 });
    assert.deepEqual(new Set(ids(both)), new Set(["fct_chase", "fct_hire"]));
  } finally { setEmbedder("local", null); }
});

test("shared text is embedded once and kept as vectors; an edit is embedded again; a personal layer is never kept", async () => {
  const h = world();
  const e = stubEmbedder();
  setEmbedder("local", e);
  try {
    await search(h.ctx, { q: "bank reconciliation" });
    const firstDocs = e.calls.flat().filter((t) => t.includes("Chase") || t.includes("candidate") || t.includes("forecast")).length;
    assert.equal(firstDocs, 3, "the three shared facts, once");
    assert.equal(h.rows("SELECT doc_id FROM memory_vectors WHERE doc_kind = 'fact' ORDER BY doc_id").length, 3);
    assert.ok(!h.rows("SELECT doc_id FROM memory_vectors").some((r) => r["doc_id"] === "fct_tea"), "nothing derived from personal text is stored");
    assert.equal(h.rows("SELECT dim, model FROM memory_vectors LIMIT 1")[0]!["model"], "stub-concepts-v1");
    e.calls.length = 0;
    await search(h.ctx, { q: "weather" });
    const again = e.calls.flat().filter((t) => t.includes("Chase") || t.includes("candidate") || t.includes("forecast"));
    assert.equal(again.length, 0, "kept vectors are reused");
    assert.ok(e.calls.flat().some((t) => t.includes("oat milk")), "the personal fact is embedded for the question and dropped");
    // an edit changes the text, so only that fact is embedded again
    h.db.run("UPDATE memory_facts SET text = 'The ledger shows a deposit twice' WHERE id = 'fct_chase'");
    e.calls.length = 0;
    await search(h.ctx, { q: "bank" });
    assert.deepEqual(e.calls.flat().filter((t) => !t.startsWith("bank")).filter((t) => t.includes("ledger")), ["Note The ledger shows a deposit twice"]);
    // erase removes the vector with the fact
    await erase(h.ctx, { factIds: ["fct_chase"] });
    assert.equal(h.rows("SELECT doc_id FROM memory_vectors WHERE doc_id = 'fct_chase'").length, 0);
  } finally { setEmbedder("local", null); }
});

test("a trashed fact is out of meaning search too", async () => {
  const h = world();
  setEmbedder("local", stubEmbedder());
  try {
    assert.deepEqual(ids(await search(h.ctx, { q: "bank reconciliation" })), ["fct_chase"]);
    const { factsRemove } = await import("../handlers/facts.ts");
    await factsRemove(h.ctx, { factIds: ["fct_chase"] });
    assert.deepEqual(ids(await search(h.ctx, { q: "bank reconciliation" })), []);
    assert.equal(h.rows("SELECT doc_id FROM memory_vectors WHERE doc_id = 'fct_chase'").length, 0);
  } finally { setEmbedder("local", null); }
});

test("a model that is loading, failing or switched off leaves keyword search in charge with a plain reason", async () => {
  const h = world();
  const e = stubEmbedder();
  setEmbedder("local", e);
  try {
    e.state = "loading";
    e.detail = "Meaning search is getting ready (downloading the model).";
    const loading = await search(h.ctx, { q: "bank reconciliation" });
    assert.deepEqual([ids(loading), loading.meaning?.state, loading.meaning?.hint], [[], "loading", "Meaning search is getting ready (downloading the model)."]);
    e.state = "failed";
    e.detail = "The model could not be loaded.";
    assert.equal((await search(h.ctx, { q: "Chase" })).meaning?.state, "degraded");
    assert.deepEqual(ids(await search(h.ctx, { q: "Chase feed" })), ["fct_chase"], "keyword search still answers");
    e.state = "ready";
    e.detail = undefined;
    e.fail = true;
    const broke = await search(h.ctx, { q: "Chase feed" });
    assert.deepEqual([ids(broke), broke.meaning?.state], [["fct_chase"], "degraded"]);
    e.fail = false;
    const off = world({ "memory.meaning_search": "off" });
    const res = await search(off.ctx, { q: "bank reconciliation" });
    assert.deepEqual([ids(res), res.meaning?.state], [[], "off"]);
  } finally { setEmbedder("local", null); }
});

test("the setting switches to the memory key's provider, and the status line says what is in use", async () => {
  const h = world({ "memory.meaning_search": "key" });
  const local = stubEmbedder("local-model");
  const keyed = stubEmbedder("key-model");
  setEmbedder("local", local);
  setEmbedder("key", null);
  try {
    let st = await meaningStatusRead(h.ctx);
    assert.deepEqual([st.mode, st.state], ["key", "not_set_up"], "no memory key chosen reads healthy");
    assert.match(st.hint ?? "", /no memory key/);
    setEmbedder("key", keyed);
    const found = await search(h.ctx, { q: "bank reconciliation" });
    assert.deepEqual(ids(found), ["fct_chase"]);
    assert.equal(found.meaning?.model, "key-model");
    assert.equal(local.calls.length, 0, "the local model was not used");
    st = await meaningStatusRead(h.ctx);
    assert.deepEqual(contractErrors("memory.meaning.status", "out", st), []);
    assert.deepEqual([st.state, st.model, st.indexed], ["on", "key-model", 3]);
  } finally { setEmbedder("local", null); setEmbedder("key", null); }
});

test("texts the caller holds are ranked by meaning with nothing stored", async () => {
  const h = world();
  const cands = [{ id: "m1", text: "The Chase feed didn't match" }, { id: "m2", text: "Rain on Friday, says the forecast" }, { id: "m3", text: "" }];
  setEmbedder("local", null);
  const none = await meaningRank(h.ctx, { query: "bank reconciliation", candidates: cands });
  assert.deepEqual([none.scores, none.meaning.state], [[], "not_set_up"]);
  setEmbedder("local", stubEmbedder());
  try {
    const r = await meaningRank(h.ctx, { query: "bank reconciliation", candidates: cands });
    assert.deepEqual(contractErrors("memory.meaning.rank", "out", r), []);
    assert.deepEqual(r.scores.map((x) => [x.id, x.score]), [["m1", 1], ["m2", 0], ["m3", 0]]);
    assert.equal(h.rows("SELECT doc_id FROM memory_vectors WHERE doc_id IN ('m1', 'm2')").length, 0, "nothing stored");
  } finally { setEmbedder("local", null); }
});
