// @reads /modules/sync/migrations/0001_pull.sql
// Budget sync.snapshot (ARCH 9): 100,000 rows to a device in under 10 s. Pages are gzip NDJSON of up to 5000 rows, resumable by `after`, scoped to the person, and never carry a hidden row or field.
import test from "node:test";
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { MAX_SNAPSHOT_PAGE } from "../../../sync/src/protocol.ts";
import { decodePage, encodePage } from "../../../sync/src/server/pull/index.ts";
import type { PullCtx } from "../handlers/index.ts";
import { openSync } from "../impl.ts";
import { seedContacts } from "../fixtures/seed.ts";
import { ADA, BO, NOW, buildAccess } from "../fixtures/world.ts";

const TRACE = "0123456789abcdef0123456789abcdef";
const ROWS = 100_000;
const ctx = (person: string, device = "dev1"): PullCtx => ({ trace: { traceId: TRACE }, principal: person, deviceId: device, deviceClass: "desktop" });

test("snapshot of 100,000 rows: pages of at most 5000, ordered, resumable, under 10 s; a person's snapshot holds only what they may see", async () => {
  const access = buildAccess();
  const s = openSync({ access: () => access, clock: () => NOW });
  seedContacts(s.host, { count: ROWS });
  const h = s.handlers;

  // Ada sees everything. Server work only: begin, every page cut, gzipped.
  const t0 = performance.now();
  const begin = await h["sync.snapshot.begin"](ctx(ADA), { deviceClass: "desktop" });
  assert.deepEqual(begin.plan, [{ entity: "contact", estimatedRows: ROWS }]);
  assert.equal(begin.asOfSeq, 0);
  const pages: Uint8Array[] = [];
  let after: string | undefined;
  for (;;) {
    const page = await h["sync.snapshot.page"](ctx(ADA), { entity: "contact", ...(after !== undefined ? { after } : {}), asOf: begin.asOfSeq });
    pages.push(encodePage(page));
    if (page.done) break;
    after = page.last;
    assert.ok(pages.length < 50);
  }
  const ms = performance.now() - t0;
  assert.ok(ms < 10_000, `100k rows took ${ms.toFixed(0)} ms, budget 10000 ms`);

  // The client side: decode every page, count, order.
  let total = 0, prev = "";
  const sizes: number[] = [];
  for (const bytes of pages) {
    const page = decodePage(bytes);
    sizes.push(page.rows.length);
    for (const r of page.rows) { assert.ok(r.id > prev, "ids ascend across pages"); prev = r.id; }
    total += page.rows.length;
  }
  assert.equal(total, ROWS);
  assert.ok(sizes.every((n) => n <= MAX_SNAPSHOT_PAGE));
  assert.deepEqual(sizes.slice(0, 3), [5000, 5000, 5000]);
  assert.equal(pages.length, 21, "twenty full pages and the empty final page");

  // A row on the wire carries its field clocks.
  const first = decodePage(pages[0]!).rows[0]!;
  assert.equal(first.id, "c000000");
  assert.equal(first.fields["name"]?.v, "Contact 0");
  assert.equal(first.fields["name"]?.actor, "svc_import");
  assert.match(first.fields["name"]?.hlc ?? "", /^[0-9a-f]+-[0-9a-f]+-/);
  assert.equal(first.fields["name"]?.seq, 0);

  // The handler that serves the HTTP route gives the same bytes' content.
  const wire = await h.snapshotPageBytes(ctx(ADA), { entity: "contact", asOf: begin.asOfSeq });
  assert.deepEqual(decodePage(wire), decodePage(pages[0]!));

  // Resuming from `last` of page 2 gives exactly page 3.
  const second = decodePage(pages[1]!);
  const resumed = await h["sync.snapshot.page"](ctx(ADA), { entity: "contact", after: second.last!, asOf: begin.asOfSeq });
  assert.deepEqual(resumed.rows.map((r) => r.id), decodePage(pages[2]!).rows.map((r) => r.id));

  // Bo may see region eu only and never the phone field: the other three quarters are never sent.
  const boBegin = await h["sync.snapshot.begin"](ctx(BO), { deviceClass: "desktop" });
  const got: string[] = [];
  let boAfter: string | undefined;
  for (;;) {
    const page = await h["sync.snapshot.page"](ctx(BO), { entity: "contact", ...(boAfter !== undefined ? { after: boAfter } : {}), asOf: boBegin.asOfSeq });
    for (const r of page.rows) {
      assert.equal(r.fields["region"]?.v, "eu", `row ${r.id} is not in Bo's view`);
      assert.equal(r.fields["phone"], undefined, "the hidden field is never sent");
      assert.ok(r.fields["email"]);
      got.push(r.id);
    }
    if (page.done) break;
    boAfter = page.last;
  }
  assert.equal(got.length, ROWS / 4);
  s.host.close();
});
