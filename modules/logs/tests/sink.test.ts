// Sink: structured rows, no sealed or Restricted values, retention, logs.db writes.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { DAY_MS, createBook } from "../handlers/sink.ts";
import type { SqlDb } from "../handlers/sink.ts";
import { bookFor, handlers } from "../handlers/index.ts";
import type { LogCtx } from "../handlers/index.ts";
import { projections } from "../projections.ts";

const TRACE = "0123456789abcdef0123456789abcdef";
const SECRET = "sk-live-123";
const SEALED = "CIPHERTEXT_SSN_999";
const RESTRICTED = "SSN 123-45-6789";
const SENTENCE = "the user typed hello";

function fake(space: string, events: { name: string; payload: unknown }[] = []): LogCtx {
  return {
    space,
    principal: { kind: "person", id: "usr_owner" },
    trace: { traceId: TRACE, spanId: "0123456789abcdef" },
    now: () => 5_000_000,
    db: {
      all() { throw new Error("db off"); },
      run() { throw new Error("db off"); },
    },
    emit(name, _subject, payload) { events.push({ name, payload }); },
  };
}

test("no-content-in-logs: sealed and Restricted values never logged", () => {
  const book = createBook({ space: "spc_redact", now: () => 5000, batchMs: 0, secrets: () => [SECRET] });
  book.write({
    at: 5000,
    level: "info",
    traceId: TRACE,
    spanId: "abcdef0123456789",
    actor: "usr_dana",
    onBehalf: "usr_owner",
    cap: "records.update",
    entity: "record",
    entityId: "rec_1",
    result: "ok",
    durMs: 3.5,
    costMicros: 12,
    label: 1,
    appVersion: "1.0.0",
    serverVersion: "1.0.0",
    msg: "record.updated",
    attrs: {
      count: 2,
      body: "the secret text",
      text: "hello",
      subject: "hi",
      value: "v",
      secret: "s",
      nested: { subject: "inner", id: "rec_1" },
      note: SECRET,
      ssn: { sealed: "ssn", ref: "sv_1", present: true, bytes: SEALED },
      field: { label: "restricted", text: RESTRICTED },
    },
  });
  book.write({
    at: 5001,
    label: "restricted",
    traceId: TRACE,
    entityId: "rec_9",
    msg: SENTENCE,
    attrs: { note: RESTRICTED, entityId: "rec_9" },
  });
  const rows = book.rawRows();
  const first = rows[0];
  const second = rows[1];
  if (!first || !second) throw new Error("expected two rows");
  assert.equal(first.at, 5000);
  assert.equal(first.level, 20);
  assert.equal(first.traceId, TRACE);
  assert.equal(first.actor, "usr_dana");
  assert.equal(first.onBehalf, "usr_owner");
  assert.equal(first.cap, "records.update");
  assert.equal(first.entityId, "rec_1");
  assert.equal(first.result, "ok");
  assert.equal(first.durMs, 3.5);
  assert.equal(first.costMicros, 12);
  assert.equal(first.appVersion, "1.0.0");
  assert.equal(first.serverVersion, "1.0.0");
  assert.equal(first.msg, "record.updated");
  assert.deepEqual(first.attrs, { count: 2, nested: { id: "rec_1" }, note: "[redacted]" });
  assert.equal(second.msg, "log.redacted");
  assert.equal(second.label, 3);
  assert.equal(second.entityId, "rec_9");
  assert.equal(second.attrs, undefined);
  const dumped = JSON.stringify(rows);
  for (const forbidden of ["the secret text", "hello", "CIPHERTEXT", SEALED, RESTRICTED, SECRET, "sv_1", SENTENCE, "inner"]) {
    assert.equal(dumped.includes(forbidden), false, forbidden);
  }
  book.erase("usr_dana");
  assert.equal(book.rawRows()[0]?.actor, "usr_dana");
});

