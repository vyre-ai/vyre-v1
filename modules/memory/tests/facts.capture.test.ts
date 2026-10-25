// Capture at chat end and the nightly job (spec 2.15, ARCH 6.10): facts go where "who accepts what" says, once per message however often capture runs, and the nightly job
// merges, closes and rewrites MAP.md under 200 lines without a word from a personal layer.
import test from "node:test";
import assert from "node:assert/strict";
import { capture, factsList, heuristicExtract, maintain, setCaptureExtractor } from "../handlers/facts.ts";
import { assertEventsConform, asPerson, contractErrors, DAY, harness, NOW, seedFact, seedNote } from "../fixtures/harness.ts";
import type { Responder } from "../fixtures/harness.ts";

const SPEECH = "I prefer short answers. What time is it? My timezone is Pacific. Remember that invoices go out on Monday.";
const person = (id: string) => ({ kind: "person", id });

function chat(kind: string, extra: Record<string, unknown> = {}, messages?: unknown[]): Record<string, Responder> {
  return {
    "threads.get": () => ({ thread: { kind, starter: "usr_dana", agents: [{ agentId: "agt_intake", mode: "lead" }], ...extra } }),
    "chat.messages.list": () => ({
      messages: messages ?? [
        { messageId: "msg_1", author: person("usr_dana"), body: SPEECH },
        { messageId: "msg_2", author: { kind: "agent", id: "agt_intake" }, body: "I always say hello to new clients." },
      ],
    }),
  };
}

test("a private chat's facts go to the person's own layer; the low-risk kind merges, the rest wait", async () => {
  const h = harness({ principal: { kind: "service", id: "svc_engine" }, respond: chat("chat") });
  const out = await capture(h.ctx, { threadId: "thr_one", reason: "closed" });
  assert.deepEqual(out, { proposed: 3, merged: 1 });
  assert.deepEqual(contractErrors("memory.capture", "out", out), []);
  const rows = h.rows("SELECT layer, owner_ref, status, kind, text, enc, source_kind, source_ref, source_person FROM memory_facts ORDER BY kind");
  assert.equal(rows.length, 3);
  for (const r of rows) {
    assert.equal(r["layer"], "person");
    assert.equal(r["owner_ref"], "usr_dana");
    assert.equal(r["text"], "", "sealed under the person's key");
    assert.equal(r["enc"], 2);
    assert.equal(r["source_kind"], "chat");
    assert.equal(r["source_ref"], "thr_one");
    assert.equal(r["source_person"], "usr_dana");
  }
  assert.deepEqual(rows.map((r) => `${r["kind"]}:${r["status"]}`), ["note:proposed", "preference:current", "profile:proposed"]);
  assert.deepEqual(h.named("memory.captured")[0]?.payload, { threadId: "thr_one", proposed: 3, merged: 1 });
  assert.equal(h.named("memory.fact_proposed").length, 3);
  assert.equal(h.named("memory.fact_accepted").length, 1);
  assert.deepEqual(assertEventsConform(h), []);
  // The person sees them; capture again adds nothing.
  const again = await capture(h.ctx, { threadId: "thr_one", reason: "idle" });
  assert.deepEqual(again, { proposed: 0, merged: 0 });
  assert.equal(h.rows("SELECT id FROM memory_facts").length, 3);
});

test("what the person sees after capture is their own, with the source link", async () => {
  const svc = harness({ principal: { kind: "service", id: "svc_engine" }, respond: chat("chat") });
  await capture(svc.ctx, { threadId: "thr_one", reason: "closed" });
  const dana = asPerson(svc, { kind: "person", id: "usr_dana" });
  const list = await factsList(dana.ctx, { status: ["current", "proposed"] });
  assert.equal(list.facts.length, 3);
  assert.ok(list.facts.some((f) => f.text === "I prefer short answers." && f.sourceLink === "/chats/thr_one"));
  const omar = asPerson(svc, { kind: "person", id: "usr_omar" });
  assert.equal((await factsList(omar.ctx, {})).facts.length, 0);
});

test("a channel in a project writes to the project layer directly; without a project it waits for the agent owner", async () => {
  const msgs = [{ messageId: "msg_9", author: person("usr_lead"), body: "We decided to ship the teal version first." }];
  const inProject = harness({ principal: { kind: "service", id: "svc_engine" }, respond: chat("channel", { scopeType: "project", scopeId: "prj_harlow" }, msgs) });
  assert.deepEqual(await capture(inProject.ctx, { threadId: "thr_chan", reason: "idle" }), { proposed: 1, merged: 1 });
  const row = inProject.rows("SELECT layer, owner_ref, project_id, status, text, source_kind FROM memory_facts")[0]!;
  assert.deepEqual([row["layer"], row["owner_ref"], row["project_id"], row["status"], row["source_kind"]], ["project", "prj_harlow", "prj_harlow", "current", "channel"]);
  assert.equal(row["text"], "We decided to ship the teal version first.");

  const loose = harness({ principal: { kind: "service", id: "svc_engine" }, respond: chat("channel", {}, msgs) });
  assert.deepEqual(await capture(loose.ctx, { threadId: "thr_chan", reason: "idle" }), { proposed: 1, merged: 0 });
  const r2 = loose.rows("SELECT layer, owner_ref, agent_id, status FROM memory_facts")[0]!;
  assert.deepEqual([r2["layer"], r2["owner_ref"], r2["agent_id"], r2["status"]], ["agent", "agt_intake", "agt_intake", "proposed"]);
});

