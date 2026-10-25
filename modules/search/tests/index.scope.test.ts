// Scope and end-to-end (spec b11): what the asker may not read never appears in a result, and end-to-end content is never in the server index. Also the index consumer's own rules:
// a repeated or late event changes nothing, a delete leaves its sequence, and an event for an end-to-end row removes what was there.
import test from "node:test";
import assert from "node:assert/strict";
import { registry } from "../../../generated/registry.ts";
import { deref } from "../../../packages/contracts/src/jsonschema.ts";
import { indexApply } from "../handlers/index.ts";
import { query } from "../handlers/query.ts";
import { WATCHED, consumers, targetOf } from "../impl.ts";
import { asPerson, contractErrors, harness, notFound, seed } from "../fixtures/harness.ts";
import type { Harness } from "../fixtures/harness.ts";

const ids = (r: { hits: Array<{ id: string }> }): string[] => r.hits.map((h) => h.id).sort();
const docCount = (h: Harness): number => Number(h.rows("SELECT count(*) AS c FROM search_docs")[0]!["c"]);

function populated(): Harness {
  const h = harness();
  seed(h, { id: "rec_pub", title: "Harbor lease plan", kind: "record", recordType: "client" });
  seed(h, { id: "rec_secret", title: "Harbor lease settlement terms", kind: "record", recordType: "client" });
  seed(h, { id: "fil_open", title: "Harbor lease draft.md", kind: "file", body: "Harbor lease draft with the rent schedule", path: "Clients/Harbor/Harbor lease draft.md" });
  seed(h, { id: "fil_hidden", title: "Harbor lease board minutes.md", kind: "file", body: "Harbor lease board discussion", path: "Board/Harbor lease board minutes.md" });
  seed(h, { id: "thr_team", title: "Harbor lease channel", kind: "chat", body: "Who owns the harbor lease renewal" });
  seed(h, { id: "agt_intake", title: "Harbor intake", kind: "agent", body: "Takes harbor lease enquiries" });
  return h;
}

test("a result never includes a row the asker cannot read, whatever the page size", async () => {
  const h = populated();
  h.deny("record:rec_secret");
  h.deny("file:fil_hidden");
  const all = await query(h.ctx, { q: "harbor lease" });
  assert.deepEqual(ids(all), ["agt_intake", "fil_open", "rec_pub", "thr_team"], "the two rows she cannot read are not there");
  assert.deepEqual(contractErrors("search.query", "out", all), []);
  // paging cannot be used to find a hidden row either: every page is filtered, and the total of the pages is the same four rows
  const seen: string[] = [];
  let cursor: string | undefined;
  for (let guard = 0; guard < 10; guard++) {
    const p = await query(h.ctx, { q: "harbor lease", limit: 1, ...(cursor ? { cursor } : {}) });
    seen.push(...p.hits.map((x) => x.id));
    cursor = p.next;
    if (!cursor) break;
  }
  assert.deepEqual([...seen].sort(), ["agt_intake", "fil_open", "rec_pub", "thr_team"]);
  // a type filter, a prefix of the title and the semantic mode all go through the same gate
  assert.deepEqual(ids(await query(h.ctx, { q: "harbor", types: ["record"] })), ["rec_pub"]);
  assert.ok(!(await query(h.ctx, { q: "settlement" })).hits.some((x) => x.id === "rec_secret"), "a word only the hidden row has finds nothing");
  assert.ok(!(await query(h.ctx, { q: "board minutes", mode: "semantic" })).hits.some((x) => x.id === "fil_hidden"));
  assert.ok(!(await query(h.ctx, { q: "ha" })).hits.some((x) => x.id === "rec_secret" || x.id === "fil_hidden"), "type-ahead too");
});

test("two people on one Space see their own rows", async () => {
  const h = populated();
  h.deny("record:rec_secret");
  const omar = asPerson(h, { kind: "person", id: "usr_omar" });
  omar.deny("file:fil_open");
  const dana = await query(h.ctx, { q: "harbor lease" });
  const other = await query(omar.ctx, { q: "harbor lease" });
  assert.ok(ids(other).includes("rec_secret") && !ids(other).includes("fil_open"));
  assert.ok(ids(dana).includes("fil_open") && !ids(dana).includes("rec_secret"));
});

