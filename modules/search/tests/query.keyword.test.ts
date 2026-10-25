// search.query and its companions (spec b11): type-ahead is newest first, three characters and up are BM25, filters and paging, hybrid and semantic modes, Related, the > actions,
// and the merge of the device's own answer with the server's.
import test from "node:test";
import assert from "node:assert/strict";
import { embedRun } from "../handlers/index.ts";
import { ACTIONS, actionsList, mergeHits, query, related } from "../handlers/query.ts";
import { contractErrors, harness, seed } from "../fixtures/harness.ts";

const ids = async (h: ReturnType<typeof harness>, input: Parameters<typeof query>[1]): Promise<string[]> => (await query(h.ctx, input)).hits.map((x) => x.id);

function bravo(): ReturnType<typeof harness> {
  const h = harness();
  seed(h, { id: "rec_old", title: "Bravo oldest plan", kind: "record" });
  for (let i = 0; i < 300; i++) seed(h, { id: `rec_fill${i}`, title: `Filler ${i} note`, body: i % 2 === 0 ? "bright background" : "", kind: "record" });
  seed(h, { id: "rec_mid", title: "Bravo middle plan", kind: "record" });
  seed(h, { id: "rec_body", title: "Quarterly", body: "bravo only in the body", kind: "record" });
  seed(h, { id: "rec_new", title: "Brave newest plan", kind: "record" });
  return h;
}

test("one or two characters: the newest title match first, then older ones, then body matches", async () => {
  const h = bravo();
  for (const q of ["b", "br"]) {
    const got = await ids(h, { q, limit: 6 });
    assert.deepEqual(got.slice(0, 3), ["rec_new", "rec_mid", "rec_old"], `"${q}": ${got.join(", ")}`);
  }
  assert.equal((await ids(h, { q: "br", limit: 6 })).includes("rec_body"), true, "a body match follows the title matches");
  assert.ok((await ids(h, { q: "br n" })).includes("rec_new"), "two short words still answer");
  seed(h, { id: "rec_edit", title: "Bridge edited just now", kind: "record" });
  assert.equal((await ids(h, { q: "b" }))[0], "rec_edit", "an item edited after the others is the newest");
});

