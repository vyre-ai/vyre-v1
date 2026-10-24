// @reads /modules/records/migrations/0001_init.sql
// @reads /modules/records/migrations/0002_query.sql
// records.merge (survivor, per-field picks, relation rewrite, history, undo), records.bulk_upsert (quiet, idempotent) and records.export (CSV, XLSX).
import test from "node:test";
import assert from "node:assert/strict";
import { mintUuid } from "../../../lib/ids.ts";
import { formatHlc } from "../../../lib/hlc.ts";
import { openRecords } from "../impl.ts";
import { UNDO_WINDOW_MS, createMergeHandlers, findMerge, undoMerge } from "../handlers/merge.ts";
import type { MergeDeps } from "../handlers/merge.ts";
import { LEDGER } from "../fixtures/seed.ts";

const SPACE = "spc_aaaaaaaaaaaa";
const NOW = 1_800_000_000_000;
const vcode = (c: string) => (e: unknown) => {
  assert.equal((e as { error?: { code?: string } }).error?.code, c);
  return true;
};
const hlc = (ms: number, deviceId: string) => formatHlc({ ms, counter: 0, deviceId });
const seal = (r: string) => ({ sealed: "ssn", ref: r, present: true, valid_format: true, set_at: 1 });
const link = (id: string) => ({ urn: `vyre://${SPACE}/party/${id}` });

const PARTY = Object.freeze({
  name: "party",
  label: "Party",
  fields: [
    { name: "name", kind: "text", label: "Name" },
    { name: "email", kind: "text", label: "Email" },
    { name: "phone", kind: "text", label: "Phone" },
    { name: "city", kind: "text", label: "City" },
    { name: "code", kind: "text", label: "Code", write_once: true },
    { name: "ssn", kind: "sealed", label: "SSN" },
  ],
});
const DEAL = Object.freeze({
  name: "deal",
  label: "Deal",
  fields: [
    { name: "title", kind: "text", label: "Title" },
    { name: "owner", kind: "link", label: "Owner", to: "party" },
    { name: "partners", kind: "link", label: "Partners", to: "party", many: true },
  ],
});
const SYNCED = Object.freeze({ name: "crm_contact", label: "CRM contact", sync: { connector: "hubspot" }, fields: [{ name: "name", kind: "text", label: "Name" }] });
const SHEET = Object.freeze({
  name: "sheet",
  label: "Price list",
  fields: [
    { name: "name", kind: "text", label: "Name" },
    { name: "note", kind: "text", label: "Note" },
    { name: "qty", kind: "number", label: "Qty" },
    { name: "fee", kind: "money", label: "Fee" },
    { name: "ssn", kind: "sealed", label: "SSN" },
  ],
});

interface Seen { name: string; subject: string; payload: Record<string, unknown> }
interface Kit {
  rec: ReturnType<typeof openRecords>;
  deps: MergeDeps;
  h: ReturnType<typeof createMergeHandlers>;
  ctx: { trace: { traceId: string }; emit: (n: string, s: string, p: Record<string, unknown>) => void; actor: string };
  seen: Seen[];
  files: { name: string; mime: string; bytes: Uint8Array }[];
}

async function kit(types: readonly unknown[] = [PARTY, DEAL]): Promise<Kit> {
  const rec = openRecords({ space: SPACE, path: ":memory:" });
  await rec.store.define({ add_types: types as never });
  const files: Kit["files"] = [];
  const deps: MergeDeps = {
    store: rec.store, tx: rec.host.tx, now: () => NOW,
    putFile: async (f) => { files.push(f); return `file_${files.length}`; },
  };
  const seen: Seen[] = [];
  const ctx = { trace: { traceId: "0123456789abcdef0123456789abcdef" }, emit: (name: string, subject: string, payload: Record<string, unknown>) => { seen.push({ name, subject, payload }); }, actor: "usr_dana" };
  return { rec, deps, h: createMergeHandlers(deps), ctx: ctx as Kit["ctx"], seen, files };
}

async function party(k: Kit, data: Record<string, unknown>): Promise<string> {
  const id = mintUuid();
  await k.rec.store.create("party", id, data);
  return id;
}