test("end-to-end content is never in the index: private chats, Ask panes, Restricted rows and encrypted messages", async () => {
  const h = harness({
    respond: {
      "threads.get": (i) => ({ thread: { threadId: i["threadId"], kind: i["threadId"] === "thr_priv" ? "chat" : i["threadId"] === "thr_ask" ? "ask" : "channel", title: `Title of ${String(i["threadId"])}` } }),
      "chat.messages.list": (i) => ({
        messages: i["threadId"] === "thr_chan"
          ? [{ messageId: "msg_1", body: "the quarterly numbers look good", enc: 0 }, { messageId: "msg_2", body: "private aside never indexed", enc: 2 }]
          : [{ messageId: "msg_3", body: "private diary line", enc: 2 }],
      }),
      "records.get": (i) => ({ record: { id: i["recordId"], type: "client", label: i["recordId"] === "rec_restricted" ? 3 : 1, fields: { name: "Acme", notes: "Wire instructions" }, updatedAt: 1 } }),
      "schema.types.get": () => ({ type: { titleField: "name" } }),
      "files.get": (i) => ({ file: { fileId: i["fileId"], name: "payroll.csv", kind: "text", label: 3, folderId: "fld_hr" } }),
    },
  });
  let seq = 1;
  const apply = (entity: string, id: string): Promise<{ indexed: boolean }> => indexApply(h.ctx, { entity, id, op: "upsert", seq: seq++ });

  assert.deepEqual(await apply("thread", "thr_chan"), { indexed: true }, "a channel is indexed");
  assert.deepEqual(await apply("thread", "thr_priv"), { indexed: false }, "a private chat is not");
  assert.deepEqual(await apply("thread", "thr_ask"), { indexed: false }, "an Ask pane is not");
  assert.deepEqual(await apply("record:client", "rec_restricted"), { indexed: false }, "a Restricted record is not");
  assert.deepEqual(await apply("file", "fil_payroll"), { indexed: false }, "a Restricted file is not");
  assert.deepEqual(await apply("record:client", "rec_open"), { indexed: true });

  const stored = h.rows("SELECT id, body FROM search_docs ORDER BY id");
  assert.deepEqual(stored.map((r) => r["id"]), ["rec_open", "thr_chan"]);
  const chan = stored.find((r) => r["id"] === "thr_chan")!;
  assert.match(String(chan["body"]), /quarterly numbers/);
  assert.doesNotMatch(String(chan["body"]), /private aside/, "an encrypted message of an indexed channel is left out");
  for (const word of ["diary", "aside", "payroll", "restricted"]) {
    assert.equal((await query(h.ctx, { q: word })).hits.length, 0, `"${word}" finds nothing`);
    assert.equal(h.rows("SELECT rowid FROM search_fts WHERE search_fts MATCH ?", `"${word}"*`).length, 0, `the full text table holds no "${word}"`);
  }
  // a thread that was a channel and became private is taken out when its event is read
  h.respond["threads.get"] = (i) => ({ thread: { threadId: i["threadId"], kind: "chat", title: "now private" } });
  assert.deepEqual(await apply("thread", "thr_chan"), { indexed: false });
  assert.equal(docCount(h), 1);
  assert.equal(h.rows("SELECT rowid FROM search_fts WHERE search_fts MATCH ?", '"quarterly"*').length, 0);
  assert.equal(h.calls("chat.messages.list").filter((c) => c.input["threadId"] === "thr_priv").length, 0, "the messages of a private chat are not even read");
});

