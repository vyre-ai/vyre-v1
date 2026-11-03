// A Space made before a memory column was added (audience came in rc.18, after archived_by) must get the column when it is upgraded: search, recall and learning ran on a store without it and threw
// "no such column: audience". The store here is built the way an rc.17 server had it (every column but the later ones), then opened by the current code.
import test from "node:test";
import assert from "node:assert/strict";
import { capture, pointer, search, proposeFact } from "../handlers/facts.ts";
import { harness, openRaw } from "../fixtures/harness.ts";
import type { RawDb } from "../../../host/src/ctx/db.ts";
import type { RawDb } from "../fixtures/harness.ts";

const TRAIL_COLUMNS = ["audience"];
const LATER = [["memory_pages", "subtitle"], ["memory_pages", "blurb"], ["memory_mentions", "message_id"], ["memory_page_links", "target"]] as const;
const columns = (raw: RawDb, table: string): string[] => (raw.all(`PRAGMA table_info(${table})`) as Array<{ name: string }>).map((c) => c.name);

/** A store as an older server left it: the current tables, then the columns the later releases added taken away again. */
async function olderStore(drop: readonly string[], dropLater = false) {
  const raw = openRaw();
  await search(harness({ raw }).ctx, { q: "warm", mode: "keyword" });
  raw.run("DROP INDEX IF EXISTS memory_facts_trash");
  for (const c of drop) raw.run(`ALTER TABLE memory_facts DROP COLUMN ${c}`);
  if (dropLater) for (const [t, c] of LATER) { try { raw.run(`ALTER TABLE ${t} DROP COLUMN ${c}`); } catch { /* has an index or default: leave */ } }
  for (const c of drop) assert.ok(!columns(raw, "memory_facts").includes(c), `${c} is gone from the old store`);
  return raw;
}

test("a store without audience is upgraded on first use: search, recall and learning run", async () => {
  const raw = await olderStore(TRAIL_COLUMNS);
  const h = harness({ raw });   // a new handle, as after a restart
  const out = await search(h.ctx, { q: "anything", mode: "keyword" });
  assert.deepEqual(out.hits, []);
  assert.ok(columns(raw, "memory_facts").includes("audience"), "the column was added");
  const added = await proposeFact(h.ctx, { text: "Dana takes her coffee black", agentId: "agt_intake", sourceKind: "manual", sourceRef: "typed" });
  const found = await search(harness({ raw }).ctx, { q: "coffee black", mode: "keyword" });
  assert.equal(found.hits[0]?.factId, added.fact.factId);
  const p = await pointer(harness({ raw }).ctx, { threadId: "thr_a", agentId: "agt_intake", text: "how does Dana take her coffee?" });
  assert.equal(p.lines[0]?.fact, "Dana takes her coffee black");
  const chat = {
    "threads.get": () => ({ thread: { kind: "chat", starter: "usr_dana", agents: [{ agentId: "agt_intake", mode: "lead" }], members: [{ kind: "person", id: "usr_dana" }] } }),
    "agents.get": () => ({ agent: { folderId: "fld_intake", ownerId: "usr_boss", captureMode: "auto" } }),
    "chat.messages.list": () => ({ messages: [{ messageId: "msg_1", threadSeq: 1, author: { kind: "person", id: "usr_dana" }, body: "I prefer meetings after 2pm. My timezone is Karachi." }], hasMore: false }),
    "engine.models.list": () => ({ models: [] }),
  };
  const learn = await capture(harness({ raw, respond: chat }).ctx, { threadId: "thr_a", reason: "closed", agentId: "agt_intake" });
  assert.ok(learn.proposed >= 1, JSON.stringify(learn));
});

test("every column added after the first schema is added to an old store, one by one", async () => {
  for (const c of ["audience", "trashed_at", "archived_by", "touched_at"]) {
    const raw = await olderStore([c]);
    await search(harness({ raw }).ctx, { q: "x", mode: "keyword" });
    assert.ok(columns(raw, "memory_facts").includes(c), `${c} comes back`);
  }
});