test("structured JSON lines batch into logs.db and a fixture line keeps its fields", () => {
  const line = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "../fixtures/lines.jsonl"), "utf8").trim();
  const book = createBook({ space: "spc_line", now: () => 1, batchMs: 0 });
  assert.equal(book.acceptLine(line), true);
  assert.equal(book.acceptLine("not-json"), false);
  const row = book.rawRows()[0];
  if (!row) throw new Error("missing fixture row");
  assert.equal(row.traceId, TRACE);
  assert.equal(row.actor, "usr_owner");
  assert.equal(row.onBehalf, "usr_ana");
  assert.equal(row.cap, "records.update");
  assert.equal(row.entityId, "rec_seed");
  assert.equal(row.result, "ok");
  assert.equal(row.durMs, 4);
  assert.equal(row.costMicros, 0);
  assert.equal(row.msg, "record.updated");
  assert.deepEqual(row.attrs, { count: 1 });

  let now = 1000;
  const calls: { sql: string; args: unknown[] }[] = [];
  const db: SqlDb = {
    all() { return []; },
    run(sql, ...args) { calls.push({ sql, args }); return { changes: 1 }; },
  };
  const slow = createBook({ space: "spc_batch", batchMs: 60_000, now: () => ++now, secrets: () => [SECRET], db });
  slow.write({ space: "spc_batch", level: 20, msg: "thing.done", traceId: "t1", actor: "usr_dana", attrs: { count: 2, body: "the secret text", note: SECRET } } as never);
  assert.equal(slow.pending(), 1, "queued, not written yet");
  assert.equal(slow.rawRows().length, 0);
  assert.equal(calls.length, 0);
  slow.flush();
  assert.equal(slow.rawRows().length, 1);
  assert.deepEqual(slow.rawRows()[0]?.attrs, { count: 2, note: "[redacted]" });
  const insert = calls.find((c) => c.sql.includes("INSERT OR REPLACE INTO logs_row"));
  if (!insert) throw new Error("no insert");
  const flat = JSON.stringify(insert.args);
  assert.equal(flat.includes(SECRET), false);
  assert.equal(flat.includes("the secret text"), false);
  slow.close();
});

test("retention keeps 30 days of rows and 180 days of aggregates, and a hold blocks expiry", () => {
  let now = 0;
  const book = createBook({ space: "spc_ret", now: () => now, batchMs: 0 });
  book.write({ at: 0, msg: "old.row", cap: "records.update", result: "ok", costMicros: 5, durMs: 1 });
  book.write({ at: 10 * DAY_MS, msg: "mid.row", cap: "records.update", result: "ok", costMicros: 2, durMs: 1 });
  now = 40 * DAY_MS;
  book.retain();
  assert.deepEqual(book.rawRows().map((r) => r.msg), ["mid.row"]);
  assert.equal(book.aggregates().length, 1);
  assert.equal(book.aggregates()[0]?.rows, 1);
  book.placeHold("hld_1");
  now = 80 * DAY_MS;
  book.retain();
  assert.deepEqual(book.rawRows().map((r) => r.msg), ["mid.row"]);
  book.releaseHold("hld_1");
  book.retain();
  assert.equal(book.rawRows().length, 0);
  assert.equal(book.aggregates().length, 2);
  now = 220 * DAY_MS + 1;
  book.retain();
  assert.equal(book.aggregates().length, 0);
});

