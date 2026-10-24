// @reads /modules/sync/migrations/0001_pull.sql
// Snapshot behaviour around the edges (ARCH 5.8): plan order, the phone window, what a snapshot tells pull, rows newer than asOf, sessions and the wire form.
import test from "node:test";
import assert from "node:assert/strict";
import { gunzipSync } from "node:zlib";
import { parsePullRes } from "../../../sync/src/protocol.ts";
import type { DeviceClass, PullRes } from "../../../sync/src/protocol.ts";
import { decodePage, encodePage } from "../../../sync/src/server/pull/index.ts";
import type { PullCtx } from "../handlers/index.ts";
import { openSync } from "../impl.ts";
import type { SyncHandle } from "../impl.ts";
import { seedContacts } from "../fixtures/seed.ts";
import { ADA, BO, NOW, buildAccess } from "../fixtures/world.ts";

const TRACE = "0123456789abcdef0123456789abcdef";
const MIN = 60_000;
const ctx = (person: string, device = "dev1", deviceClass: DeviceClass = "desktop"): PullCtx => ({ trace: { traceId: TRACE }, principal: person, deviceId: device, deviceClass });

function make(count = 3000) {
  let now = NOW;
  const access = buildAccess();
  const s = openSync({ access: () => access, clock: () => now });
  seedContacts(s.host, { count });
  return { s, tick: (ms: number) => { now += ms; } };
}
function row(s: SyncHandle, payload: Record<string, unknown>): number {
  return s.host.append({ type: "sync.row", sv: 1, trace_id: TRACE, actor: ADA, vis: "space", payload } as never).seq;
}
async function pull(s: SyncHandle, c: PullCtx, cursor: number): Promise<PullRes> {
  const res = await s.handlers["sync.pull"](c, { cursor, epoch: 0 });
  const p = parsePullRes(JSON.parse(JSON.stringify(res)));
  assert.ok(p.ok, p.ok ? "" : p.error);
  return res;
}
async function drain(s: SyncHandle, c: PullCtx, asOf: number, entity = "contact"): Promise<string[]> {
  const ids: string[] = [];
  let after: string | undefined;
  for (;;) {
    const page = await s.handlers["sync.snapshot.page"](c, { entity, ...(after !== undefined ? { after } : {}), asOf });
    ids.push(...page.rows.map((r) => r.id));
    if (page.done) return ids;
    after = page.last;
  }
}
const code = (c: string) => (e: unknown) => {
  assert.equal((e as { error?: { code?: string } }).error?.code, c);
  return true;
};

test("pages hold at most 5000 rows: 12,000 rows come as 5000, 5000, 2000", async () => {
  const { s } = make(12_000);
  const begin = await s.handlers["sync.snapshot.begin"](ctx(ADA), { deviceClass: "desktop" });
  const sizes: number[] = [];
  let after: string | undefined;
  for (;;) {
    const page = await s.handlers["sync.snapshot.page"](ctx(ADA), { entity: "contact", ...(after !== undefined ? { after } : {}), asOf: begin.asOfSeq });
    sizes.push(page.rows.length);
    if (page.done) break;
    after = page.last;
  }
  assert.deepEqual(sizes.filter((n) => n > 0), [5000, 5000, 2000]);
});

test("the plan lists small entities first and window-limited ones last, and skips empty and excluded entities", async () => {
  const { s } = make(3000);
  for (let i = 0; i < 5; i++) row(s, { entity: "role", id: `ro${i}`, op: "upsert", fields: { name: `R${i}` } });
  for (let i = 0; i < 10; i++) row(s, { entity: "calendar_event", id: `ev${i}`, op: "upsert", fields: { title: `E${i}` } });
  row(s, { entity: "grant", id: "gr1", op: "upsert", fields: { level: "view" } });
  const begin = await s.handlers["sync.snapshot.begin"](ctx(ADA), { deviceClass: "desktop" });
  assert.deepEqual(begin.plan, [{ entity: "role", estimatedRows: 5 }, { entity: "contact", estimatedRows: 3000 }, { entity: "calendar_event", estimatedRows: 10 }]);
  const only = await s.handlers["sync.snapshot.begin"](ctx(ADA), { entities: ["contact"], deviceClass: "desktop" });
  assert.deepEqual(only.plan.map((p) => p.entity), ["contact"]);
  assert.ok(begin.expiresAt > NOW);
});

test("a phone's snapshot of a window entity holds the newest 500 only", async () => {
  const { s } = make(3000);
  const c = ctx(ADA, "dev_phone", "phone");
  const begin = await s.handlers["sync.snapshot.begin"](c, { deviceClass: "phone" });
  assert.equal(begin.plan[0]!.estimatedRows, 3000);
  const ids = await drain(s, c, begin.asOfSeq);
  assert.equal(ids.length, 500);
  assert.equal(ids[0], "c000000");
  assert.equal(ids[499], "c000499");
});

