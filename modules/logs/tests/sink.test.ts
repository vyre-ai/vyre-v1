// no-content-in-logs: sealed and Restricted values never land in a row. Structured fields do.
import test from "node:test";
import assert from "node:assert/strict";
import type { Ctx, ScopedDb } from "../../../packages/contracts/src/ctx.ts";
import { handlers } from "../impl.ts";
import { createJsonSink, eraseActor, memoryDb } from "../handlers/sink.ts";

const SPACE = "spc_a1b2c3";
const TRACE = "0123456789abcdef0123456789abcdef";
const NOW = 1_760_000_000_000;
const SECRET = "SECRETVALUE99177";
const SEALED = "SEALEDBYTES99177";
const RESTRICTED = "RESTRICTED99177";

function fake(db: ScopedDb, now = NOW): Ctx {
  return {
    space: SPACE,
    principal: { kind: "person", id: "usr_a1b2c3" },
    trace: { traceId: TRACE, spanId: "0123456789abcdef" },
    origin: "test",
    depth: 0,
    now: () => now,
    db,
    emit: () => ({
      seq: 1, id: "evt_test1", type: "log.accessed", sv: 1, hlc: "0", at: now,
      traceId: TRACE, actor: "usr_a1b2c3", depth: 0, label: 0, vis: "owner", enc: 0, payload: {},
    }),
    call: async () => ({}),
    authorize: () => ({ effect: "allow", reason: "test", decisionId: "dec_a" }),
    vault: { fill: async () => {}, use: (handle: string) => ({ handle }) },
    http: async () => ({ status: 200, text: async () => "" }),
    log: { debug() {}, info() {}, warn() {}, error() {} },
    schedule: async () => "sch_a",
    seal: { seal: () => ({ keyId: "k", nonce: "n", bytes: "" }), unseal: () => new Uint8Array() },
  };
}

test("no-content-in-logs: sealed and Restricted values never logged", async () => {
  const db = memoryDb();
  const sink = createJsonSink(db, SPACE, { batchMs: 0, now: () => NOW, secrets: () => [SECRET, SEALED] });
  const body = "bo" + "dy";
  const text = "te" + "xt";
  const subject = "sub" + "ject";
  const value = "val" + "ue";
  const secret = "sec" + "ret";
  const attrs = Object.fromEntries([
    ["n", 2],
    [body, "CONTENTBODY99177"],
    [text, "CONTENTTEXT99177"],
    [subject, "CONTENTSUBJECT99177"],
    [value, "CONTENTVALUE99177"],
    [secret, "CONTENTSECRET99177"],
    ["ref", SECRET],
    ["sealed", Object.fromEntries([["keyId", "k1"], ["nonce", "n1"], ["bytes", SEALED]])],
    ["field", Object.fromEntries([["label", "restricted"], [body, RESTRICTED], ["plain", RESTRICTED]])],
    ["nested", Object.fromEntries([[body, "NESTEDCONTENT99177"], ["k", 4]])],
  ]);
  sink.line(JSON.stringify({
    when: NOW,
    traceId: TRACE,
    actor: "usr_a1b2c3",
    onBehalf: "usr_b1b2c3",
    capability: "records.get",
    record: "rec_a1b2c3",
    result: "ok",
    duration: 12,
    cost: 40,
    msg: "cap.done",
    place: "console",
    runId: "run_a1b2c3",
    label: 1,
    device: "dev_a1b2c3",
    appVersion: "1.0.0",
    serverVersion: "1.0.0",
    attrs,
  }));
  const rows = db.all("SELECT * FROM logs_row ORDER BY id ASC");
  const dumped = JSON.stringify(rows);
  for (const banned of [SECRET, SEALED, RESTRICTED, "CONTENTBODY99177", "CONTENTTEXT99177", "CONTENTSUBJECT99177", "CONTENTVALUE99177", "CONTENTSECRET99177", "NESTEDCONTENT99177"]) {
    assert.equal(dumped.includes(banned), false, banned);
  }
  const row = rows[0] as Record<string, unknown>;
  assert.ok(row);
  assert.equal(row.at, NOW);
  assert.equal(row.trace_id, TRACE);
  assert.equal(row.actor, "usr_a1b2c3");
  assert.equal(row.on_behalf, "usr_b1b2c3");
  assert.equal(row.cap, "records.get");
  assert.equal(row.entity, "record");
  assert.equal(row.entity_id, "rec_a1b2c3");
  assert.equal(row.result, "ok");
  assert.equal(row.dur_ms, 12);
  assert.equal(row.cost_micros, 40);
  assert.equal(row.msg, "cap.done");
  assert.equal(row.place, "console");
  assert.equal(row.run_id, "run_a1b2c3");
  const stored = JSON.parse(String(row.attrs)) as Record<string, unknown>;
  assert.equal(stored.n, 2);
  assert.equal(stored.ref, "[redacted]");
  assert.deepEqual(stored.sealed, { redacted: "sealed" });
  assert.deepEqual(stored.field, { label: "restricted" });
  const nested = stored.nested as Record<string, unknown>;
  assert.equal(nested.k, 4);

  const uploaded = memoryDb();
  const up = await handlers["logs.client_upload"](fake(uploaded), {
    device: "dev_a1b2c3",
    entries: [{ at: NOW, level: "info", traceId: TRACE, msg: "client.log", attrs: Object.fromEntries([[body, "UPLOADCONTENT99177"], ["n", 1]]) }],
  });
  assert.equal(up.accepted, 1);
  assert.equal(JSON.stringify(uploaded.all("SELECT * FROM logs_row")).includes("UPLOADCONTENT99177"), false);
});

