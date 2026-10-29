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
