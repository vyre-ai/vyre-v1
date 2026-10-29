// Upkeep (owner design 30 Oct 2026, ruling 5): the rules always run, the model runs only when a key is available and the month's cap allows, and every action is on the trail.
import test from "node:test";
import assert from "node:assert/strict";
import { learned } from "../handlers/lifecycle.ts";
import { claimOf, isNearDuplicate, maintain, questionResolve, questionsList, setUpkeepModel, upkeepStatus } from "../handlers/upkeep.ts";
import type { UpkeepModel, UpkeepRequest } from "../handlers/upkeep.ts";
import { createPage } from "../pages.ts";
import { assertEventsConform, asPerson, codeOf, contractErrors, DAY, harness, NOW, seedFact } from "../fixtures/harness.ts";

const rulesWorld = () => {
  const h = harness({ admin: true, respond: { "files.write": () => ({}) } });
  seedFact(h, { id: "fct_d1", layer: "agent", agentId: "agt_intake", text: "Intake never calls before nine", learnedAt: NOW - 3 * DAY, validFrom: NOW - 3 * DAY, kind: "preference" });
  seedFact(h, { id: "fct_d2", layer: "agent", agentId: "agt_intake", text: "intake never calls before  nine", learnedAt: NOW - 2 * DAY, validFrom: NOW - 2 * DAY, kind: "preference" });
  seedFact(h, { id: "fct_n1", layer: "agent", agentId: "agt_intake", text: "Intake never calls before nine.", learnedAt: NOW - 1 * DAY, validFrom: NOW - 1 * DAY, kind: "preference" });
  return h;
};

test("rules: exact and near duplicates merge into Trash with the old rows kept and a pointer to the fact that stayed", async () => {
  const h = rulesWorld();
  const out = await maintain(h.ctx, {});
  assert.deepEqual(contractErrors("memory.maintain", "out", out), []);
  assert.equal(out.merged, 2);
  const rows = h.rows("SELECT id, status, merged_into, trash_reason, text FROM memory_facts ORDER BY id");
  assert.deepEqual(rows.map((r) => [r["id"], r["status"], r["merged_into"]]), [["fct_d1", "current", null], ["fct_d2", "removed", "fct_d1"], ["fct_n1", "removed", "fct_d1"]]);
  assert.equal(rows[2]!["text"], "Intake never calls before nine.", "the merged-away row keeps its words");
  const lines = h.rows("SELECT action, actor, actor_kind, source, run_id FROM memory_trail WHERE action = 'merge' ORDER BY rowid");
  assert.equal(lines.length, 2);
  assert.ok(lines.every((l) => l["actor"] === "upkeep" && l["actor_kind"] === "upkeep" && l["source"] === "upkeep:rule" && l["run_id"] === out.runId));
  assert.equal(h.named("memory.upkeep_ran").length, 1);
  assert.deepEqual(assertEventsConform(h), []);
  assert.deepEqual((await maintain(h.ctx, {})).merged, 0, "a second night finds nothing more");
});

test("near duplicates and claims are told apart by the same words, not by a loose likeness", () => {
  assert.equal(isNearDuplicate("Dana prefers short answers", "Dana prefers short answers please"), true);
  assert.equal(isNearDuplicate("Dana prefers short answers", "Dana prefers long answers"), false);
  assert.deepEqual(claimOf("Dana's timezone is Pacific."), { subject: "dana", field: "timezone", value: "pacific" });
  assert.deepEqual(claimOf("The retainer is 4000 a month"), { subject: "", field: "retainer", value: "4000 a month" });
  assert.equal(claimOf("We decided to ship the teal version first."), null);
});