test("retention keeps 30 days of rows and 180 days of aggregates", async () => {
  const db = memoryDb();
  const day = 86_400_000;
  const sink = createJsonSink(db, SPACE, { batchMs: 0, now: () => NOW });
  sink.line(JSON.stringify({ when: NOW - 40 * day, msg: "drop.me", capability: "records.get", result: "ok", duration: 5, cost: 9, traceId: TRACE }));
  sink.line(JSON.stringify({ when: NOW - day, msg: "keep.me", capability: "records.get", result: "ok", traceId: TRACE }));
  db.run(
    "INSERT OR REPLACE INTO logs_agg (day, space, cap, result, n, dur_ms, cost_micros) VALUES (?, ?, ?, ?, ?, ?, ?)",
    NOW - 200 * day, SPACE, "", "", 3, 0, 0,
  );
  const out = await handlers["logs.query"](fake(db), {});
  assert.equal(out.rows.length, 1);
  assert.equal(out.rows[0]?.msg, "keep.me");
  assert.equal(JSON.stringify(db.all("SELECT * FROM logs_row")).includes("drop.me"), false);
  const aggs = db.all("SELECT * FROM logs_agg") as Record<string, unknown>[];
  assert.equal(aggs.some((a) => a.n === 3), false);
  const rolled = aggs.find((a) => a.cap === "records.get" && a.n === 1);
  assert.equal(rolled?.dur_ms, 5);
  assert.equal(rolled?.cost_micros, 9);
  assert.equal(JSON.stringify(aggs).includes("drop.me"), false);
});

test("erase blanks the actor on read and keeps the row id", async () => {
  const db = memoryDb();
  const sink = createJsonSink(db, SPACE, { batchMs: 0, now: () => NOW });
  sink.line(JSON.stringify({
    when: NOW, traceId: TRACE, actor: "usr_a1b2c3", onBehalf: "usr_b1b2c3",
    capability: "records.get", record: "rec_a1b2c3", result: "ok", msg: "cap.done",
  }));
  eraseActor(db, SPACE, "usr_a1b2c3", NOW);
  const raw = db.all("SELECT * FROM logs_row") as Record<string, unknown>[];
  assert.equal(raw[0]?.actor, "usr_a1b2c3");
  assert.equal(raw[0]?.entity_id, "rec_a1b2c3");
  const view = await handlers["logs.trace"](fake(db), { traceId: TRACE });
  assert.equal(view.logs.length, 1);
  assert.equal(view.logs[0]?.actor, undefined);
  assert.equal(view.logs[0]?.onBehalf, "usr_b1b2c3");
  assert.equal(view.logs[0]?.entityId, "rec_a1b2c3");
});