test("merge: picks per field, fills empty fields, rewrites relations, trashes the merged, keeps all history", async () => {
  const k = await kit();
  const a = await party(k, { name: "Ann", email: "ann@x.com" });
  const b = await party(k, { name: "Ann B", email: "ann2@x.com", phone: "555", city: "Oslo" });
  const c = await party(k, { name: "A. Bee", city: "Rome" });
  // b has its own history: a newer city, and an older write that lost.
  await k.rec.mergeFields("party", b, { city: { value: "Bergen", hlc: hlc(2_000, "dev_a"), baseSeq: 1 } }, "usr_x");
  await k.rec.mergeFields("party", b, { city: { value: "OLD", hlc: hlc(1_000, "dev_b"), baseSeq: 1 } }, "usr_y");

  const d1 = mintUuid(), d2 = mintUuid(), d3 = mintUuid();
  await k.rec.store.create("deal", d1, { title: "d1", owner: link(b), partners: [link(a), link(b), link(c)] });
  await k.rec.store.create("deal", d2, { title: "d2", owner: link(a) });
  await k.rec.store.create("deal", d3, { title: "d3", owner: link(c) });

  const out = await k.h["records.merge"](k.ctx, { type: "party", survivorId: a, mergedIds: [b, c], picks: { name: b, email: a } });
  assert.equal(out.undoUntil, NOW + UNDO_WINDOW_MS);
  assert.equal(out.record.id, a);
  assert.equal(out.record.fields.name, "Ann B", "picked from b");
  assert.equal(out.record.fields.email, "ann@x.com", "picked from the survivor");
  assert.equal(out.record.fields.phone, "555", "empty on the survivor, filled from the first merged record that has it");
  assert.equal(out.record.fields.city, "Bergen");

  assert.equal(await k.rec.store.get("party", b), null, "merged records are in Trash");
  assert.equal(await k.rec.store.get("party", c), null);
  assert.ok(await k.rec.store.get("party", b, { include_deleted: true }), "and stay restorable");

  assert.deepEqual((await k.rec.store.get("deal", d1))?.data.owner, link(a));
  assert.deepEqual((await k.rec.store.get("deal", d1))?.data.partners, [link(a)], "b and c collapse into the survivor, no duplicate");
  assert.deepEqual((await k.rec.store.get("deal", d2))?.data.owner, link(a), "already on the survivor: untouched");
  assert.deepEqual((await k.rec.store.get("deal", d3))?.data.owner, link(a));

  const merged = k.seen.filter((e) => e.name === "record.merged");
  assert.deepEqual(merged.map((e) => e.payload.mergedId).sort(), [b, c].sort());
  assert.ok(merged.every((e) => e.payload.survivorId === a && e.payload.type === "party" && e.subject === `record/${a}`));

  const hist = k.rec.history("party", a);
  const has = (field: string, value: unknown, part: string) => hist.some((r) => r.field === field && JSON.stringify(r.value) === JSON.stringify(value) && r.reason.includes(part));
  assert.ok(has("name", "Ann", "survivor_replaced"), "the survivor's replaced value is kept");
  assert.ok(has("email", "ann2@x.com", `lost_from:${b}`), "a merged value that did not survive is kept");
  assert.ok(has("name", "A. Bee", `lost_from:${c}`));
  assert.ok(has("city", "Rome", `lost_from:${c}`));
  assert.ok(has("city", "OLD", `history_of:${b}:lww_loser`), "the merged record's own history comes along");
  assert.ok(hist.every((r) => r.reason.startsWith("merge:")));
  assert.equal(findMerge(k.deps, { survivorId: a })?.undoUntil, NOW + UNDO_WINDOW_MS);
});