test("rules: one subject and field with two values becomes one question with two answers, asked once", async () => {
  const h = harness({ admin: true });
  seedFact(h, { id: "fct_a", layer: "space", text: "Dana's timezone is Pacific", learnedAt: NOW - 5 * DAY, validFrom: NOW - 5 * DAY });
  seedFact(h, { id: "fct_b", layer: "space", text: "Dana's timezone is Eastern", learnedAt: NOW - 2 * DAY, validFrom: NOW - 2 * DAY });
  seedFact(h, { id: "fct_c", layer: "space", text: "Omar's timezone is Eastern", learnedAt: NOW - 2 * DAY, validFrom: NOW - 2 * DAY });
  const out = await maintain(h.ctx, {});
  assert.equal(out.flagged, 1);
  assert.equal((await maintain(h.ctx, {})).flagged, 0, "the same pair is not asked twice");
  const open = await questionsList(h.ctx, {});
  assert.deepEqual(contractErrors("memory.questions.list", "out", open), []);
  assert.equal(open.questions.length, 1);
  assert.deepEqual(open.questions[0]!.facts.map((f) => f.factId), ["fct_a", "fct_b"]);
  assert.equal(h.rows("SELECT status FROM memory_facts WHERE id IN ('fct_a','fct_b') AND status != 'current'").length, 0, "flagging changes nothing");

  const q = open.questions[0]!.questionId;
  await questionResolve(h.ctx, { questionId: q, resolution: "keep_b" });
  const rows = Object.fromEntries(h.rows("SELECT id, status, trash_reason FROM memory_facts").map((r) => [r["id"], `${r["status"]}:${r["trash_reason"] ?? ""}`]));
  assert.deepEqual([rows["fct_a"], rows["fct_b"]], ["removed:contradicted", "current:"]);
  assert.equal((await questionsList(h.ctx, {})).questions.length, 0);
  assert.equal((await questionsList(h.ctx, { status: "resolved" })).questions.length, 1);
  await assert.rejects(() => questionResolve(h.ctx, { questionId: q, resolution: "keep_a" }), (e) => codeOf(e) === "validation.precondition_failed");
  assert.ok(h.rows("SELECT id FROM memory_trail WHERE action IN ('flag', 'resolve')").length >= 2);
});

test("rules: an old fact is flagged by its kind's age, confirmed with one click and not asked again until its period passes", async () => {
  const h = harness({ admin: true });
  seedFact(h, { id: "fct_dl", layer: "space", text: "The filing is due in March", kind: "deadline", learnedAt: NOW - 40 * DAY, validFrom: NOW - 40 * DAY });
  seedFact(h, { id: "fct_pr", layer: "space", text: "Dana likes short answers", kind: "preference", learnedAt: NOW - 100 * DAY, validFrom: NOW - 100 * DAY });
  seedFact(h, { id: "fct_old", layer: "space", text: "The office is on Pine Street", kind: "note", learnedAt: NOW - 400 * DAY, validFrom: NOW - 400 * DAY });
  const out = await maintain(h.ctx, {});
  assert.equal(out.stale, 2, "the deadline after 30 days and the note after a year; the preference is still young");
  const qs = (await questionsList(h.ctx, { kind: "stale" })).questions;
  assert.deepEqual(qs.map((q) => q.facts[0]!.factId).sort(), ["fct_dl", "fct_old"]);
  const dl = qs.find((q) => q.facts[0]!.factId === "fct_dl")!;
  await questionResolve(h.ctx, { questionId: dl.questionId, resolution: "keep_a" });
  assert.equal((await maintain(h.ctx, {})).stale, 0, "confirmed, so not asked again");
  h.advance(31 * DAY);
  assert.equal((await maintain(h.ctx, {})).stale >= 1, true, "asked again once its own period has passed");
  const old = qs.find((q) => q.facts[0]!.factId === "fct_old")!;
  await questionResolve(h.ctx, { questionId: old.questionId, resolution: "drop" });
  assert.equal(h.rows("SELECT status, trash_reason FROM memory_facts WHERE id = 'fct_old'")[0]!["trash_reason"], "stale");
});

function model(calls: UpkeepRequest[], script: (req: UpkeepRequest) => ReturnType<UpkeepModel>): UpkeepModel {
  return async (req) => { calls.push(req); return script(req); };
}