test("a run's facts wait in proposed for the agent owner, whoever spoke", async () => {
  const h = harness({ principal: { kind: "service", id: "svc_engine" }, respond: chat("run", {}, [{ messageId: "msg_r", author: person("usr_dana"), body: "Remember that the export runs at night." }]) });
  assert.deepEqual(await capture(h.ctx, { threadId: "thr_run", reason: "closed" }), { proposed: 1, merged: 0 });
  const row = h.rows("SELECT layer, status, source_kind FROM memory_facts")[0]!;
  assert.deepEqual([row["layer"], row["status"], row["source_kind"]], ["agent", "proposed", "run"]);
});

test("a private chat's ciphertext is skipped, and questions are not facts", async () => {
  const h = harness({
    principal: { kind: "service", id: "svc_engine" },
    respond: chat("chat", {}, [
      { messageId: "msg_e", author: person("usr_dana"), body: "x9f0...ciphertext I prefer tea", enc: true },
      { messageId: "msg_q", author: person("usr_dana"), body: "Do I prefer tea or coffee?" },
    ]),
  });
  assert.deepEqual(await capture(h.ctx, { threadId: "thr_enc", reason: "closed" }), { proposed: 0, merged: 0 });
  assert.equal(h.named("memory.captured").length, 1);
});

test("the extractor can be replaced with a model pass, and put back", async () => {
  const h = harness({ principal: { kind: "service", id: "svc_engine" }, respond: chat("chat") });
  setCaptureExtractor(() => [{ person: "usr_dana", text: "Dana runs on oat milk", kind: "preference", messageId: "msg_1", index: 0 }]);
  try {
    assert.deepEqual(await capture(h.ctx, { threadId: "thr_x", reason: "closed" }), { proposed: 1, merged: 1 });
  } finally {
    setCaptureExtractor(null);
  }
  assert.equal(heuristicExtract([{ messageId: "m", author: person("usr_dana"), body: "I never work on Sundays." }]).length, 1);
});

test("nightly: expired facts close, copies merge, and MAP.md is rewritten under 200 lines without personal memory", async () => {
  const h = harness({ respond: { "files.write": () => ({}) } });
  seedNote(h, { fileId: "fil_map", title: "MAP", body: "", layer: "agent", agentId: "agt_intake", path: "Agents/Intake/memory/MAP.md" });
  seedNote(h, { fileId: "fil_c", title: "Clients", body: "Acme, Beta", layer: "agent", agentId: "agt_intake" });
  seedFact(h, { id: "fct_d1", layer: "agent", agentId: "agt_intake", text: "Intake never calls before nine", learnedAt: NOW - 3 * DAY });
  seedFact(h, { id: "fct_d2", layer: "agent", agentId: "agt_intake", text: "intake never calls before  nine", learnedAt: NOW - 2 * DAY });
  seedFact(h, { id: "fct_old", layer: "agent", agentId: "agt_intake", text: "The trial ends on the first", validTo: NOW - DAY });
  seedFact(h, { id: "fct_priv", layer: "person", owner: "usr_dana", agentId: "agt_intake", text: "Dana's private tea preference" });
  const out = await maintain(h.ctx, {});
  assert.deepEqual(out, { merged: 1, closed: 2, maps: 1 });
  assert.deepEqual(contractErrors("memory.maintain", "out", out), []);
  const status = Object.fromEntries(h.rows("SELECT id, status FROM memory_facts").map((r) => [r["id"], r["status"]]));
  assert.deepEqual(status, { fct_d1: "current", fct_d2: "closed", fct_old: "closed", fct_priv: "current" });
  const map = h.rows("SELECT body, lines, file_id FROM memory_maps")[0]!;
  assert.ok(Number(map["lines"]) < 200);
  assert.equal(map["file_id"], "fil_map");
  assert.ok(String(map["body"]).includes("Intake never calls before nine"));
  assert.ok(String(map["body"]).includes("Clients"));
  assert.ok(!String(map["body"]).includes("private tea"));
  assert.equal(h.calls("files.write").length, 1);
  assert.equal(h.calls("files.write")[0]?.input["fileId"], "fil_map");
  assert.deepEqual(h.named("memory.map_rewritten")[0]?.payload, { agentId: "agt_intake", lines: Number(map["lines"]) });
  assert.deepEqual(assertEventsConform(h), []);
  // Idempotent: a second night changes nothing but the map's date.
  assert.deepEqual(await maintain(h.ctx, {}), { merged: 0, closed: 0, maps: 1 });
});

test("a map of a big agent stays under 200 lines", async () => {
  const h = harness();
  for (let i = 0; i < 400; i++) seedFact(h, { id: `fct_big${i}`, layer: "agent", agentId: "agt_intake", text: `Fact number ${i} about topic ${i * 7}` });
  for (let i = 0; i < 150; i++) seedNote(h, { fileId: `fil_note${i}`, title: `Note ${i}`, body: "x", layer: "agent", agentId: "agt_intake" });
  await maintain(h.ctx, { agentId: "agt_intake" });
  const map = h.rows("SELECT lines, body FROM memory_maps")[0]!;
  assert.ok(Number(map["lines"]) <= 200, `map had ${map["lines"]} lines`);
  assert.equal(String(map["body"]).split("\n").length, Number(map["lines"]));
});