test("merge: undo within 30 days restores records, relations, survivor fields and history", async () => {
  const k = await kit();
  const a = await party(k, { name: "Ann" });
  const b = await party(k, { name: "Ann B", phone: "555", city: "Oslo" });
  const d1 = mintUuid();
  const original = [link(a), link(b)];
  await k.rec.store.create("deal", d1, { title: "d1", owner: link(b), partners: original });
  await k.h["records.merge"](k.ctx, { type: "party", survivorId: a, mergedIds: [b], picks: { name: b } });
  assert.equal((await k.rec.store.get("party", a))?.data.name, "Ann B");

  const res = await undoMerge(k.deps, k.ctx, { survivorId: a });
  assert.deepEqual(res, { restored: [b], unrestored: [] });
  const survivor = await k.rec.store.get("party", a);
  assert.equal(survivor?.data.name, "Ann");
  assert.equal(survivor?.data.phone ?? null, null);
  assert.equal(survivor?.data.city ?? null, null);
  assert.equal((await k.rec.store.get("party", b))?.data.name, "Ann B", "back from Trash");
  assert.deepEqual((await k.rec.store.get("deal", d1))?.data.owner, link(b));
  assert.deepEqual((await k.rec.store.get("deal", d1))?.data.partners, original);
  assert.deepEqual(k.rec.history("party", a), [], "the merge's history rows go with it");
  assert.equal(findMerge(k.deps, { survivorId: a }), null, "nothing left to undo");
  await assert.rejects(undoMerge(k.deps, k.ctx, { survivorId: a }), (e: unknown) => (e as { code?: string }).code === "not_found");
});

test("merge: a relation changed after the merge is left alone by undo", async () => {
  const k = await kit();
  const a = await party(k, { name: "Ann" });
  const b = await party(k, { name: "Bee" });
  const o = await party(k, { name: "Other" });
  const d1 = mintUuid();
  await k.rec.store.create("deal", d1, { title: "d1", owner: link(b) });
  await k.h["records.merge"](k.ctx, { type: "party", survivorId: a, mergedIds: [b], picks: {} });
  const cur = await k.rec.store.get("deal", d1);
  await k.rec.store.update("deal", d1, { owner: link(o) }, cur!.version);
  await undoMerge(k.deps, k.ctx, { survivorId: a });
  assert.deepEqual((await k.rec.store.get("deal", d1))?.data.owner, link(o), "the newer value wins");
});

test("merge: the undo window closes after 30 days", async () => {
  const k = await kit();
  const a = await party(k, { name: "Ann" });
  const b = await party(k, { name: "Bee" });
  await k.h["records.merge"](k.ctx, { type: "party", survivorId: a, mergedIds: [b], picks: {} });
  const late: MergeDeps = { ...k.deps, now: () => NOW + UNDO_WINDOW_MS + 1 };
  await assert.rejects(undoMerge(late, k.ctx, { survivorId: a }), vcode("validation.bad_input"));
  assert.equal(await k.rec.store.get("party", b), null, "still merged");
});