test("model: merges by meaning, writes a pattern fact, learns from a correction, deletes, tidies a page; each action is on the trail with the run", async () => {
  const h = harness({ admin: true });
  seedFact(h, { id: "fct_1", layer: "project", projectId: "prj_harlow", text: "Send the weekly update on Friday", learnedAt: NOW - 20 * DAY, validFrom: NOW - 20 * DAY, kind: "preference" });
  seedFact(h, { id: "fct_2", layer: "project", projectId: "prj_harlow", text: "Friday is when the status email goes out", learnedAt: NOW - 10 * DAY, validFrom: NOW - 10 * DAY });
  seedFact(h, { id: "fct_3", layer: "project", projectId: "prj_harlow", text: "Harlow asked for Friday updates in March", learnedAt: NOW - 8 * DAY, validFrom: NOW - 8 * DAY });
  seedFact(h, { id: "fct_4", layer: "project", projectId: "prj_harlow", text: "Check the wire form twice", learnedAt: NOW - 8 * DAY, validFrom: NOW - 8 * DAY });
  seedFact(h, { id: "fct_5", layer: "project", projectId: "prj_harlow", text: "Rate is 90 an hour", learnedAt: NOW - 6 * DAY, validFrom: NOW - 6 * DAY });
  const page = createPage(h.ctx, { title: "Harlow", kind: "client", layer: "project", ownerRef: "prj_harlow", agentId: null, projectId: "prj_harlow", notes: "harlow   notes\n\n\nmessy" });
  const calls: UpkeepRequest[] = [];
  setUpkeepModel(model(calls, (req) => Promise.resolve({
    usage: { inTokens: 2000, outTokens: 300 },
    actions: [
      { type: "merge", keep: "fct_1", drop: ["fct_2", "fct_ghost", "fct_1"], reason: "same meaning" },
      { type: "create", text: "Harlow wants a status update every Friday", kind: "preference", from: ["fct_1", "fct_3"], reason: "asked for Friday updates three times" },
      { type: "correct", id: "fct_5", text: "Rate is 95 an hour", reason: "a person corrected a similar fact" },
      { type: "delete", id: "fct_4", reason: "no longer true" },
      { type: "tidy_page", pageId: page.id, notes: "Harlow notes", reason: "tidied" },
      { type: "delete", id: "fct_unknown" },
    ].filter((a) => req.scope.layer === "project") as never,
  })));
  try {
    const out = await maintain(h.ctx, {});
    assert.deepEqual(contractErrors("memory.maintain", "out", out), []);
    assert.equal(calls.length, 1, "one call for the one place");
    assert.deepEqual(calls[0]!.scope, { layer: "project", ownerRef: "prj_harlow", agentId: null, projectId: "prj_harlow" });
    assert.deepEqual(calls[0]!.tasks, ["semantic_duplicates", "patterns", "corrections", "tidy_pages"]);
    assert.deepEqual([out.merged, out.created, out.corrected, out.deleted, out.tidied, out.modelUsed], [1, 1, 1, 1, 1, true]);
    assert.equal(out.costMicros, 2000 * 3 + 300 * 15, "the estimate from tokens");
    assert.equal(out.tokensIn, 2000);
    const st = Object.fromEntries(h.rows("SELECT id, status, merged_into FROM memory_facts").map((r) => [r["id"], r]));
    assert.equal(st["fct_2"]!["status"], "removed");
    assert.equal(st["fct_2"]!["merged_into"], "fct_1");
    assert.equal(st["fct_4"]!["status"], "removed");
    assert.equal(st["fct_5"]!["status"], "closed", "the old version of a corrected fact is closed, not overwritten");
    const fresh = h.rows("SELECT text, kind, source_kind, source_ref, status FROM memory_facts WHERE status = 'current' AND replaces IS NULL AND id NOT LIKE 'fct_%'".replace(" AND id NOT LIKE 'fct_%'", " AND source_ref LIKE 'upkeep_%'"));
    assert.deepEqual(fresh.map((r) => [r["text"], r["kind"], r["status"]]), [["Harlow wants a status update every Friday", "preference", "current"]]);
    assert.equal(h.rows("SELECT notes, version FROM memory_pages WHERE page_id = ?", page.id)[0]!["notes"], "Harlow notes");
    const lines = h.rows("SELECT action, actor_kind, source, run_id FROM memory_trail WHERE run_id = ? ORDER BY rowid", out.runId);
    assert.deepEqual(lines.map((l) => l["action"]), ["merge", "learn", "edit", "delete", "edit"], "merge, the pattern fact, the correction, the delete and the page, each on the trail");
    assert.ok(lines.every((l) => l["actor_kind"] === "upkeep"));
    assert.ok(lines.some((l) => l["action"] === "merge" && l["source"] === "upkeep:model"));
    const run = h.rows("SELECT model_used, cost_micros, tokens_in, month FROM memory_upkeep_runs WHERE id = ?", out.runId)[0]!;
    assert.deepEqual([run["model_used"], run["cost_micros"], run["tokens_in"]], [1, 2000 * 3 + 300 * 15, 2000]);
    // the pattern fact is in the Learned feed, learned by upkeep, and can be undone
    const feed = await learned(h.ctx, {});
    const pat = feed.items.find((i) => i.fact.text.includes("status update every Friday"))!;
    assert.deepEqual([pat.actor, pat.actorKind], ["upkeep", "upkeep"]);
    assert.deepEqual(assertEventsConform(h), []);
  } finally { setUpkeepModel(null); }
});

