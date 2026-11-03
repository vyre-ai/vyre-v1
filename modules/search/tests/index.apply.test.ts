// The index consumer's sources and the admin side of the module: what each entity becomes in the index, the rebuild, the vectors batch, the stats and health, and Recent.
import test from "node:test";
import assert from "node:assert/strict";
import { embedRun, health, indexApply, indexRebuild, indexStats, recentRecord, setLister } from "../handlers/index.ts";
import { query, recentList, related, resolveItem } from "../handlers/query.ts";
import { setSource } from "../projections.ts";
import { assertEventsConform, asPerson, contractErrors, harness, notFound, seed } from "../fixtures/harness.ts";

const row = (h: ReturnType<typeof harness>, id: string): Record<string, unknown> => h.rows("SELECT * FROM search_docs WHERE id = ?", id)[0]!;

test("a record becomes its title and the words of its fields, never a credential", async () => {
  const h = harness({
    respond: {
      "records.get": (i) => ({ record: { id: i["recordId"], type: "client", label: 1, fields: { name: "Acme Corp", city: "Lisbon", tags: ["vip", "harbor"], apiKey: "s3cret-key", size: 40, nested: { x: "ignored" } }, updatedAt: 5 } }),
      "schema.types.get": (i) => ({ type: { key: i["type"], titleField: "name" } }),
    },
  });
  assert.deepEqual(await indexApply(h.ctx, { entity: "record:client", id: "rec_a", op: "upsert", seq: 1 }), { indexed: true });
  const d = row(h, "rec_a");
  assert.equal(d["title"], "Acme Corp");
  assert.equal(d["record_type"], "client");
  assert.equal(d["link"], "vyre://record/rec_a");
  assert.equal(d["updated_at"], 5);
  assert.match(String(d["body"]), /Lisbon vip harbor 40/);
  assert.doesNotMatch(String(d["body"]), /s3cret|ignored/);
  assert.deepEqual((await query(h.ctx, { q: "lisbon", recordType: "client" })).hits.map((x) => x.id), ["rec_a"]);
  assert.deepEqual((await query(h.ctx, { q: "lisbon", recordType: "invoice" })).hits, []);
  assert.deepEqual(h.calls("records.get")[0]!.input, { recordId: "rec_a", type: "client" });
});

test("a file becomes its name, its folder path and, for text, its first twenty thousand characters", async () => {
  const h = harness({
    respond: {
      "files.get": (i) => ({ file: i["fileId"] === "fil_pdf" ? { fileId: "fil_pdf", name: "Scan.pdf", kind: "pdf", folderId: "fld_a", label: 1 } : i["fileId"] === "fil_del" ? { fileId: "fil_del", name: "Old.md", kind: "markdown", deletedAt: 3 } : { fileId: i["fileId"], name: "Lease.md", kind: "markdown", folderId: "fld_a", label: 1, updatedAt: 9 } }),
      "files.folder.get": () => ({ folder: { path: "Clients/Harbor" } }),
      "files.read": () => ({ text: "The rent is due on the first of the month" }),
    },
  });
  await indexApply(h.ctx, { entity: "file", id: "fil_md", op: "upsert", seq: 1 });
  await indexApply(h.ctx, { entity: "file", id: "fil_pdf", op: "upsert", seq: 2 });
  const md = row(h, "fil_md");
  assert.equal(md["path"], "Clients/Harbor/Lease.md");
  assert.match(String(md["body"]), /rent is due/);
  assert.equal(row(h, "fil_pdf")["body"], "", "a PDF has no text to read here");
  assert.equal(h.calls("files.read").length, 1, "only the text file was read");
  assert.deepEqual(h.calls("files.read")[0]!.input, { fileId: "fil_md", as: "text", length: 20000 });
  assert.deepEqual((await query(h.ctx, { q: "rent due", types: ["file"] })).hits.map((x) => [x.id, x.path]), [["fil_md", "Clients/Harbor/Lease.md"]]);
  seed(h, { id: "fil_del", title: "Old.md", kind: "file" });
  await indexApply(h.ctx, { entity: "file", id: "fil_del", op: "upsert", seq: 3 });
  assert.equal(h.rows("SELECT n FROM search_docs WHERE id = ?", "fil_del").length, 0, "a deleted file is not kept");
});

