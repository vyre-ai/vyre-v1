// Local search (spec 3.0 Cmd-K, ARCH 9 search.local): prefix queries, type filters, ranking, the @ # / > prefixes, incremental updates, and p95 under 50 ms with 100k rows and 10k messages.
import test from "node:test";
import assert from "node:assert/strict";
import { formatHlc } from "../../lib/hlc.ts";
import { createNodeDriver, openReplica } from "../src/replica/index.ts";
import { createSearchIndex, kindOf, matchText, searchActions, splitPrefix } from "../src/fts/index.ts";
import type { SqlDriver } from "../src/replica/index.ts";

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
  assert.equal(matchText("a\"b c"), '"ab"* "c"*');
  assert.equal(matchText("***"), null);
});

test("a phone says it searches only its replica", () => {
  assert.equal(createSearchIndex(plainFts(), { deviceClass: "phone" }).search("x").scope, "replica");
  assert.equal(createSearchIndex(plainFts(), { deviceClass: "desktop" }).search("x").scope, "full");
});

test("incremental updates follow the replica's own writes, edits, hides and removals", () => {
  const driver = createNodeDriver();
  const replica = openReplica({ driver, deviceClass: "desktop", registryHash: "h", clock: () => 1_700_000_000_000 });
  const idx = createSearchIndex(driver);
  assert.equal(idx.rebuild(), 0);
  const write = (id: string, title: string, n: number): void => {
    replica.write({ entity: "calendar_event", id, fields: { title }, hlc: hlc(10 + n), actor: "usr_ada", origin: "mirror" });
    idx.update("calendar_event", id);
  };
  write("cev_1", "Quarterly review with Elena", 1);
  assert.deepEqual(idx.search("quart").hits.map((h) => h.id), ["cev_1"]);
  write("cev_1", "Annual planning", 2);
  assert.deepEqual(idx.search("quart").hits, [], "the old title is gone");
  assert.deepEqual(idx.search("annu").hits.map((h) => h.kind), ["event"]);
  replica.hide("calendar_event", "cev_1", 5);
  idx.update("calendar_event", "cev_1");
  assert.deepEqual(idx.search("annu").hits, [], "a purged row leaves the index");
  write("cev_2", "Standup", 3);
  idx.remove("calendar_event", "cev_2");
  assert.equal(idx.count(), 0);
});

test("perf search.local: p95 under 50 ms with 100k rows and 10k messages; prefix and type filter stay correct", () => {
  const d = plainFts();
  const words = ["harlow", "estate", "trust", "probate", "meeting", "invoice", "contract", "elena", "marsh", "lease", "closing", "deed", "review", "draft", "notice", "filing"];
  const w = (i: number, k: number): string => `${words[(i * 7 + k) % words.length]} ${words[(i * 3 + k * 5) % words.length]}${i % 97}`;
  const insert = d.prepare("INSERT INTO fts (entity, id, title, body) VALUES (?, ?, ?, ?)");
  d.transaction(() => {
    for (let i = 0; i < 100_000; i++) insert.run(["client_plan", `rec_${i}`, w(i, 1), w(i, 2)]);
    for (let i = 0; i < 10_000; i++) insert.run(["message", `msg_${i}`, "", `${w(i, 3)} ${w(i, 4)} please`]);
    insert.run(["principal", "usr_unique", "Zelda Quillfeather", "Partner"]);
    insert.run(["file", "fil_unique", "Quillfeather deed.pdf", ""]);
  });
  const idx = createSearchIndex(d);
  const built = idx.rebuild();
  assert.equal(built, 110_002);

  const queries = ["harl", "estate tr", "#prob", "@marsh", "/deed", "lease clo", "invo 12", "contr", "elena marsh", "zelda", "quill", "#review dra", "notice 4", "fili", "mee"];
  const samples: number[] = [];
  let hits = 0;
  for (let round = 0; round < 6; round++) {
    for (const q of queries) {
      const t0 = performance.now();
      const r = idx.search(q);
      samples.push(performance.now() - t0);
      hits += r.hits.length;
    }
  }
  samples.sort((a, b) => a - b);
  const p95 = samples[Math.floor(samples.length * 0.95)] ?? 0;
  assert.ok(hits > 0);
  assert.deepEqual(idx.search("zelda").hits.map((h) => h.id), ["usr_unique"]);
  assert.deepEqual(idx.search("@quill").hits.map((h) => h.id), ["usr_unique"], "@ narrows to people");
  assert.deepEqual(idx.search("/quill").hits.map((h) => h.id), ["fil_unique"], "/ narrows to files");
  assert.equal(idx.search("#harl").hits.every((h) => h.kind === "chat" || h.kind === "record"), true);
  assert.ok(p95 < 50, `search.local p95 ${p95.toFixed(1)} ms is over 50 ms`);
});