test("merge: refusals change nothing", async () => {
  const k = await kit([PARTY, DEAL, SYNCED, LEDGER]);
  const a = await party(k, { name: "Ann", code: "S" });
  const b = await party(k, { name: "Bee", code: "M" });
  const d1 = mintUuid();
  await k.rec.store.create("deal", d1, { title: "d1", owner: link(b) });
  const m = (input: { survivorId?: string; mergedIds?: string[]; picks?: Record<string, string>; type?: string }) =>
    k.h["records.merge"](k.ctx, { type: input.type ?? "party", survivorId: input.survivorId ?? a, mergedIds: input.mergedIds ?? [b], picks: input.picks ?? {} });

  await assert.rejects(m({ mergedIds: [] }), vcode("validation.bad_input"));
  await assert.rejects(m({ mergedIds: [a] }), vcode("validation.bad_input"), "the survivor cannot be merged into itself");
  await assert.rejects(m({ picks: { name: mintUuid() } }), vcode("validation.bad_input"), "a pick must name the survivor or a merged record");
  await assert.rejects(m({ picks: { nope: a } }), vcode("validation.bad_input"), "a pick must name a field");
  await assert.rejects(m({ mergedIds: [mintUuid()] }), vcode("validation.not_found"));
  await assert.rejects(m({ survivorId: mintUuid() }), vcode("validation.not_found"));
  await assert.rejects(m({ picks: { code: b } }), vcode("validation.field_locked"), "write-once on the survivor");

  const x = mintUuid(), y = mintUuid();
  await k.rec.store.create("crm_contact", x, { name: "X" });
  await k.rec.store.create("crm_contact", y, { name: "Y" });
  await assert.rejects(m({ type: "crm_contact", survivorId: x, mergedIds: [y] }), vcode("validation.bad_input"), "synced records are linked, not merged");

  const l1 = mintUuid(), l2 = mintUuid();
  await k.rec.store.create("ledger", l1, { name: "L1" });
  await k.rec.store.create("ledger", l2, { name: "L2" });
  await assert.rejects(m({ type: "ledger", survivorId: l1, mergedIds: [l2] }), vcode("validation.field_locked"), "protected types cannot lose rows");

  k.rec.host.tx.run("INSERT INTO records_row_meta (type, id, holds) VALUES (?, ?, 1) ON CONFLICT(type, id) DO UPDATE SET holds = 1", "party", b);
  await assert.rejects(m({}), vcode("permission.on_hold"));

  assert.equal((await k.rec.store.get("party", a))?.data.code, "S");
  assert.equal((await k.rec.store.get("party", b))?.data.name, "Bee");
  assert.deepEqual((await k.rec.store.get("deal", d1))?.data.owner, link(b));
  assert.equal(k.seen.length, 0, "no event for a refused merge");
  assert.equal(findMerge(k.deps, { survivorId: a }), null);
});

test("merge: a sealed pick moves the handle and history keeps only a mask", async () => {
  const k = await kit();
  const a = await party(k, { name: "Ann", ssn: seal("sv_aaa") });
  const b = await party(k, { name: "Bee", ssn: seal("sv_bbb") });
  const out = await k.h["records.merge"](k.ctx, { type: "party", survivorId: a, mergedIds: [b], picks: { ssn: b } });
  assert.equal((out.record.fields.ssn as { ref: string }).ref, "sv_bbb");
  const text = JSON.stringify(k.rec.history("party", a));
  assert.ok(!text.includes("sv_aaa") && !text.includes("sv_bbb"), "no handle in history");
  assert.ok(k.rec.history("party", a).some((r) => r.field === "ssn" && JSON.stringify(r.value) === JSON.stringify({ sealed: "ssn", masked: true })));
});

test("bulk_upsert: creates and updates by match key, folds repeats, stays quiet, and a rerun changes nothing", async () => {
  const k = await kit();
  const up = (rows: Record<string, unknown>[], extra: { match?: string[]; runAutomations?: boolean } = {}) =>
    k.h["records.bulk_upsert"](k.ctx, { type: "party", rows, match: extra.match ?? ["email"], ...(extra.runAutomations !== undefined ? { runAutomations: extra.runAutomations } : {}) });
  const count = async () => (await k.rec.store.query("party", { page: { limit: 100 } })).rows.length;
  const rows = [{ email: "a@x.com", name: "A" }, { email: "b@x.com", name: "B" }, { email: "a@x.com", city: "Oslo" }];

  assert.deepEqual(await up(rows), { created: 2, updated: 0, skipped: 1 });
  assert.equal(await count(), 2);
  const a = (await k.rec.store.query("party", { filter: { field: "email", op: "eq", value: "a@x.com" }, page: { limit: 5 } })).rows[0];
  assert.equal(a?.data.name, "A");
  assert.equal(a?.data.city, "Oslo", "the repeat row folded into the first");
  const created = k.seen.filter((e) => e.name === "record.created");
  assert.equal(created.length, 2);
  assert.ok(created.every((e) => e.payload.quiet === true), "imports fire no automations by default");

  k.seen.length = 0;
  assert.deepEqual(await up(rows), { created: 0, updated: 0, skipped: 3 }, "idempotent");
  assert.equal(await count(), 2);
  assert.equal(k.seen.length, 0);

  assert.deepEqual(await up([{ email: "a@x.com", name: "A2" }]), { created: 0, updated: 1, skipped: 0 });
  const upd = k.seen.filter((e) => e.name === "record.updated");
  assert.equal(upd.length, 1);
  assert.deepEqual(upd[0]?.payload.fields, { name: "A2" });
  assert.deepEqual(upd[0]?.payload.prev, { name: "A" });
  assert.equal(upd[0]?.payload.quiet, true);

  k.seen.length = 0;
  assert.deepEqual(await up([{ email: "c@x.com", name: "C" }], { runAutomations: true }), { created: 1, updated: 0, skipped: 0 });
  assert.ok(!("quiet" in (k.seen[0]?.payload ?? {})), "run automations ticked: the event is not marked quiet");

  assert.deepEqual(await up([{ email: "b@x.com", name: "B", phone: "1" }, { email: "b@x.com", name: "B2" }], { match: ["email", "name"] }), { created: 1, updated: 1, skipped: 0 }, "a composite key");
});