test("agents, automations, tasks, channels and channel threads are indexed by what a person types to find them", async () => {
  const h = harness({
    respond: {
      "agents.get": () => ({ agent: { agentId: "agt_i", name: "Intake", role: "Books consults", lastActiveAt: 7 } }),
      "automations.get": () => ({ automation: { id: "aut_w", name: "Welcome series", description: "Sends the three welcome emails", updatedAt: 8 } }),
      "tasks.get": () => ({ task: { id: "tsk_l", title: "Send the lease", summary: "Before Friday", why: "The client asked", updatedAt: 9 } }),
      "channels.get": (i) => ({ channel: i["channelId"] === "chn_old" ? { channelId: "chn_old", name: "Old", archived: true } : { channelId: "chn_g", name: "general", topic: "Everything about the office", createdAt: 3 } }),
      "threads.get": () => ({ thread: { threadId: "thr_k", kind: "thread", title: "Kickoff notes", createdAt: 4 } }),
      "chat.messages.list": () => ({ messages: [{ messageId: "msg_1", body: "Agenda: lease, budget, hiring", enc: 0 }] }),
    },
  });
  let seq = 1;
  for (const [entity, id] of [["agent", "agt_i"], ["automation", "aut_w"], ["task", "tsk_l"], ["channel", "chn_g"], ["channel", "chn_old"], ["thread", "thr_k"]] as const) {
    await indexApply(h.ctx, { entity, id, op: "upsert", seq: seq++ });
  }
  const find = async (q: string, kind: string): Promise<string[]> => (await query(h.ctx, { q, types: [kind as "agent"] })).hits.map((x) => x.id);
  assert.deepEqual(await find("consults", "agent"), ["agt_i"]);
  assert.deepEqual(await find("welcome emails", "automation"), ["aut_w"]);
  assert.deepEqual(await find("friday", "task"), ["tsk_l"]);
  assert.deepEqual(await find("office", "channel"), ["chn_g"]);
  assert.deepEqual(await find("budget", "chat"), ["thr_k"], "a channel thread is found by its messages");
  assert.equal(h.rows("SELECT n FROM search_docs WHERE id = 'chn_old'").length, 0, "an archived channel is not offered");
});

test("the host can give the index a source for an entity the module cannot read itself", async () => {
  const h = harness();
  setSource("principal", async (_ctx, id) => ({ doc: { entity: "principal", id, kind: "person", title: "Elena Marsh", body: "Partner", link: `vyre://person/${id}`, label: 0, resource: { type: "space", id: null } } }));
  try {
    assert.deepEqual(await indexApply(h.ctx, { entity: "principal", id: "usr_elena", op: "upsert", seq: 1 }), { indexed: true });
    assert.deepEqual((await query(h.ctx, { q: "elena", types: ["person"] })).hits.map((x) => x.title), ["Elena Marsh"]);
  } finally { setSource("principal", null); }
});

test("a rebuild reads every listed row again, removes what is gone and says how many documents there are", async () => {
  const h = harness({
    respond: {
      "agents.list": (i) => (i["cursor"] ? { agents: [{ agentId: "agt_3" }] } : { agents: [{ agentId: "agt_1" }, { agentId: "agt_2" }], next: "2" }),
      "agents.get": (i) => (i["agentId"] === "agt_old" ? notFound() : { agent: { agentId: i["agentId"], name: `Agent ${String(i["agentId"])}`, role: "Helps" } }),
    },
  });
  seed(h, { id: "agt_old", title: "Retired agent", kind: "agent" });
  for (const base of ["automation", "channel", "task", "thread"]) setLister(base, async () => []);
  try {
    const r = await indexRebuild(h.ctx, {});
    assert.match(r.runId, /^run_[a-z0-9]+$/);
    assert.deepEqual(contractErrors("search.index.rebuild", "out", r), []);
    assert.deepEqual(h.rows("SELECT id FROM search_docs ORDER BY id").map((x) => x["id"]), ["agt_1", "agt_2", "agt_3"], "listed rows are in, the missing one is out");
    const ev = h.named("search.reindexed")[0]!;
    assert.deepEqual(ev.payload, { documents: 3, runId: r.runId });
    assert.deepEqual(assertEventsConform(h), []);
    const s = await indexStats(h.ctx);
    assert.equal(s.documents, 3);
    assert.equal(s.lastRebuildAt, h.clock.t);
    assert.deepEqual(contractErrors("search.index.stats", "out", s), []);
    // one entity only
    const again = await indexRebuild(h.ctx, { entity: "agent" });
    assert.deepEqual(h.named("search.reindexed")[1]!.payload, { entity: "agent", documents: 3, runId: again.runId });
  } finally { for (const base of ["automation", "channel", "task", "thread"]) setLister(base, null); }
});