test("a snapshot tells pull what the device holds: later patches and deletes reach it, and a row it was never sent arrives whole", async () => {
  const { s } = make(300);
  const begin = await s.handlers["sync.snapshot.begin"](ctx(ADA), { deviceClass: "desktop" });
  assert.equal((await drain(s, ctx(ADA), begin.asOfSeq)).length, 300);
  row(s, { entity: "contact", id: "c000007", op: "patch", fields: { stage: "won" } });
  row(s, { entity: "contact", id: "c000008", op: "delete" });
  const res = await pull(s, ctx(ADA), begin.asOfSeq);
  assert.deepEqual(res.changes.map((c) => [c.id, c.op]), [["c000007", "patch"], ["c000008", "delete"]]);
  assert.deepEqual(Object.keys(res.changes[0]!.fields), ["stage"]);

  // A device that started a snapshot but has not pulled a page holds nothing yet: the same patch is a full row for it.
  const other = await s.handlers["sync.snapshot.begin"](ctx(ADA, "dev2"), { deviceClass: "desktop" });
  const whole = await pull(s, ctx(ADA, "dev2"), other.asOfSeq - 2);
  assert.deepEqual(whole.changes.map((c) => [c.id, c.op]), [["c000007", "upsert"]]);
  assert.ok(Object.keys(whole.changes[0]!.fields).length > 3);
});

test("a hide reaches a device whose snapshot included the row", async () => {
  const { s } = make(400);
  const begin = await s.handlers["sync.snapshot.begin"](ctx(BO), { deviceClass: "desktop" });
  const held = await drain(s, ctx(BO), begin.asOfSeq);
  assert.equal(held.length, 100);
  row(s, { entity: "contact", id: "c000004", op: "patch", fields: { region: "us" } });
  row(s, { entity: "contact", id: "c000005", op: "patch", fields: { region: "eu" } });
  const res = await pull(s, ctx(BO), begin.asOfSeq);
  assert.deepEqual(res.hide.map((h) => h.id), ["c000004"], "c000004 was eu and left; c000005 was never in view");
  assert.deepEqual(res.changes.map((c) => [c.id, c.op]), [["c000005", "upsert"]]);
});

test("a row changed after asOf is left out of the pages and arrives from pull as a whole row", async () => {
  const { s } = make(100);
  const begin = await s.handlers["sync.snapshot.begin"](ctx(ADA), { deviceClass: "desktop" });
  row(s, { entity: "contact", id: "c000010", op: "patch", fields: { stage: "won" } });
  const ids = await drain(s, ctx(ADA), begin.asOfSeq);
  assert.equal(ids.length, 99);
  assert.ok(!ids.includes("c000010"));
  const res = await pull(s, ctx(ADA), begin.asOfSeq);
  assert.deepEqual(res.changes.map((c) => [c.id, c.op]), [["c000010", "upsert"]]);
  assert.equal(res.changes[0]!.fields["stage"]?.v, "won");
  assert.equal(res.changes[0]!.fields["name"]?.v, "Contact 10");
});

test("starting a snapshot again makes the device forget what it held", async () => {
  const { s } = make(50);
  const first = await s.handlers["sync.snapshot.begin"](ctx(ADA), { deviceClass: "desktop" });
  await drain(s, ctx(ADA), first.asOfSeq);
  const second = await s.handlers["sync.snapshot.begin"](ctx(ADA), { deviceClass: "desktop" });
  row(s, { entity: "contact", id: "c000003", op: "patch", fields: { stage: "won" } });
  const res = await pull(s, ctx(ADA), second.asOfSeq);
  assert.deepEqual(res.changes.map((c) => c.op), ["upsert"]);
});

test("sessions: a page needs a begin, and a snapshot older than 10 minutes must be started again", async () => {
  const { s, tick } = make(50);
  await assert.rejects(s.handlers["sync.snapshot.page"](ctx(ADA), { entity: "contact", asOf: 0 }), code("validation.not_found"));
  const begin = await s.handlers["sync.snapshot.begin"](ctx(ADA), { deviceClass: "desktop" });
  await s.handlers["sync.snapshot.page"](ctx(ADA), { entity: "contact", asOf: begin.asOfSeq });
  await assert.rejects(s.handlers["sync.snapshot.page"](ctx(ADA, "dev_other"), { entity: "contact", asOf: begin.asOfSeq }), code("validation.not_found"));
  tick(11 * MIN);
  await assert.rejects(s.handlers["sync.snapshot.page"](ctx(ADA), { entity: "contact", asOf: begin.asOfSeq }), code("timeout.deadline"));
});

test("an entity the device class does not mirror returns an empty finished page", async () => {
  const { s } = make(10);
  row(s, { entity: "file_version", id: "fv1", op: "upsert", fields: { name: "v1" } });
  const begin = await s.handlers["sync.snapshot.begin"](ctx(ADA, "dev_phone", "phone"), { deviceClass: "phone" });
  assert.ok(!begin.plan.some((p) => p.entity === "file_version"));
  const page = await s.handlers["sync.snapshot.page"](ctx(ADA, "dev_phone", "phone"), { entity: "file_version", asOf: begin.asOfSeq });
  assert.deepEqual(page, { rows: [], done: true });
});

test("the wire form is gzip NDJSON, one row per line with a closing page line, and decodes to the same page", async () => {
  const { s } = make(2000);
  const begin = await s.handlers["sync.snapshot.begin"](ctx(ADA), { deviceClass: "desktop" });
  const page = await s.handlers["sync.snapshot.page"](ctx(ADA), { entity: "contact", asOf: begin.asOfSeq });
  const bytes = encodePage(page);
  assert.equal(bytes[0], 0x1f);
  assert.equal(bytes[1], 0x8b);
  const lines = gunzipSync(bytes).toString("utf8").trim().split("\n");
  assert.equal(lines.length, 2001);
  assert.deepEqual(JSON.parse(lines[2000]!), { $page: { last: "c001999", done: true } });
  assert.equal((JSON.parse(lines[0]!) as { id: string }).id, "c000000");
  assert.deepEqual(decodePage(bytes), page);
  assert.ok(bytes.length < gunzipSync(bytes).length / 3, "the rows compress well");
});