test("an event for an end-to-end row is not followed, and the watched events are real", () => {
  assert.equal(targetOf({ type: "message.received", seq: 5, enc: 2, payload: { threadId: "thr_x" } }), null, "enc = 2 is never indexed");
  assert.deepEqual(targetOf({ type: "message.received", seq: 5, enc: 0, payload: { threadId: "thr_x" } }), { entity: "thread", id: "thr_x", op: "upsert", seq: 5 });
  assert.deepEqual(targetOf({ type: "record.updated", seq: 6, payload: { recordId: "rec_a", type: "client" } }), { entity: "record:client", id: "rec_a", op: "upsert", seq: 6 });
  assert.deepEqual(targetOf({ type: "file.purged", seq: 7, payload: { fileId: "fil_a" } }), { entity: "file", id: "fil_a", op: "delete", seq: 7 });
  assert.equal(targetOf({ type: "turn.started", seq: 8, payload: {} }), null, "an event the index does not follow");
  const events = new Map(registry.events.map((e) => [e.name, e]));
  for (const [name, w] of Object.entries(WATCHED)) {
    const e = events.get(name);
    assert.ok(e, `${name} is a declared event`);
    const props = deref(e!.payload, registry.$defs).properties ?? {};
    assert.ok(w.idKey in props, `${name} carries ${w.idKey}`);
  }
  assert.deepEqual(consumers["search.fts"].on, Object.keys(WATCHED));
});

test("a repeated or late event changes nothing; a delete keeps its place so an older upsert cannot bring the row back", async () => {
  let reads = 0;
  const h = harness({
    respond: {
      "agents.get": (i) => { reads++; return { agent: { agentId: i["agentId"], name: `Agent v${reads}`, role: "Takes intake" } }; },
    },
  });
  assert.deepEqual(await indexApply(h.ctx, { entity: "agent", id: "agt_a", op: "upsert", seq: 10 }), { indexed: true });
  assert.deepEqual(await indexApply(h.ctx, { entity: "agent", id: "agt_a", op: "upsert", seq: 10 }), { indexed: false }, "the same event again");
  assert.deepEqual(await indexApply(h.ctx, { entity: "agent", id: "agt_a", op: "upsert", seq: 9 }), { indexed: false }, "an older event");
  assert.equal(reads, 1, "neither was read");
  assert.deepEqual(await indexApply(h.ctx, { entity: "agent", id: "agt_a", op: "delete", seq: 12 }), { indexed: true });
  assert.equal(docCount(h), 0);
  assert.deepEqual(await indexApply(h.ctx, { entity: "agent", id: "agt_a", op: "upsert", seq: 11 }), { indexed: false }, "an upsert older than the delete");
  assert.equal(docCount(h), 0);
  assert.deepEqual(await indexApply(h.ctx, { entity: "agent", id: "agt_a", op: "upsert", seq: 13 }), { indexed: true }, "a newer upsert brings it back");
  assert.deepEqual(contractErrors("search.index.apply", "in", { entity: "agent", id: "agt_a", op: "upsert", seq: 13 }), []);
});

test("a row that is gone or hidden leaves the index; a source that fails is counted as lag and retried", async () => {
  let fail = true;
  const h = harness({
    respond: {
      "tasks.get": (i) => { if (i["taskId"] === "tsk_gone") return notFound(); if (fail) throw new Error("tasks is restarting"); return { task: { id: i["taskId"], title: "Send the lease", summary: "Before Friday" } }; },
    },
  });
  seed(h, { id: "tsk_gone", title: "Old task", kind: "task" });
  assert.deepEqual(await indexApply(h.ctx, { entity: "task", id: "tsk_gone", op: "upsert", seq: 1 }), { indexed: false });
  assert.equal(docCount(h), 0, "a task that no longer exists is taken out");
  await assert.rejects(() => indexApply(h.ctx, { entity: "task", id: "tsk_a", op: "upsert", seq: 2 }), /restarting/);
  assert.equal(h.rows("SELECT count(*) AS c FROM search_failed")[0]!["c"], 1, "the failure is recorded");
  fail = false;
  assert.deepEqual(await indexApply(h.ctx, { entity: "task", id: "tsk_a", op: "upsert", seq: 2 }), { indexed: true }, "the same event succeeds on retry");
  assert.equal(h.rows("SELECT count(*) AS c FROM search_failed")[0]!["c"], 0);
  assert.deepEqual(await indexApply(h.ctx, { entity: "mystery", id: "x_1", op: "upsert", seq: 3 }), { indexed: false }, "an entity nobody can read is ignored");
});