test("the vectors come in batches: newest first, counted as pending until done, dropped when the document changes", async () => {
  const h = harness();
  for (let i = 0; i < 5; i++) seed(h, { id: `rec_${i}`, title: `Harbor lease number ${i}`, body: "Rent schedule", kind: "record" });
  assert.equal((await indexStats(h.ctx)).vectorBacklog, 5);
  assert.deepEqual(await embedRun(h.ctx, { limit: 3 }), { embedded: 3, pending: 2 });
  assert.deepEqual(h.rows("SELECT id FROM search_docs WHERE embedded = 1 ORDER BY id").map((r) => r["id"]), ["rec_2", "rec_3", "rec_4"], "the newest first");
  assert.deepEqual(await embedRun(h.ctx, {}), { embedded: 2, pending: 0 });
  assert.deepEqual(await embedRun(h.ctx, {}), { embedded: 0, pending: 0 });
  assert.equal((await indexStats(h.ctx)).vectors, 5);
  assert.deepEqual(contractErrors("search.embed.run", "out", await embedRun(h.ctx, {})), []);
  // a changed document is a new row without a vector until the next batch
  const h2 = harness({ respond: { "agents.get": () => ({ agent: { agentId: "agt_a", name: "Intake", role: "Books" } }) } });
  await indexApply(h2.ctx, { entity: "agent", id: "agt_a", op: "upsert", seq: 1 });
  await embedRun(h2.ctx, {});
  assert.equal((await indexStats(h2.ctx)).vectors, 1);
  await indexApply(h2.ctx, { entity: "agent", id: "agt_a", op: "upsert", seq: 2 });
  assert.deepEqual([(await indexStats(h2.ctx)).vectors, (await indexStats(h2.ctx)).vectorBacklog], [0, 1], "the old vector went with the old row");
});

test("health is healthy on a working index, degraded while rows wait for a retry, and the stats say how far behind it is", async () => {
  const h = harness({ respond: { "tasks.get": () => { throw new Error("down"); } } });
  seed(h, { id: "rec_a", title: "Anything", kind: "record" });
  const ok = await health(h.ctx);
  assert.equal(ok.state, "healthy");
  assert.deepEqual(contractErrors("search.health", "out", ok), []);
  await assert.rejects(() => indexApply(h.ctx, { entity: "task", id: "tsk_x", op: "upsert", seq: 1 }));
  const bad = await health(h.ctx);
  assert.equal(bad.state, "degraded");
  assert.match(String(bad.detail), /1 rows could not be read/);
  assert.equal((await indexStats(h.ctx)).ftsLagSeq, 1);
});

test("Recent lists what the asker opened, newest first, only what they may still see and only theirs", async () => {
  const h = harness();
  seed(h, { id: "rec_a", title: "Alpha", kind: "record" });
  seed(h, { id: "fil_b", title: "Beta.md", kind: "file" });
  seed(h, { id: "rec_c", title: "Gamma", kind: "record" });
  assert.deepEqual(await recentRecord(h.ctx, { kind: "record", itemId: "rec_a" }), { ok: true });
  h.advance(1000);
  await recentRecord(h.ctx, { kind: "file", itemId: "fil_b" });
  h.advance(1000);
  await recentRecord(h.ctx, { kind: "record", itemId: "rec_c" });
  h.advance(1000);
  await recentRecord(h.ctx, { kind: "record", itemId: "rec_a" });
  assert.deepEqual((await recentList(h.ctx, {})).hits.map((x) => x.id), ["rec_a", "rec_c", "fil_b"], "opened again moves to the top, once");
  assert.deepEqual((await recentList(h.ctx, { types: ["file"] })).hits.map((x) => x.id), ["fil_b"]);
  assert.deepEqual((await recentList(h.ctx, { limit: 1 })).hits.map((x) => x.id), ["rec_a"]);
  h.deny("record:rec_c");
  assert.deepEqual((await recentList(h.ctx, {})).hits.map((x) => x.id), ["rec_a", "fil_b"]);
  assert.deepEqual((await recentList(asPerson(h, { kind: "person", id: "usr_omar" }).ctx, {})).hits, [], "another person's Recent is empty");
  assert.deepEqual(contractErrors("search.recent.list", "out", await recentList(h.ctx, {})), []);
});

