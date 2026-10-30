// Memory upkeep and meaning search on a booted daemon (owner design 30 Oct 2026): rules merge and flag, a model through the vendor stand-in does the rest until the monthly cap stops it, and meaning
// search finds a fact that shares no word with the question, with keyword search answering (and saying why) when the model is off or fails.
import test from "node:test";
import assert from "node:assert/strict";
import { setEmbedder, setUpkeepModel } from "../modules/memory/impl.ts";
import type { UpkeepRequest } from "../modules/memory/impl.ts";
import { stubEmbedder } from "../modules/memory/fixtures/embedder.ts";
import { DAY, boot, call, clock, connect, newAgent, say, close, seededDir, waitFor, hostLog } from "./memory-live-kit.ts";
type Fact = { factId: string; text: string; status: string; sourceLink?: string; trashReason?: string };
const current = async (d: Daemon, agentId: string): Promise<Fact[]> => (await call(d, "memory.facts.list", { agentId, status: ["current"], fromMe: true })).data.facts ?? [];

test("memory core live: upkeep merges and flags by rule, a model through the vendor stand-in does the rest, and the monthly cap stops it", async () => {
  const d = await boot(seededDir());
  const asked: UpkeepRequest[] = [];
  // the model vendor stand-in: it answers like a model would for a place, and reports tokens and a cost
  setUpkeepModel(async (req) => {
    asked.push(req);
    const first = req.facts[0];
    return { usage: { inTokens: 1000, outTokens: 100, costMicros: 6_000 }, actions: first ? [{ type: "create" as const, text: `Pattern noticed in ${req.scope.layer} memory`, kind: "pattern", from: [first.id] }] : [] };
  });
  try {
    await connect(d);
    assert.equal((await call(d, "engine.pool.status", {})).status, 200);
    const keeper = await newAgent(d, "Keeper");
    let n = 0;
    const put = async (layer: string, text: string): Promise<void> => {
      const r = await call(d, "memory.propose_fact", { idempotencyKey: `up-${++n}`, layer, ...(layer === "agent" ? { agentId: keeper.id } : {}), text, kind: "preference", sourceKind: "manual", sourceRef: "live" });
      assert.equal(r.status, 200, JSON.stringify(r.data));
      assert.equal(r.data.merged, true, `${text} is saved: ${JSON.stringify(r.data)}`);
    };
    await put("space", "The front desk never books before nine");
    await put("space", "The front desk never books before nine.");
    await put("space", "Dana's timezone is Pacific");
    await put("space", "Dana's timezone is Eastern");
    await put("person", "I like my coffee black");
    await put("person", "I walk to the office");
    await put("agent", "Keeper files the weekly update on Friday");
    await put("agent", "Keeper sends invoices on Monday");

    // rules only: the near duplicate goes to Trash, the contradiction becomes a question
    const rules = await call(d, "memory.maintain", { rulesOnly: true });
    assert.equal(rules.status, 200, JSON.stringify(rules.data));
    assert.deepEqual([rules.data.merged, rules.data.flagged, rules.data.modelUsed], [1, 1, false]);
    assert.equal(asked.length, 0, "rulesOnly never asks the model");
    const trash = (await call(d, "memory.trash.search", { q: "front desk" })).data.facts as Array<{ trashReason?: string }>;
    assert.equal(trash.length, 1);
    assert.equal(trash[0]!.trashReason, "near duplicate");
    const qs = (await call(d, "memory.questions.list", {})).data.questions as Array<{ questionId: string; kind: string; facts: unknown[] }>;
    assert.deepEqual(qs.map((q) => [q.kind, q.facts.length]), [["contradiction", 2]]);
    assert.equal((await call(d, "memory.question.resolve", { questionId: qs[0]!.questionId, resolution: "keep_b" })).status, 200);

    // the model: the monthly cap (one cent) lets two of the three places in; the third is not asked
    assert.equal((await call(d, "settings.set_space", { key: "memory.upkeep_monthly_cap", value: 0.01, idempotencyKey: "up-cap" })).status, 200);
    const run = await call(d, "memory.maintain", {});
    assert.equal(run.status, 200, JSON.stringify(run.data));
    assert.equal(asked.length, 2, JSON.stringify(asked.map((a) => a.scope)));
    assert.deepEqual([run.data.modelUsed, run.data.costMicros, run.data.stopped, run.data.created], [true, 12_000, "cap", 2]);
    const status = (await call(d, "memory.upkeep.status", {})).data;
    assert.deepEqual([status.spentMicros, status.capMicros, status.capReached], [12_000, 10_000, true]);
    assert.deepEqual(status.runs.map((r: { costMicros: number }) => r.costMicros), [12_000, 0]);
    const feed = (await call(d, "memory.learned", {})).data.items as Array<{ actor: string; fact: { text: string } }>;
    assert.ok(feed.some((i) => i.actor === "upkeep" && i.fact.text.startsWith("Pattern noticed")), "what upkeep wrote is in the Learned feed, learned by upkeep");
    const trail = (await call(d, "memory.trail", { actor: "upkeep" })).data.rows as Array<{ source?: string; runId?: string }>;
    assert.ok(trail.some((r) => r.source === "upkeep:model" || r.runId === run.data.runId), JSON.stringify(trail.slice(0, 3)));
    const second = await call(d, "memory.maintain", {});
    assert.equal(asked.length, 2, "the month's spend holds the cap: no call");
    assert.equal(second.data.stopped, "cap");
    clock.t += 32 * DAY;
    const next = await call(d, "memory.maintain", {});
    assert.equal(asked.length, 4, "a new month starts clean");
    assert.equal(next.data.stopped, "cap");
  } finally { setUpkeepModel(null); await d.stop(); }
});