test("three characters and up: every match is ranked by BM25, the title worth more than the body", async () => {
  const h = harness();
  seed(h, { id: "rec_body", title: "Meeting notes", body: "We discussed the harbor lease at length. The harbor lease renews in May.", kind: "record" });
  seed(h, { id: "rec_title", title: "Harbor lease", body: "Short", kind: "record" });
  seed(h, { id: "rec_other", title: "Budget", body: "Nothing to see", kind: "record" });
  assert.deepEqual(await ids(h, { q: "harbor lease" }), ["rec_title", "rec_body"]);
  const r = await query(h.ctx, { q: "harbor lease" });
  assert.match(r.hits[0]!.snippet ?? "", /\[/, "the match is marked in the snippet");
  assert.ok(Number.isInteger(r.tookMs) && r.tookMs >= 0);
  assert.deepEqual(contractErrors("search.query", "out", r), []);
  assert.deepEqual(await ids(h, { q: '"* OR (' }), [], "FTS syntax typed by a person is just text");
  assert.deepEqual(await ids(h, { q: "   " }), []);
});

test("types, record type and folder narrow the result, and a page says where the next one starts", async () => {
  const h = harness();
  seed(h, { id: "rec_c1", title: "Harbor client", kind: "record", recordType: "client" });
  seed(h, { id: "rec_i1", title: "Harbor invoice", kind: "record", recordType: "invoice" });
  seed(h, { id: "fil_1", title: "Harbor letter.md", kind: "file", folderId: "fld_a" });
  seed(h, { id: "fil_2", title: "Harbor memo.md", kind: "file", folderId: "fld_b" });
  seed(h, { id: "agt_1", title: "Harbor agent", kind: "agent" });
  assert.deepEqual((await ids(h, { q: "harbor", types: ["file"] })).sort(), ["fil_1", "fil_2"]);
  assert.deepEqual((await ids(h, { q: "harbor", types: ["file", "agent"] })).sort(), ["agt_1", "fil_1", "fil_2"]);
  assert.deepEqual(await ids(h, { q: "harbor", recordType: "invoice" }), ["rec_i1"]);
  assert.deepEqual(await ids(h, { q: "harbor", folderId: "fld_b" }), ["fil_2"]);
  assert.deepEqual(await ids(h, { q: "ha", folderId: "fld_a" }), ["fil_1"], "the filters hold for type-ahead too");
  const seen: string[] = [];
  let cursor: string | undefined;
  const pages: number[] = [];
  for (let guard = 0; guard < 10; guard++) {
    const p = await query(h.ctx, { q: "harbor", limit: 2, ...(cursor ? { cursor } : {}) });
    assert.deepEqual(contractErrors("search.query", "out", p), []);
    pages.push(p.hits.length);
    seen.push(...p.hits.map((x) => x.id));
    cursor = p.next;
    if (!cursor) break;
  }
  assert.deepEqual(pages, [2, 2, 1]);
  assert.equal(new Set(seen).size, 5, "no row twice, none missed");
});

test("semantic and hybrid modes find a document by meaning shared with the query; keyword mode does not", async () => {
  const h = harness();
  seed(h, { id: "rec_rent", title: "Warehouse rent schedule", body: "Monthly rent for the harbor warehouse due on the first", kind: "record" });
  seed(h, { id: "rec_menu", title: "Lunch menu", body: "Soup salad and bread for the team lunch", kind: "record" });
  assert.deepEqual(await embedRun(h.ctx, {}), { embedded: 2, pending: 0 });
  const sem = await query(h.ctx, { q: "harbor warehouse rent", mode: "semantic" });
  assert.equal(sem.hits[0]?.id, "rec_rent", "the document that shares the words and pairs is nearest");
  assert.ok(sem.hits.every((x) => x.score > 0));
  assert.equal((await query(h.ctx, { q: "harbor warehouse rent", mode: "hybrid" })).hits[0]?.id, "rec_rent");
  assert.deepEqual((await query(h.ctx, { q: "harbor warehouse rent", mode: "keyword" })).hits.map((x) => x.id), ["rec_rent"], "keyword finds only documents with the words");
  assert.deepEqual(contractErrors("search.query", "out", sem), []);
});

test("Related: the items that share the most telling words with one item, never itself and never what the asker cannot read", async () => {
  const h = harness();
  seed(h, { id: "rec_a", title: "Northwind lease renewal", body: "The Northwind lease renews in May. Rent increase of three percent.", kind: "record" });
  seed(h, { id: "fil_b", title: "Northwind lease draft.md", body: "Draft of the lease renewal for Northwind", kind: "file" });
  seed(h, { id: "tsk_c", title: "Send Northwind the renewal", body: "", kind: "task" });
  seed(h, { id: "rec_x", title: "Lunch order", body: "Soup", kind: "record" });
  seed(h, { id: "fil_hidden", title: "Northwind lease board minutes", body: "lease renewal minutes", kind: "file" });
  h.deny("file:fil_hidden");
  const r = await related(h.ctx, { kind: "record", itemId: "rec_a" });
  assert.deepEqual(r.hits.map((x) => x.id).sort(), ["fil_b", "tsk_c"]);
  assert.deepEqual(contractErrors("search.related", "out", r), []);
  assert.deepEqual((await related(h.ctx, { kind: "record", itemId: "rec_missing" })).hits, []);
  assert.deepEqual((await related(h.ctx, { kind: "record", itemId: "rec_a", limit: 1 })).hits.length, 1);
});

test("the > actions: every typed word must start a word of the title or its keywords", async () => {
  const t = { trace: { traceId: "0".repeat(32) } };
  assert.equal((await actionsList(t, {})).actions.length, ACTIONS.length);
  assert.deepEqual((await actionsList(t, { q: "new" })).actions.map((a) => a.key), ["task.new"]);
  assert.deepEqual((await actionsList(t, { q: "sw sk" })).actions.map((a) => a.key), ["skin.switch"]);
  assert.deepEqual((await actionsList(t, { q: "phone" })).actions.map((a) => a.key), ["call.start"], "keywords count");
  assert.deepEqual((await actionsList(t, { q: "zzz" })).actions, []);
  assert.deepEqual(contractErrors("search.actions.list", "out", await actionsList(t, { q: "o" })), []);
});

test("merge: the device's answer first, a thing in both once with what the server adds, then the server's own finds", () => {
  const local = [
    { kind: "person", id: "usr_elena", title: "Elena Marsh" },
    { kind: "record", id: "rec_a", title: "Harlow plan" },
  ];
  const server = [
    { kind: "record", id: "rec_b", title: "Harlow budget", score: 0.9 },
    { kind: "record", id: "rec_a", title: "Harlow plan", snippet: "…[Harlow] plan…", path: "Clients/Harlow", link: "vyre://record/rec_a", label: "internal", score: 0.8 },
    { kind: "file", id: "fil_c", title: "Harlow.md", score: 0.5 },
  ];
  const m = mergeHits(local, server);
  assert.deepEqual(m.map((x) => x.id), ["usr_elena", "rec_a", "rec_b", "fil_c"]);
  assert.equal((m[1] as { snippet?: string }).snippet, "…[Harlow] plan…");
  assert.equal((m[1] as { path?: string }).path, "Clients/Harlow");
  assert.deepEqual(mergeHits(local, server, 2).map((x) => x.id), ["usr_elena", "rec_a"], "cut to the limit");
  assert.deepEqual(mergeHits([], server).map((x) => x.id), ["rec_b", "rec_a", "fil_c"], "no local answer: the server's order");
  assert.deepEqual(mergeHits(local, []).map((x) => x.id), ["usr_elena", "rec_a"], "the server has not answered yet");
  assert.equal(mergeHits([local[0]!, local[0]!], []).length, 1, "a repeated local hit is shown once");
});
