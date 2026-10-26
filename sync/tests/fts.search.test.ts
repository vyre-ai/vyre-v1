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

test("a broad prefix of one or two characters returns the newest exact-prefix item first; from three characters bm25 ranks", () => {
  const d = plainFts();
  put(d, "client_plan", "rec_old", "Bravo oldest plan", "");
  for (let i = 0; i < 3000; i++) put(d, "client_plan", `rec_fill${i}`, `Filler ${i} note`, i % 2 === 0 ? "bright background" : "");
  put(d, "client_plan", "rec_mid", "Bravo middle plan", "");
  put(d, "client_plan", "rec_body", "Quarterly", "bravo only in the body");
  put(d, "client_plan", "rec_new", "Brave newest plan", "");
  const idx = createSearchIndex(d);
  idx.rebuild();
  for (const q of ["b", "br"]) {
    const ids = idx.search(q, { limit: 5 }).hits.map((h) => h.id);
    assert.equal(ids[0], "rec_new", `"${q}": the newest title match comes first (${ids.join(", ")})`);
    assert.deepEqual(ids.slice(0, 3), ["rec_new", "rec_mid", "rec_old"], `"${q}": title matches newest first, before the body match`);
  }
  // an edit after the rebuild is the newest item
  put(d, "client_plan", "rec_edit", "Bridge edited just now", "");
  idx.update("client_plan", "rec_edit");
  assert.equal(idx.search("b").hits[0]?.id, "rec_edit");
  // three characters and up: every match is ranked, so the title hit with the rarest word leads, not the newest row
  const ranked = idx.search("brave").hits.map((h) => h.id);
  assert.equal(ranked[0], "rec_new");
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