test("handlers cover every logs capability and drop sealed upload attrs", async () => {
  assert.equal(projections.length, 1);
  assert.deepEqual(Object.keys(handlers).sort(), [
    "logs.client_upload", "logs.export", "logs.query", "logs.replay_get", "logs.replay_start",
    "logs.settings_get", "logs.settings_set", "logs.spans", "logs.tail", "logs.trace",
  ]);
  const events: { name: string; payload: unknown }[] = [];
  const ctx = fake("spc_up", events);
  ctx.actingFor = "usr_ana";
  const settings = await handlers["logs.settings_get"](ctx);
  assert.deepEqual(settings, { level: "info", fullDays: 30, aggregateDays: 180 });
  assert.deepEqual(await handlers["logs.settings_set"](ctx, { level: "warn", fullDays: 14, aggregateDays: 90 }), { ok: true });
  assert.deepEqual((await handlers["logs.settings_get"](ctx)).fullDays, 14);
  const uploaded = await handlers["logs.client_upload"](ctx, {
    device: "dev_phone1",
    entries: [{ at: 5_000_000, traceId: TRACE, level: "info", msg: "ring.push", attrs: { body: "hidden", count: 1, ssn: { sealed: true, bytes: SEALED } } }],
  });
  assert.equal(uploaded.accepted, 1);
  assert.equal(events[0]?.name, "client_log.uploaded");
  const row = bookFor("spc_up", () => 5_000_000).rawRows()[0];
  if (!row) throw new Error("upload did not land");
  assert.equal(row.msg, "ring.push");
  assert.equal(row.actor, "usr_owner");
  assert.equal(row.onBehalf, "usr_ana");
  assert.equal(row.device, "dev_phone1");
  assert.deepEqual(row.attrs, { count: 1 });
  assert.equal(JSON.stringify(row).includes(SEALED), false);
  assert.equal(JSON.stringify(row).includes("hidden"), false);
  const found = await handlers["logs.query"](ctx, { traceId: TRACE });
  assert.equal(found.rows.length, 1);
  assert.equal(found.rows[0]?.msg, "ring.push");
  const view = await handlers["logs.trace"](ctx, { traceId: TRACE });
  assert.equal(view.logs.length, 1);
  const spans = await handlers["logs.spans"](ctx, { traceId: TRACE });
  assert.equal(spans.total, 0);
  assert.match((await handlers["logs.tail"](ctx, { traceId: TRACE })).streamId, /^stm_[a-z0-9]+$/);
  assert.match((await handlers["logs.export"](ctx, { traceId: TRACE })).fileId, /^fil_[a-z0-9]+$/);
  const started = await handlers["logs.replay_start"](ctx, { atSeq: 4, runId: "run_a1b2c3" });
  assert.match(started.replayId, /^rpl_[a-z0-9]+$/);
  assert.deepEqual(events.map((e) => e.name), ["client_log.uploaded", "replay.started", "replay.finished"]);
  const replay = await handlers["logs.replay_get"](ctx, { replayId: started.replayId });
  assert.equal(replay.state, "done");
  assert.equal(replay.recordedOutward, 0);
  assert.equal(replay.steps.length, 3);
  assert.equal((await handlers["logs.replay_get"](ctx, { replayId: "rpl_missing" })).state, "failed");
});

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
test("logs module typechecks under tsconfig.base.json", { timeout: 18_000 }, () => {
  const files = [
    "modules/logs/handlers/sink.ts",
    "modules/logs/handlers/search.ts",
    "modules/logs/handlers/index.ts",
    "modules/logs/impl.ts",
    "modules/logs/projections.ts",
    "modules/logs/fixtures/seed.ts",
    "modules/logs/tests/sink.test.ts",
    "modules/logs/tests/search.test.ts",
  ];
  for (const f of files) assert.equal(/@ts-(nocheck|ignore|expect-error)/.test(fs.readFileSync(path.join(REPO, f), "utf8")), false, f);
  let cache = "";
  for (const d of ["/var/lib/ci-run/tsc-cache-v1", path.join(os.tmpdir(), "tsc-cache-v1")]) {
    try { fs.mkdirSync(d, { recursive: true }); fs.accessSync(d, fs.constants.W_OK); cache = d; break; } catch { /* next */ }
  }
  assert.ok(cache, "a writable cache directory");
  const tsc = path.join(cache, "node_modules/typescript/bin/tsc");
  if (!fs.existsSync(tsc)) {
    fs.writeFileSync(path.join(cache, "package.json"), "{\"private\":true}\n");
    const installed = spawnSync("npm", ["install", "--no-audit", "--no-fund", "--ignore-scripts", "typescript@5.9.3", "@types/node@24"], { cwd: cache, encoding: "utf8" });
    assert.equal(installed.status, 0, installed.stderr);
  }
  const cfg = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "tsc-")), "tsconfig.json");
  fs.writeFileSync(cfg, JSON.stringify({
    extends: path.join(REPO, "tsconfig.base.json"),
    compilerOptions: { typeRoots: [path.join(cache, "node_modules/@types")], types: ["node"], noEmit: true },
    files: files.map((f) => path.join(REPO, f)),
  }));
  const r = spawnSync(process.execPath, [tsc, "-p", cfg, "--pretty", "false"], { cwd: REPO, encoding: "utf8" });
  const mine = `${r.stdout}\n${r.stderr}`.split("\n").filter((l) => /^modules\/logs\/.*\(\d+,\d+\): error/.test(l));
  assert.deepEqual(mine, [], mine.join("\n"));
});
