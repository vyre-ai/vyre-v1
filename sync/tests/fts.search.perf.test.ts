// The speed half of fts.search.test.ts (split out so that only this file is a perf file, ruling 46); its functional tests stay in the original file and run on every PR.
// Local search (spec 3.0 Cmd-K, ARCH 9 search.local): prefix queries, type filters, ranking, the @ # / > prefixes, incremental updates, and p95 under 50 ms with 100k rows and 10k messages.
import test from "node:test";
import assert from "node:assert/strict";
import { formatHlc } from "../../lib/hlc.ts";
import { createNodeDriver, openReplica } from "../src/replica/index.ts";
import { createSearchIndex, kindOf, matchText, searchActions, splitPrefix } from "../src/fts/index.ts";
import type { SqlDriver } from "../src/replica/index.ts";

// The shard kills a file at 20 s without a word. Checks inside the loops fail the test with the phase that ran long, measured from the start of the file.
const FILE_START = performance.now();
const LIMIT_MS = 16_000;
const marks: string[] = [];
function tick(phase: string): void {
  const t = performance.now() - FILE_START;
  if (/^(the perf|seeded|rebuilt)/.test(phase)) marks.push(`${phase} @${t.toFixed(0)}`);
  if (t > LIMIT_MS) throw new assert.AssertionError({ message: `${phase}: ${t.toFixed(0)} ms into the file, over ${LIMIT_MS} ms of the 20 s file cap; ${marks.join("; ")}` });
}

const hlc = (ms: number): string => formatHlc({ ms, counter: 1, deviceId: "dev1" });

function plainFts(): SqlDriver {
  const d = createNodeDriver();
  d.exec("CREATE VIRTUAL TABLE fts USING fts5(entity UNINDEXED, id UNINDEXED, title, body, tokenize='unicode61 remove_diacritics 2')");
  return d;
}
function put(d: SqlDriver, entity: string, id: string, title: string, body = ""): void {
  d.prepare("INSERT INTO fts (entity, id, title, body) VALUES (?, ?, ?, ?)").run([entity, id, title, body]);
}

test("perf search.local: p95 under 50 ms with 100k rows and 10k messages; prefix and type filter stay correct", () => {
  tick("the perf test starts");
  const d = plainFts();
  // 3,375 distinct words (three syllables of fifteen), picked by a fixed hash so the corpus is the same every run. The queries below include one- and two-letter prefixes that match tens of thousands of rows.
  const sy = ["ba", "ke", "lo", "mi", "ra", "su", "te", "vo", "na", "pi", "do", "ga", "fe", "zu", "ho"];
  const word = (n: number): string => `${sy[n % 15]}${sy[Math.floor(n / 15) % 15]}${sy[Math.floor(n / 225) % 15]}`;
  const pick = (i: number, k: number): string => word((Math.imul(i * 31 + k, 2654435761) >>> 0) % 3375);
  const w = (i: number, k: number): string => `${pick(i, k)} ${pick(i, k + 17)}`;
  const insert = d.prepare("INSERT INTO fts (entity, id, title, body) VALUES (?, ?, ?, ?)");
  d.transaction(() => {
    for (let i = 0; i < 100_000; i++) { if (i % 10_000 === 0) tick(`seeding record ${i}`); insert.run(["client_plan", `rec_${i}`, w(i, 1), `${w(i, 2)} ${w(i, 3)}`]); }
    for (let i = 0; i < 10_000; i++) insert.run(["message", `msg_${i}`, "", `${w(i, 3)} ${w(i, 4)} please`]);
    insert.run(["principal", "usr_unique", "Zelda Quillfeather", "Partner"]);
    insert.run(["file", "fil_unique", "Quillfeather deed.pdf", ""]);
  });
  tick("seeded the 110k fts rows");
  const idx = createSearchIndex(d);
  const built = idx.rebuild();
  assert.equal(built, 110_002);
  tick("rebuilt the search index");

  const queries = ["b", "ba", "k", "ke", "a", "b k", "ba ke", "#b", "#ba", "@s", "@su", "/t", "/te", "bake", "balo mi", "#kera", "pidog", "gafe zu", "zelda", "quill", "#mira dos", "vona"];
  const samples: number[] = [];
  let hits = 0;
  for (let round = 0; round < 6; round++) {
    for (const q of queries) {
      tick(`searching ${q}`);
      const t0 = performance.now();
      const r = idx.search(q);
      samples.push(performance.now() - t0);
      marks.push(`${q}=${(samples[samples.length - 1] ?? 0).toFixed(0)}ms/${r.hits.length}`);
      hits += r.hits.length;
    }
  }
  samples.sort((a, b) => a - b);
  const p95 = samples[Math.floor(samples.length * 0.95)] ?? 0;
  assert.ok(hits > 0);
  assert.deepEqual(idx.search("zelda").hits.map((h) => h.id), ["usr_unique"]);
  assert.deepEqual(idx.search("@quill").hits.map((h) => h.id), ["usr_unique"], "@ narrows to people");
  assert.deepEqual(idx.search("/quill").hits.map((h) => h.id), ["fil_unique"], "/ narrows to files");
  assert.equal(idx.search("#bake").hits.every((h) => h.kind === "chat" || h.kind === "record"), true);
  // a record created after the rebuild is found by its first letter on a broad prefix, ahead of the 110k ranked rows, and an edited row appears once
  put(d, "client_plan", "rec_fresh", "Bzzz freshly created record", "");
  idx.update("client_plan", "rec_fresh");
  for (const q of ["b", "bz", "#b", "fresh"]) assert.equal(idx.search(q).hits[0]?.id, "rec_fresh", `"${q}" finds the new record first`);
  const was = idx.search("ba").hits.find((h) => h.entity === "client_plan");
  assert.ok(was);
  d.prepare("UPDATE fts SET title = ? WHERE entity = ? AND id = ?").run(["Bazooka edited title", "client_plan", was.id]);
  idx.update("client_plan", was.id);
  const again = idx.search("ba", { limit: 50 }).hits.filter((h) => h.id === was.id);
  assert.equal(again.length, 1, "an edited row is in the results once");
  assert.equal(again[0]?.title, "Bazooka edited title");
  const t1 = performance.now();
  idx.search("b");
  assert.ok(performance.now() - t1 < 50, "the recent index does not slow a broad query");
  assert.ok(p95 < 50, `search.local p95 ${p95.toFixed(1)} ms is over 50 ms`);
});
