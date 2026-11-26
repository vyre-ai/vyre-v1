// The purge cleans a type's log a page at a time: the rows of a page are written again (record.rebased) BEFORE the page's old events are erased, so a stop between the two never leaves an erased event without its row.
import test from "node:test";
import assert from "node:assert/strict";
import { cleanFields } from "../handlers/purge.ts";
import type { SchemaDeps } from "../projections.ts";

const enc = new TextEncoder();
function world(n: number, o: { crashOnErase?: number } = {}) {
  const log: string[] = [];
  const events = Array.from({ length: n }, (_, i) => ({
    seq: i + 1,
    type: "record.created",
    payload: enc.encode(JSON.stringify({ type: "t", id: `rec_${i}`, data: { name: `n${i}`, note: "secret" } })),
  }));
  let erases = 0;
  const host = {
    store: {
      db: { exec() {}, prepare: () => ({ get: () => ({ page_count: 1, page_size: 1 }) }) },
      read: (a: { after: number; limit: number }) => events.filter((e) => e.seq > a.after).slice(0, a.limit),
      erase: (seq: number) => {
        if (o.crashOnErase !== undefined && ++erases > o.crashOnErase) throw new Error("stopped");
        log.push(`erase:${seq}`);
      },
    },
    append: (e: { entity_id: string }) => {
      log.push(`append:${e.entity_id}`);
    },
  };
  const tx = {
    get: () => ({ version: 1, created_at: 1, updated_at: 1, deleted_at: null, data: JSON.stringify({ name: "x" }) }),
    run() {},
    all: () => [],
    exec() {},
  };
  return { log, deps: { host, tx, now: () => 1 } as unknown as SchemaDeps };
}

test("every page appends its rebased rows before it erases its events (1,100 events, three pages)", async () => {
  const { log, deps } = world(1_100);
  const r = await cleanFields(deps, "t", ["note"]);
  assert.equal(r.events, 1_100);
  const firstAppend = new Map<string, number>();
  log.forEach((l, i) => {
    if (l.startsWith("append:") && !firstAppend.has(l.slice(7))) firstAppend.set(l.slice(7), i);
  });
  log.forEach((l, i) => {
    if (!l.startsWith("erase:")) return;
    const id = `rec_${Number(l.slice(6)) - 1}`;
    assert.ok(firstAppend.get(id)! < i, `${id} is written again before its event is erased`);
  });
});

test("a stop at the first erase leaves the page's rebased rows written and nothing erased; the next run does the page again", async () => {
  const { log, deps } = world(300, { crashOnErase: 0 });
  await assert.rejects(cleanFields(deps, "t", ["note"]), /stopped/);
  assert.equal(log.filter((l) => l.startsWith("erase:")).length, 0);
  assert.equal(log.filter((l) => l.startsWith("append:")).length, 300);
});