test("model: facts a correction changed are shown to the model as was and now", async () => {
  const h = harness({ admin: true });
  seedFact(h, { id: "fct_old", layer: "space", text: "Invoices go out on Monday", status: "closed", validTo: NOW - 2 * DAY, learnedAt: NOW - 30 * DAY, validFrom: NOW - 30 * DAY });
  h.db.run("INSERT INTO memory_facts (id, layer, owner_ref, text, enc, valid_from, learned_at, source_kind, source_ref, source_person, proposed_by, status, replaces) VALUES ('fct_new', 'space', 'spc_memorytest', 'Invoices go out on Tuesday', 0, ?, ?, 'manual', 'fct_old', 'usr_dana', 'usr_dana', 'current', 'fct_old')", NOW - 2 * DAY, NOW - 2 * DAY);
  seedFact(h, { id: "fct_x", layer: "space", text: "The office has a red door", learnedAt: NOW - 3 * DAY, validFrom: NOW - 3 * DAY });
  const calls: UpkeepRequest[] = [];
  setUpkeepModel(model(calls, () => Promise.resolve({ usage: { inTokens: 10, outTokens: 1 }, actions: [] })));
  try {
    await maintain(h.ctx, {});
    assert.deepEqual(calls[0]!.corrections, [{ factId: "fct_new", was: "Invoices go out on Monday", now: "Invoices go out on Tuesday" }]);
  } finally { setUpkeepModel(null); }
});

test("model: no key for a place leaves it to the rules; with no model bound the run says so and still does the rules", async () => {
  const h = rulesWorld();
  seedFact(h, { id: "fct_z", layer: "agent", agentId: "agt_intake", text: "Dana wants oat milk", learnedAt: NOW - DAY, validFrom: NOW - DAY });
  const calls: UpkeepRequest[] = [];
  setUpkeepModel(model(calls, () => Promise.resolve(null)));
  try {
    const out = await maintain(h.ctx, {});
    assert.equal(calls.length, 1);
    assert.equal(out.merged, 2, "the rules still ran");
    assert.deepEqual([out.modelUsed, out.costMicros, out.stopped], [false, 0, "no_key"]);
  } finally { setUpkeepModel(null); }
  const bare = rulesWorld();
  const out = await maintain(bare.ctx, {});
  assert.deepEqual([out.merged, out.modelUsed, out.stopped], [2, false, "no_key"]);
  const only = rulesWorld();
  setUpkeepModel(model([], () => { throw new Error("must not run"); }));
  try { assert.equal((await maintain(only.ctx, { rulesOnly: true })).merged, 2); } finally { setUpkeepModel(null); }
});