test("bulk_upsert: bad input is refused before the first write", async () => {
  const k = await kit();
  const up = (rows: Record<string, unknown>[], match: string[] = ["email"]) => k.h["records.bulk_upsert"](k.ctx, { type: "party", rows, match });
  const count = async () => (await k.rec.store.query("party", { page: { limit: 100 } })).rows.length;
  await assert.rejects(up([{ email: "a@x.com" }], []), vcode("validation.bad_input"));
  await assert.rejects(up([{ email: "a@x.com" }, { name: "no key" }]), vcode("validation.bad_input"));
  await assert.rejects(up([{ email: "a@x.com" }, { email: "b@x.com", nope: 1 }]), vcode("validation.bad_input"));
  await assert.rejects(up([{ ssn: seal("sv_x") }], ["ssn"]), vcode("validation.bad_input"), "a sealed field cannot be a match key");
  await assert.rejects(up([{ email: "a@x.com" }], ["nope"]), vcode("validation.bad_input"));
  await assert.rejects(up(Array.from({ length: 10_001 }, (_v, i) => ({ email: `u${i}@x.com` }))), vcode("validation.too_large"));
  assert.equal(await count(), 0);

  await party(k, { name: "One", email: "dup@x.com" });
  await party(k, { name: "Two", email: "dup@x.com" });
  await assert.rejects(up([{ email: "dup@x.com", name: "X" }]), vcode("validation.duplicate"), "two records already match: resolve them first");
});

const decode = (b: Uint8Array): string => new TextDecoder().decode(b);

test("export csv: quoted, formula-safe, sealed masked, view spec applies", async () => {
  const k = await kit([SHEET]);
  const mk = (data: Record<string, unknown>) => k.rec.store.create("sheet", mintUuid(), data);
  await mk({ name: "Smith, John", note: 'say "hi"\nline2', qty: 3, fee: { amount: 12.5, currency: "USD" }, ssn: seal("sv_secret") });
  await mk({ name: "=SUM(A1)", qty: -4 });
  await mk({ name: "Zed" });
  const exp = (input: Record<string, unknown>) => k.h["records.export"](k.ctx, { type: "sheet", format: "csv", ...input } as never);

  const res = await exp({ fields: ["name", "qty", "fee", "ssn"], sort: [{ field: "name", dir: "asc" }] });
  assert.equal(res.fileId, "file_1");
  const f = k.files[0]!;
  assert.equal(f.name, "sheet-2027-01-15.csv");
  assert.equal(f.mime, "text/csv; charset=utf-8");
  assert.equal(decode(f.bytes), "﻿name,qty,fee,ssn\r\n'=SUM(A1),-4,,\r\n\"Smith, John\",3,12.5 USD,[sealed]\r\nZed,,,\r\n");

  await exp({ sort: [{ field: "name", dir: "asc" }] });
  const all = decode(k.files[1]!.bytes);
  assert.ok(all.startsWith("﻿Name,Note,Qty,Fee,SSN\r\n"), "headers are the field labels");
  assert.ok(all.includes('"say ""hi""\nline2"'));
  assert.ok(!all.includes("sv_secret"), "a sealed handle never leaves");

  await exp({ filter: { field: "qty", op: "gt", value: 0 }, fields: ["name"] });
  assert.equal(decode(k.files[2]!.bytes), '﻿Name\r\n"Smith, John"\r\n');
  await exp({ limit: 2, fields: ["name"], sort: [{ field: "name", dir: "asc" }] });
  assert.equal(decode(k.files[3]!.bytes).split("\r\n").length, 4, "header, two rows, trailing break");
  await exp({ filter: { field: "qty", op: "gt", value: 1000 }, fields: ["name"] });
  assert.equal(decode(k.files[4]!.bytes), "﻿Name\r\n");

  await assert.rejects(exp({ fields: ["nope"] }), vcode("validation.bad_input"));
  const bare = createMergeHandlers({ store: k.rec.store, tx: k.rec.host.tx });
  await assert.rejects(bare["records.export"](k.ctx, { type: "sheet", format: "csv" }), vcode("internal.unavailable"));
});