test("memory core live: meaning search finds the Chase feed for a bank reconciliation question; with the model off or failing, keyword search answers and says why", async () => {
  const d = await boot(seededDir());
  // the embedding model stand-in: words belong to concepts, so two texts about one concept are close with no word in common
  const model = stubEmbedder();
  setEmbedder("local", model);
  try {
    await connect(d);
    let n = 0;
    const put = async (text: string): Promise<string> => {
      const r = await call(d, "memory.propose_fact", { idempotencyKey: `mn-${++n}`, layer: "space", text, kind: "preference", sourceKind: "manual", sourceRef: "live" });
      assert.equal(r.status, 200, JSON.stringify(r.data));
      return r.data.fact.factId as string;
    };
    const chase = await put("The Chase feed didn't match");
    await put("We interview a candidate on Tuesday");
    await put("The forecast says rain on Friday");
    const hits = async (q: string, mode?: string): Promise<{ hits: Array<{ factId?: string }>; meaning?: { state: string; hint?: string } }> => (await call(d, "memory.search", { q, ...(mode ? { mode } : {}) })).data;

    const found = await hits("bank reconciliation");
    assert.deepEqual(found.hits.map((h) => h.factId), [chase], JSON.stringify(found));
    assert.equal(found.meaning?.state, "on");
    assert.deepEqual((await hits("bank reconciliation", "keyword")).hits, [], "words alone do not find it");
    const ranked = (await call(d, "memory.meaning.rank", { query: "bank reconciliation", candidates: [{ id: "a", text: "The Chase feed didn't match" }, { id: "b", text: "The forecast says rain" }] })).data;
    assert.deepEqual(ranked.scores.map((x: { id: string; score: number }) => [x.id, x.score > 0.5]), [["a", true], ["b", false]]);
    const status = (await call(d, "memory.meaning.status", {})).data;
    assert.deepEqual([status.mode, status.state, status.indexed], ["local", "on", 3]);

    // the setting switches the model off; keyword search answers and says so
    assert.equal((await call(d, "settings.set_space", { key: "memory.meaning_search", value: "off", idempotencyKey: "mn-off" })).status, 200);
    const off = await hits("bank reconciliation");
    assert.deepEqual([off.hits.length, off.meaning?.state], [0, "off"]);
    assert.equal((await call(d, "settings.set_space", { key: "memory.meaning_search", value: "local", idempotencyKey: "mn-on" })).status, 200);

    // a model that fails: keyword search still finds the words, with a plain reason
    model.fail = true;
    const broke = await hits("Chase feed");
    assert.deepEqual(broke.hits.map((h) => h.factId), [chase]);
    assert.equal(broke.meaning?.state, "degraded");
    assert.match(broke.meaning?.hint ?? "", /Keyword search is in use/);
    model.fail = false;

    // a trashed fact is out of meaning search
    await call(d, "memory.facts.remove", { factIds: [chase] });
    assert.deepEqual((await hits("bank reconciliation")).hits, []);
  } finally { setEmbedder("local", null); await d.stop(); }
});