test("model: the monthly cap stops it, the next month starts clean, and the spend is shown to an admin", async () => {
  const h = harness({ admin: true, settings: { "memory.upkeep_monthly_cap": 0.01 } });
  for (const p of ["prj_a", "prj_b", "prj_c"]) {
    seedFact(h, { id: `fct_${p}1`, layer: "project", projectId: p, text: `${p} one`, learnedAt: NOW - DAY });
    seedFact(h, { id: `fct_${p}2`, layer: "project", projectId: p, text: `${p} two`, learnedAt: NOW - DAY });
  }
  const calls: UpkeepRequest[] = [];
  setUpkeepModel(model(calls, () => Promise.resolve({ usage: { inTokens: 100, outTokens: 10, costMicros: 6_000 }, actions: [] })));
  try {
    const first = await maintain(h.ctx, {});
    assert.equal(calls.length, 2, "6000 then 12000 reaches the cap of 10000; the third place is not asked");
    assert.deepEqual([first.costMicros, first.stopped], [12_000, "cap"]);
    const again = await maintain(h.ctx, {});
    assert.equal(calls.length, 2, "the month's spend already holds the cap: no call at all");
    assert.deepEqual([again.costMicros, again.stopped, again.merged], [0, "cap", 0]);
    const st = await upkeepStatus(h.ctx, {});
    assert.deepEqual(contractErrors("memory.upkeep.status", "out", st), []);
    assert.deepEqual([st.spentMicros, st.capMicros, st.capReached, st.modelAvailable, st.runs.length], [12_000, 10_000, true, true, 2]);
    assert.equal(st.runs[1]!.costMicros, 12_000);
    h.advance(32 * DAY);
    const next = await maintain(h.ctx, {});
    assert.equal(calls.length, 4, "a new month: two more places are asked before the cap");
    assert.equal(next.stopped, "cap");
    await assert.rejects(() => upkeepStatus(asPerson(h, { kind: "person", id: "usr_omar" }, { admin: false }).ctx, {}), (e) => codeOf(e) === "permission.role_lacks_permission");
  } finally { setUpkeepModel(null); }
});

test("model: personal facts are sent only when their owner runs upkeep, and a Space needing review holds what the model writes", async () => {
  const h = harness({ settings: { "memory.require_review": true } });
  seedFact(h, { id: "fct_p1", layer: "person", owner: "usr_dana", text: "I take my tea with oat milk", learnedAt: NOW - DAY });
  seedFact(h, { id: "fct_p2", layer: "person", owner: "usr_dana", text: "I like my coffee black", learnedAt: NOW - DAY });
  seedFact(h, { id: "fct_s1", layer: "space", text: "The office closes at five", learnedAt: NOW - DAY });
  seedFact(h, { id: "fct_s2", layer: "space", text: "Closing time is five o'clock", learnedAt: NOW - DAY });
  const calls: UpkeepRequest[] = [];
  setUpkeepModel(model(calls, (req) => Promise.resolve({ usage: { inTokens: 10, outTokens: 1 }, actions: [{ type: "create", text: `Pattern for ${req.scope.layer}`, kind: "pattern", from: [req.facts[0]!.id] }] })));
  try {
    const svc = asPerson(h, { kind: "service", id: "svc_host" }, { settings: { "memory.require_review": true } });
    await maintain(svc.ctx, {});
    assert.deepEqual(calls.map((c) => c.scope.layer), ["space"], "nothing of a personal layer leaves for a service run");
    assert.ok(calls.every((c) => c.facts.every((f) => !f.text.includes("oat milk"))));
    assert.equal(h.rows("SELECT status FROM memory_facts WHERE text = 'Pattern for space'")[0]!["status"], "proposed", "review is required, so the model's fact waits");
    calls.length = 0;
    await maintain(asPerson(h, { kind: "person", id: "usr_dana" }, { settings: { "memory.require_review": true } }).ctx, {});
    assert.deepEqual(calls.map((c) => c.scope.layer).sort(), ["person", "space"]);
    const personal = calls.find((c) => c.scope.layer === "person")!;
    assert.deepEqual(personal.facts.map((f) => f.text).sort(), ["I like my coffee black", "I take my tea with oat milk"]);
    const row = h.rows("SELECT text, sealed, enc FROM memory_facts WHERE source_ref LIKE 'upkeep_%' AND layer = 'person'")[0]!;
    assert.deepEqual([row["text"], row["enc"]], ["", 2], "what the model wrote for a person is sealed");
    const trailDump = JSON.stringify(h.rows("SELECT * FROM memory_trail"));
    assert.ok(!trailDump.includes("oat milk") && !trailDump.includes("Pattern for person"), "the trail holds no personal words");
  } finally { setUpkeepModel(null); }
});