interface ZipEntry { name: string; data: Uint8Array; crc: number }
const crcTable = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let i = 0; i < 8; i++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
const crc = (b: Uint8Array): number => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 0xff]! ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };

function unzip(bytes: Uint8Array): ZipEntry[] {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const end = bytes.length - 22;
  assert.equal(v.getUint32(end, true), 0x06054b50, "end of central directory");
  const n = v.getUint16(end + 10, true);
  let p = v.getUint32(end + 16, true);
  const out: ZipEntry[] = [];
  for (let i = 0; i < n; i++) {
    assert.equal(v.getUint32(p, true), 0x02014b50);
    const size = v.getUint32(p + 24, true);
    const nameLen = v.getUint16(p + 28, true);
    const sum = v.getUint32(p + 16, true);
    const local = v.getUint32(p + 42, true);
    const name = decode(bytes.subarray(p + 46, p + 46 + nameLen));
    assert.equal(v.getUint32(local, true), 0x04034b50, "local header");
    const lname = v.getUint16(local + 26, true);
    const start = local + 30 + lname;
    out.push({ name, data: bytes.subarray(start, start + size), crc: sum });
    p += 46 + nameLen;
  }
  return out;
}

test("export xlsx: a valid package with escaped inline strings, numbers as numbers, sealed masked", async () => {
  const k = await kit([SHEET]);
  await k.rec.store.create("sheet", mintUuid(), { name: "A & B <x>", qty: 3, fee: { amount: 2, currency: "EUR" }, ssn: seal("sv_secret") });
  await k.rec.store.create("sheet", mintUuid(), { name: "Zed", note: "second" });
  await k.h["records.export"](k.ctx, { type: "sheet", format: "xlsx", sort: [{ field: "name", dir: "asc" }] });
  const f = k.files[0]!;
  assert.equal(f.name, "sheet-2027-01-15.xlsx");
  assert.equal(f.mime, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  const entries = unzip(f.bytes);
  assert.deepEqual(entries.map((e) => e.name), ["[Content_Types].xml", "_rels/.rels", "xl/workbook.xml", "xl/_rels/workbook.xml.rels", "xl/worksheets/sheet1.xml"]);
  for (const e of entries) assert.equal(crc(e.data), e.crc, `crc of ${e.name}`);
  const book = decode(entries[2]!.data);
  assert.ok(book.includes('<sheet name="Price list" sheetId="1" r:id="rId1"/>'));
  const sheet = decode(entries[4]!.data);
  assert.ok(sheet.includes('<c r="A1" t="inlineStr"><is><t xml:space="preserve">Name</t></is></c>'));
  assert.ok(sheet.includes('<t xml:space="preserve">A &amp; B &lt;x&gt;</t>'));
  assert.ok(sheet.includes('<c r="C2"><v>3</v></c>'), "a number stays a number");
  assert.ok(sheet.includes("2 EUR"));
  assert.ok(sheet.includes("[sealed]"));
  assert.ok(!sheet.includes("sv_secret"));
  assert.ok(sheet.includes('<row r="3">') && sheet.includes('<c r="B3" t="inlineStr"><is><t xml:space="preserve">second</t></is></c>'));
});