test("Redaction for AI: a person still finds a redacted word in a file they may read; an agent's search, Related, Resolve and an Ask turn never do", async () => {
  const RAW = "Ms. Elena Rivera was diagnosed with a torn meniscus in her right knee. Our demand is $85,000.";
  const AGENT = "Ms. [REDACTED] was diagnosed with a [REDACTED]. Our demand is ==$85,000==.";
  const h = harness({
    respond: {
      "files.get": (i) => ({ file: { fileId: i["fileId"], name: i["fileId"] === "fil_demand" ? "Demand letter.md" : i["fileId"] === "fil_ret" ? "Retainer.md" : "Knee notes.md", kind: "markdown", folderId: "fld_a", label: 1, updatedAt: 9 } }),
      "files.folder.get": () => ({ folder: { path: "Projects/Rivera injury claim" } }),
      "files.read": (i) => ({ text: i["fileId"] === "fil_clear" ? "Knee exam notes for the clinic." : i["fileId"] === "fil_ret" ? "Retainer: torn meniscus claim, fee one third." : RAW }),
      "files.agent_view": (i) => (i["fileId"] === "fil_demand" ? { state: "redacted", name: "Demand letter.md", path: "Projects/[REDACTED] injury claim", text: AGENT }
        : i["fileId"] === "fil_ret" ? { state: "off", name: "Retainer.md", path: "Projects/[REDACTED] injury claim", text: null }
        : { state: "clear", name: "Knee notes.md", path: "Projects/Rivera injury claim", text: "Knee exam notes for the clinic." }),
    },
  });
  for (const [id, seq] of [["fil_demand", 1], ["fil_ret", 2], ["fil_clear", 3]] as const) await indexApply(h.ctx, { entity: "file", id, op: "upsert", seq });
  assert.match(String(row(h, "fil_demand")["body"]), /meniscus/, "the index keeps the whole text for people");
  assert.equal(h.rows("SELECT n FROM search_agent_docs").length, 2, "only the files an agent reads differently carry an agent view");
  assert.equal((await embedRun(h.ctx, {})).embedded, 3, "the vectors are built from the whole text, so the agent filter must hold against them too");

  // a person who may read the file finds the redacted word, quoted from the whole text
  const person = await query(h.ctx, { q: "meniscus", types: ["file"], mode: "keyword" });
  assert.deepEqual(person.hits.map((x) => x.id).sort(), ["fil_demand", "fil_ret"]);
  assert.ok((await query(h.ctx, { q: "torn meniscus knee", types: ["file"], mode: "semantic" })).hits.some((x) => x.id === "fil_demand"), "a person's semantic search finds it");
  assert.match(String(person.hits.find((x) => x.id === "fil_demand")!.snippet), /\[meniscus\]/);

  // an agent never does: not the redacted file, not the file agents may not see, in keyword, semantic or hybrid
  const agent = asPerson(h, { kind: "agent", id: "agt_intake" });
  for (const mode of ["keyword", "semantic", "hybrid"] as const) {
    assert.deepEqual((await query(agent.ctx, { q: "meniscus", types: ["file"], mode })).hits, [], `an agent's ${mode} search finds no redacted word`);
    assert.deepEqual((await query(agent.ctx, { q: "Elena Rivera", mode })).hits, [], `an agent's ${mode} search finds no redacted name`);
  }
  // an Ask turn: a person's question run by the engine is agent-bound, so it reads the agent's view too
  const ask = { ...h.ctx, origin: "engine" };
  assert.deepEqual((await query(ask, { q: "meniscus", types: ["file"] })).hits, [], "the agent's Ask the Space never finds it");
  assert.deepEqual((await query({ ...h.ctx, forAgent: "agt_intake" }, { q: "torn meniscus" })).hits, [], "nor a person's rerun that stands for an agent");

  // what an agent may find, it finds as an agent may read it: the agent title, path and snippet, no hidden word
  const seen = await query(agent.ctx, { q: "demand", types: ["file"] });
  assert.deepEqual(seen.hits.map((x) => x.id), ["fil_demand"]);
  assert.equal(seen.hits[0]!.path, "Projects/[REDACTED] injury claim/Demand letter.md");
  assert.doesNotMatch(JSON.stringify(seen.hits), /meniscus|Elena|Rivera/);
  assert.deepEqual((await query(agent.ctx, { q: "knee", types: ["file"] })).hits.map((x) => x.id), ["fil_clear"], "a clear file is searched as it is");

  // Resolve and Related: the file agents may not see is not there, the redacted one carries no hidden word, and Related never links through one
  assert.deepEqual(await resolveItem(agent.ctx, { kind: "file", itemId: "fil_ret" }), {});
  assert.doesNotMatch(JSON.stringify(await resolveItem(agent.ctx, { kind: "file", itemId: "fil_demand" })), /meniscus|Elena|Rivera/);
  assert.ok((await resolveItem(h.ctx, { kind: "file", itemId: "fil_ret" })).hit, "a person resolves it");
  assert.ok((await related(h.ctx, { kind: "file", itemId: "fil_ret" })).hits.some((x) => x.id === "fil_demand"), "a person's Related links the two by the word meniscus");
  assert.deepEqual((await related(agent.ctx, { kind: "file", itemId: "fil_ret" })).hits, [], "an agent's Related of a file it may not see is empty");
  assert.doesNotMatch(JSON.stringify(await related(agent.ctx, { kind: "file", itemId: "fil_clear" })), /meniscus|Elena|Rivera/);

  // a file taken out of the index takes its agent view with it
  await indexApply(h.ctx, { entity: "file", id: "fil_demand", op: "delete", seq: 4 });
  assert.equal(h.rows("SELECT n FROM search_agent_docs").length, 1);
});