test("memory core live: pages keep versioned Notes, [[links]] become labelled edges with evidence and a chat links back, the graph answers for a date, and the export holds the brain", async () => {
  const d = await boot(seededDir());
  try {
    await connect(d);
    assert.equal((await call(d, "engine.pool.status", {})).status, 200);
    const keeper = await newAgent(d, "Keeper");
    const putPage = async (title: string, notes: string, extra: Record<string, unknown> = {}): Promise<{ pageId: string; version: number }> => {
      const r = await call(d, "memory.page.put", { title, notes, layer: "space", ...extra });
      assert.equal(r.status, 200, JSON.stringify(r.data));
      return r.data.page;
    };
    const t0 = clock.t;
    const firm = await putPage("Harlow Dental", "A dental practice.", { kind: "client" });
    const dr = await putPage("Dr Harlow", "Owns the practice.\nemployer:: [[Harlow Dental]]", { kind: "person" });
    clock.t = t0 + 3 * DAY;
    const edit = await call(d, "memory.page.put", { pageId: dr.pageId, notes: "Owns the practice.\nretired from:: [[Harlow Dental]]", baseVersion: 1 });
    assert.equal(edit.data.page.version, 2, JSON.stringify(edit.data));
    const stale = await call(d, "memory.page.put", { pageId: dr.pageId, notes: "late", baseVersion: 1 });
    assert.equal(stale.status, 422, JSON.stringify(stale.data));
    assert.equal(stale.data.error.code, "validation.precondition_failed", "a writer who started from version 1 is refused");

    // a chat names the page; the graph consumer turns it into a backlink with the line as its quote
    const chat = await say(d, keeper.id, "Please call [[Harlow Dental]] about the retainer.", "pg1");
    assert.equal((await call(d, "memory.index_graph", { entity: "chat", id: chat.threadId, seq: 1 })).status, 200);
    const got = (await call(d, "memory.page.get", { pageId: firm.pageId })).data;
    assert.deepEqual(got.backlinks.map((b: { kind: string; title: string; label?: string }) => [b.kind, b.label ?? ""]).sort(), [["chat", ""], ["page", "retired from"]]);
    const fromChat = got.backlinks.find((b: { kind: string }) => b.kind === "chat");
    assert.match(fromChat.quote, /call \[\[Harlow Dental\]\] about the retainer/);

    // the graph now, and as it stood on day one
    const now = (await call(d, "memory.graph", { scope: "space" })).data;
    const edge = now.edges.find((e: { kind: string; from: string }) => e.kind === "link" && e.from === `page:${dr.pageId}`);
    assert.deepEqual([edge.label, edge.evidence, edge.to], ["retired from", "retired from:: [[Harlow Dental]]", `page:${firm.pageId}`]);
    assert.ok(now.edges.some((e: { kind: string; to: string; evidence?: string }) => e.kind === "mention" && e.to === `page:${firm.pageId}` && /retainer/.test(e.evidence ?? "")), JSON.stringify(now.edges));
    assert.ok(now.nodes.some((n: { nodeId: string; kind: string }) => n.nodeId === `chat:${chat.threadId}` && n.kind === "chat"), "chats are nodes");
    const then = (await call(d, "memory.graph", { scope: "space", asOf: t0 + DAY })).data;
    const old = then.edges.find((e: { kind: string; from: string }) => e.kind === "link" && e.from === `page:${dr.pageId}`);
    assert.deepEqual([old.label, old.evidence], ["employer", "employer:: [[Harlow Dental]]"], "on day one the link said employer");
    assert.equal(then.nodes.some((n: { kind: string }) => n.kind === "chat"), false, "the chat did not exist yet");
    const local = (await call(d, "memory.graph", { scope: "space", focus: `page:${dr.pageId}`, hops: 1 })).data;
    assert.deepEqual(local.nodes.map((n: { nodeId: string }) => n.nodeId).sort(), [`page:${dr.pageId}`, `page:${firm.pageId}`].sort());

    // facts that name a subject sit on its page, and the export carries pages, facts and Notes
    assert.equal((await call(d, "memory.propose_fact", { idempotencyKey: "pg-f", layer: "space", text: "Harlow Dental pays by wire transfer.", kind: "preference", sourceKind: "manual", sourceRef: "live" })).status, 200);
    assert.equal((await call(d, "memory.page.get", { pageId: firm.pageId })).data.facts.length, 1);
    const exported = (await call(d, "memory.export_markdown", {})).data;
    assert.ok(exported.markdown.includes("### Harlow Dental") && exported.markdown.includes("Harlow Dental pays by wire transfer.") && exported.markdown.includes("retired from: [[Harlow Dental]]"), exported.markdown);
    assert.deepEqual([exported.pages, exported.facts >= 1], [2, true]);

    // a page deleted is in Trash and restored; the versions are kept
    assert.equal((await call(d, "memory.page.delete", { pageId: dr.pageId })).data.trashed, true);
    assert.equal((await call(d, "memory.page.list", {})).data.total, 1);
    const back = await call(d, "memory.restore", { pageId: dr.pageId, idempotencyKey: "pg-restore" });
    assert.equal(back.data.restoredFrom, "trash", JSON.stringify(back.data));
    assert.equal((await call(d, "memory.page.versions", { pageId: dr.pageId })).data.versions.length, 2);
  } finally { await d.stop(); }
});

