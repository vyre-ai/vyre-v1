// P-CC_39: logs.purge removes log rows older than a cutoff the caller names, folding them into the per-day summaries first (the same code as the daily retention), with their spans and events; younger rows
// stay; a hold on the logs stops it and says so; running it twice removes nothing more.
// @reads ../migrations/0001_init.sql
import test from "node:test";
import assert from "node:assert/strict";
import { harness, NOW } from "../fixtures/db.ts";
import type { Harness } from "../fixtures/db.ts";
import { DAY_MS, LogWriter, placeHold } from "../handlers/sink.ts";
import { handlers } from "../handlers/index.ts";

const purge = (h: Harness, before: number) => (handlers as Record<string, (c: unknown, i: unknown) => Promise<unknown>>)["logs.purge"]!(h.ctx, { before, idempotencyKey: "k" });

function age(h: Harness, days: number): void {
  const w = new LogWriter({ db: h.ctx.db, space: h.ctx.space, now: () => NOW - days * DAY_MS, batchMs: 0, minLevel: "debug" });
  w.write({ msg: "a.b", cap: "records.update", result: "ok", costMicros: 5, durMs: 10 });
  w.span({ traceId: "0123456789abcdef0123456789abcdef", spanId: String(days).padStart(16, "0"), name: "s.x" });
  w.event({ traceId: "0123456789abcdef0123456789abcdef", seq: days + 1, type: "a.b", actor: "usr_x" });
}

test("rows older than the cutoff are folded and deleted with their spans and events; younger rows stay; a second run removes nothing", async () => {
  const h = harness();
  for (const d of [100, 60, 3]) age(h, d);
  assert.equal(h.raw.rows("logs_row").length, 3);
  const out = await purge(h, NOW - 30 * DAY_MS);
  assert.deepEqual(out, { removed: 2, more: false });
  assert.equal(h.raw.rows("logs_row").length, 1, "only the 3 day old row stays");
  assert.equal(h.raw.rows("logs_span").length, 1);
  assert.equal(h.raw.rows("logs_event").length, 1);
  assert.equal(h.raw.rows("logs_aggregate").length, 2, "each old day left a summary, no words");
  assert.deepEqual(h.events.map((e) => [e.name, e.payload]), [["logs.purged", { removed: 2 }]]);
  assert.deepEqual(await purge(h, NOW - 30 * DAY_MS), { removed: 0, more: false });
});

test("a hold on the logs stops the purge and is counted", async () => {
  const h = harness();
  for (const d of [100, 60]) age(h, d);
  placeHold(h.ctx.db, h.ctx.space, "hold_1");
  assert.deepEqual(await purge(h, NOW - 30 * DAY_MS), { removed: 0, more: false, skippedOnHold: 1 });
  assert.equal(h.raw.rows("logs_row").length, 2);
});
