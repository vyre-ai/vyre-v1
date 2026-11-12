// Search by meaning on a real model (f-wire, 12 Nov; lead's conditions): the host binds memory's local model; until it is ready and has re-embedded everything search keeps the word-hash
// stand-in; the re-embed runs in small steps, waits while a turn runs, survives a restart, and switches in one go, so a query never compares a model vector with a stand-in vector; a model
// that cannot start leaves search working on words with one health line, and no query ever fails because of it.
import test from "node:test";
import assert from "node:assert/strict";
import { embedRun, health } from "../handlers/index.ts";
import { query } from "../handlers/query.ts";
import { DIM, STAND_IN, activeModel, forgetVectors, hashEmbed, normalise, reembedStep, setModel, vectorsOf } from "../projections.ts";
import type { Model } from "../projections.ts";
import { harness, seed } from "../fixtures/harness.ts";

/** A model whose vectors differ from the stand-in's (the stand-in of reversed text): what it embeds is counted. */
function fakeModel(state: ReturnType<Model["status"]>["state"] = "ready"): Model & { seen: string[]; busyNow: boolean; st: typeof state } {
  const m = {
    name: "test-model", seen: [] as string[], busyNow: false, st: state,
    status: () => ({ state: m.st }),
    embed: async (texts: string[]) => { m.seen.push(...texts); return texts.map((t) => normalise(hashEmbed([...t].reverse().join("")))); },
    busy: () => m.busyNow,
  };
  return m;
}

test("a model that cannot start: search stays on words and the stand-in, says so once in health, and no query fails", async () => {
  const h = harness();
  try {
    const m = fakeModel("failed");
    setModel(m);
    seed(h, { id: "rec_a", title: "Harbor lease renewal", body: "The lease renews in May", kind: "record" });
    await embedRun(h.ctx, {});
    assert.equal(activeModel(h.db), STAND_IN);
    assert.equal((await reembedStep(h.db, h.space, 16)).state, "idle", "nothing to do while the model is not ready");
    const r = await query(h.ctx, { q: "harbor lease", mode: "hybrid" });
    assert.equal(r.hits[0]?.id, "rec_a");
    const hs = await health(h.ctx);
    assert.equal(hs.state, "degraded");
    assert.match(hs.detail ?? "", /Search by meaning is not available on this server.*Search works on words/);
    assert.deepEqual(m.seen, [], "the model was never asked");
  } finally { setModel(null); forgetVectors(); }
});

test("the re-embed: small steps into a second generation, queries stay on the stand-in until the switch, a turn makes it wait, a restart resumes, then one switch", async () => {
  const h = harness();
  try {
    for (let i = 0; i < 40; i++) seed(h, { id: `rec_${i}`, title: `Item ${i} harbor`, body: `Body of item ${i}`, kind: "record" });
    await embedRun(h.ctx, { limit: 100 });
    assert.equal(vectorsOf(h.db, h.space).size, 40);
    const m = fakeModel();
    setModel(m);
    m.busyNow = true;
    assert.equal((await reembedStep(h.db, h.space, 16)).state, "waiting", "a running turn comes first");
    assert.deepEqual(m.seen, []);
    m.busyNow = false;
    const one = await reembedStep(h.db, h.space, 16);
    assert.deepEqual([one.state, one.done, one.left], ["running", 16, 24]);
    // a query in the middle: the stored generation is still the stand-in's, and the query is embedded the stand-in's way, never by the model
    const before = m.seen.length;
    await query(h.ctx, { q: "harbor item", mode: "semantic" });
    assert.equal(m.seen.length, before, "the query did not use the model while the index is the stand-in's");
    assert.equal(activeModel(h.db), STAND_IN);
    // a restart: the in-memory copies are gone, the second generation is on disk and the work goes on from where it was
    forgetVectors();
    const two = await reembedStep(h.db, h.space, 16);
    assert.deepEqual([two.state, two.left], ["running", 8]);
    seed(h, { id: "rec_new", title: "Arrived during the re-embed", body: "harbor", kind: "record" });
    await embedRun(h.ctx, {});
    const three = await reembedStep(h.db, h.space, 16);
    assert.deepEqual([three.state, three.left], ["switched", 0], "the new document was covered too, and then the generations swapped");
    assert.equal(activeModel(h.db), "test-model");
    assert.equal(vectorsOf(h.db, h.space).size, 41);
    assert.equal(h.rows("SELECT count(*) AS c FROM search_vectors")[0]!["c"], 0, "the old generation is emptied after the switch");
    const seen = m.seen.length;
    const r = await query(h.ctx, { q: "harbor item", mode: "semantic" });
    assert.ok(m.seen.length > seen, "after the switch the query is embedded by the model");
    assert.ok(r.hits.length > 0);
    assert.equal((await reembedStep(h.db, h.space, 16)).state, "idle", "done once");
    // the model goes away after the switch: queries answer on words, new documents wait for their vectors, nothing fails
    m.st = "loading";
    seed(h, { id: "rec_later", title: "Later harbor note", body: "harbor", kind: "record" });
    assert.equal((await embedRun(h.ctx, {})).embedded, 0, "no stand-in vector goes into the model's index");
    const words = await query(h.ctx, { q: "later harbor", mode: "hybrid" });
    assert.equal(words.hits[0]?.id, "rec_later");
  } finally { setModel(null); forgetVectors(); }
});

test("a vector of the wrong size is refused, never stored", async () => {
  const h = harness();
  try {
    seed(h, { id: "rec_a", title: "A", kind: "record" });
    setModel({ name: "bad", status: () => ({ state: "ready" }), embed: async (t) => t.map(() => new Float32Array(DIM - 1)) });
    await assert.rejects(reembedStep(h.db, h.space, 4), /dimensions/);
    assert.equal(h.rows("SELECT count(*) AS c FROM search_vectors_next")[0]!["c"], 0);
  } finally { setModel(null); forgetVectors(); }
});