test("memory core live: engine.complete is internal: a person and an agent tool are both refused", async () => {
  const d = await boot(seededDir());
  try {
    await connect(d);
    assert.equal((await call(d, "engine.pool.status", {})).status, 200);
    const keeper = await newAgent(d, "Keeper");
    const accounts = (await call(d, "engine.accounts.list", {})).data.accounts as Array<{ ref: string }>;
    const person = await call(d, "engine.complete", { accountRef: accounts[0]!.ref, prompt: "Tasks: patterns." });
    assert.equal(person.status, 403, JSON.stringify(person.data));
    assert.equal(person.data.error.code, "permission.no_grant");
    // an agent has no tool for it: asking for the tool finds nothing, and calling it by name is refused
    const viaAgent = await say(d, keeper.id, `TOOL engine_complete ${JSON.stringify({ accountRef: accounts[0]!.ref, prompt: "Tasks: patterns.", idempotencyKey: "ec1" })}`, "ec");
    assert.doesNotMatch(viaAgent.reply, /TOOL RESULT ok/, viaAgent.reply);
  } finally { await d.stop(); }
});

test("memory core live: upkeep runs on the key memory.key.resolve names, through engine.complete, meters the tokens and stops at the monthly cap", async () => {
  const d = await boot(seededDir());
  try {
    await connect(d);
    assert.equal((await call(d, "engine.pool.status", {})).status, 200);
    const accounts = (await call(d, "engine.accounts.list", {})).data.accounts as Array<{ ref: string }>;
    const ref = accounts[0]!.ref;
    const put = async (text: string, key: string): Promise<void> => {
      const r = await call(d, "memory.propose_fact", { idempotencyKey: key, layer: "person", text, kind: "preference", sourceKind: "manual", sourceRef: "live" });
      assert.equal(r.status, 200, JSON.stringify(r.data));
    };
    await put("I like my coffee black", "k1");
    await put("I walk to the office", "k2");

    // no key chosen: rules only, nothing spent
    const none = await call(d, "memory.maintain", {});
    assert.deepEqual([none.data.modelUsed, none.data.costMicros, none.data.stopped], [false, 0, "no_key"], JSON.stringify(none.data));

    // the person picks their account for personal memory; resolve names it
    assert.equal((await call(d, "memory.key.set", { layer: "person", accountRef: ref })).status, 200);
    const me = ((await call(d, "memory.facts.list", { layer: "person", status: ["current"] })).data.facts as Array<{ ownerRef: string }>)[0]!.ownerRef;
    const resolved = (await call(d, "memory.key.resolve", { layer: "person", ownerRef: me })).data;
    assert.equal(resolved.key?.accountRef, ref, JSON.stringify(resolved));

    // a cap of half a cent: the stand-in reports 1200 tokens in and 80 out = 4800 micro-dollars a run, so two runs fit and the third is stopped
    assert.equal((await call(d, "settings.set_space", { key: "memory.upkeep_monthly_cap", value: 0.005, idempotencyKey: "cap-kr" })).status, 200);
    const first = await call(d, "memory.maintain", {});
    assert.deepEqual([first.data.modelUsed, first.data.costMicros, first.data.tokensIn, first.data.tokensOut, first.data.created], [true, 4_800, 1_200, 80, 1], JSON.stringify(first.data));
    const second = await call(d, "memory.maintain", {});
    assert.deepEqual([second.data.modelUsed, second.data.costMicros], [true, 4_800], JSON.stringify(second.data));
    const third = await call(d, "memory.maintain", {});
    assert.deepEqual([third.data.modelUsed, third.data.costMicros, third.data.stopped], [false, 0, "cap"], JSON.stringify(third.data));

    const status = (await call(d, "memory.upkeep.status", {})).data;
    assert.deepEqual([status.spentMicros, status.capMicros, status.capReached], [9_600, 5_000, true]);
    assert.equal(status.nights[0].costMicros, 9_600);
    const facts = (await call(d, "memory.facts.list", { layer: "person", status: ["current"] })).data.facts as Array<{ text: string }>;
    assert.ok(facts.some((f) => f.text === "Pattern noticed by the stand-in"), "what the model wrote is a fact, sealed to the person");
  } finally { await d.stop(); }
});
