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

test("prefix queries, ranking and type filters", () => {
  const d = plainFts();
  put(d, "principal", "usr_elena", "Elena Marsh", "Partner");
  put(d, "agent", "agt_intake", "Intake", "Elena's intake assistant");
  put(d, "thread", "thr_1", "Elena kickoff", "Welcome call with the Harlow team");
  put(d, "client_plan", "rec_1", "Harlow estate plan", "Prepared for Elena Marsh");
  put(d, "file", "fil_1", "Elena engagement letter.pdf", "");
  put(d, "message", "msg_1", "", "Please send the harlow draft");
  const idx = createSearchIndex(d);
  assert.equal(idx.rebuild(), 6);

  const all = idx.search("ele");
  assert.deepEqual(all.hits.map((h) => h.entity).sort(), ["agent", "client_plan", "file", "principal", "thread"], "a typed prefix matches word starts everywhere");
  assert.equal(all.hits[0]?.entity === "principal" || all.hits[0]?.entity === "thread" || all.hits[0]?.entity === "file", true, "a title match outranks a body match");
  const rank = (e: string): number => all.hits.findIndex((h) => h.entity === e);
  assert.ok(rank("principal") < rank("client_plan"), "title hit before body-only hit");

  assert.deepEqual(idx.search("@ele").hits.map((h) => h.kind).sort(), ["agent", "person"]);
  assert.deepEqual(idx.search("#harlow").hits.map((h) => h.kind).sort(), ["chat", "chat", "record"]);
  assert.deepEqual(idx.search("/ele").hits.map((h) => h.entity), ["file"]);
  assert.equal(idx.search("@ele").prefix, "@");
  assert.deepEqual(idx.search("ele", { kinds: ["file"] }).hits.map((h) => h.entity), ["file"], "type filter without a prefix");

  const two = idx.search("elena har");
  assert.deepEqual(two.hits.map((h) => h.entity).sort(), ["client_plan", "thread"], "every word must match");
  assert.match(idx.search("draft").hits[0]?.snippet ?? "", /\[draft\]/);
  assert.deepEqual(idx.search("").hits, []);
  assert.deepEqual(idx.search("\"* OR (").hits, [], "FTS syntax typed by a person is just text");
  assert.equal(idx.search("ele", { limit: 2 }).hits.length, 2);
  assert.equal(kindOf("calendar_event"), "event");
  assert.equal(kindOf("something_custom"), "record");
});

test("the > prefix is answered by the action list, every typed word must start a word", () => {
  const idx = createSearchIndex(plainFts());
  const r = idx.search(">new");
  assert.deepEqual([r.actions, r.hits.length, r.prefix], [true, 0, ">"]);
  const actions = [
    { id: "task.new", label: "New task" }, { id: "call", label: "Call Elena", keywords: ["phone"] }, { id: "skin", label: "Switch skin" },
    { id: "away", label: "Set yourself away" }, { id: "offline", label: "Go offline" },
  ];
  assert.deepEqual(searchActions(">new", actions).map((a) => a.id), ["task.new"]);
  assert.deepEqual(searchActions(">sw sk", actions).map((a) => a.id), ["skin"]);
  assert.deepEqual(searchActions(">phone", actions).map((a) => a.id), ["call"], "keywords count, label words count more");
  assert.deepEqual(searchActions(">", actions).length, 5);
  assert.deepEqual(splitPrefix("  #abc"), { prefix: "#", rest: "abc" });
  assert.equal(matchText("a\"b c"), '"a"* "b"* "c"*');
  assert.equal(matchText("***"), null);
});

test("a phone says it searches only its replica", () => {
  assert.equal(createSearchIndex(plainFts(), { deviceClass: "phone" }).search("x").scope, "replica");
  assert.equal(createSearchIndex(plainFts(), { deviceClass: "desktop" }).search("x").scope, "full");
});

test("incremental updates follow the replica's own writes, edits, hides and removals", async () => {
  const driver = createNodeDriver();
  const replica = openReplica({ driver, deviceClass: "desktop", registryHash: "h", clock: () => 1_700_000_000_000 });
  const idx = createSearchIndex(driver);
  assert.equal(idx.rebuild(), 0);
  // The replica commits a write on flush; the index follows the committed row.
  const write = async (id: string, title: string, n: number): Promise<void> => {
    replica.write({ entity: "calendar_event", id, fields: { title }, hlc: hlc(10 + n), actor: "usr_ada", origin: "local" });
    await replica.flush();
    idx.update("calendar_event", id);
  };
  await write("cev_1", "Quarterly review with Elena", 1);
  assert.deepEqual(idx.search("quart").hits.map((h) => h.id), ["cev_1"]);
  await write("cev_1", "Annual planning", 2);
  assert.deepEqual(idx.search("quart").hits, [], "the old title is gone");
  assert.deepEqual(idx.search("annu").hits.map((h) => h.kind), ["event"]);
  replica.hide("calendar_event", "cev_1", 5);
  await replica.flush();
  idx.update("calendar_event", "cev_1");
  assert.deepEqual(idx.search("annu").hits, [], "a purged row leaves the index");
  await write("cev_2", "Standup", 3);
  idx.remove("calendar_event", "cev_2");
  assert.equal(idx.count(), 0);
});

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
