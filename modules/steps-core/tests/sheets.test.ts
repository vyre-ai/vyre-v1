// Spreadsheet steps (spec 2.16, 2.12): row-level writes that never overwrite. Two Runs on one sheet keep each other's rows; an update changes only the cells it names; every write is a
// version labelled with the Automation and the Run; no step replaces a file or a sheet.
import test from "node:test";
import assert from "node:assert/strict";
import { harness, codeOf } from "../fixtures/db.ts";
import type { Harness } from "../fixtures/db.ts";
import { callOf, node } from "../fixtures/seed.ts";
import { runStep } from "../handlers/control.ts";

type Row = { rowId: string; values: Record<string, unknown> };
interface Ver { id: string; op: string; label?: string; rowId?: string }

/** A stand-in for the files module's sheets.*: rows, and a version for every write with the label it was given. */
function sheetsWorld() {
  const rows: Row[] = [];
  const versions: Ver[] = [];
  let n = 0;
  const ver = (op: string, label: string | undefined, rowId?: string): string => { const id = `ver_${++n}`; versions.push({ id, op, ...(label ? { label } : {}), ...(rowId ? { rowId } : {}) }); return id; };
  const calls: Record<string, (i: any) => unknown> = {   // eslint-disable-line @typescript-eslint/no-explicit-any
    "sheets.create": () => ({ file: { id: "fil_new1" } }),
    "sheets.append_rows": (i) => {
      const ids = (i.rows as Record<string, unknown>[]).map((v) => { const rowId = `r_${rows.length + 1}`; rows.push({ rowId, values: { ...v } }); return rowId; });
      return { appended: ids.length, rowIds: ids, versionId: ver("append", i.label) };
    },
    "sheets.update_row": (i) => {
      const row = i.rowId ? rows.find((r) => r.rowId === i.rowId) : rows.find((r) => r.values[i.key.column] === i.key.value);
      if (!row) throw Object.assign(new Error("no such row"), { error: { code: "validation.precondition_failed", message: "no such row", retryable: false } });
      Object.assign(row.values, i.values);
      return { rowId: row.rowId, versionId: ver("update", i.label, row.rowId) };
    },
    "sheets.delete_row": (i) => {
      const k = rows.findIndex((r) => r.rowId === i.rowId);
      if (k >= 0) rows.splice(k, 1);
      ver("delete", i.label, i.rowId);
      return { deleted: k >= 0 };
    },
    "sheets.read_rows": (i) => {
      let all = rows.filter((r) => !i.where || Object.entries(i.where as Record<string, unknown>).every(([c, v]) => r.values[c] === v));
      if (i.columns) all = all.map((r) => ({ rowId: r.rowId, values: Object.fromEntries((i.columns as string[]).map((c) => [c, r.values[c]])) }));
      const start = i.cursor ? Number(i.cursor) : 0;
      const out: { rows: Row[]; next?: string; total: number } = { rows: all.slice(start, start + (i.limit ?? 50)), total: all.length };
      if (start + out.rows.length < all.length) out.next = String(start + out.rows.length);
      return out;
    },
  };
  return { rows, versions, calls };
}
const env = (w: ReturnType<typeof sheetsWorld>, run = { id: "run_a", label: "Welcome email" }): Harness => harness(w.calls, { run });
const FILE = "fil_leads1";
const refused = (p: Promise<unknown>, code: string): Promise<void> => assert.rejects(p, (e) => { assert.equal(codeOf(e), code); return true; });

test("two Runs adding rows to one sheet keep each other's rows, each write labelled with its Automation and Run", async () => {
  const w = sheetsWorld();
  const a = env(w, { id: "run_a", label: "Welcome email" });
  const b = env(w, { id: "run_b", label: "Nightly sync" });
  const [ra, rb] = await Promise.all([
    runStep(a.env, node("s", "sheet.add_rows", { fileId: FILE, rows: [{ name: "Ann" }, { name: "Ben" }] }), callOf({ key: "run_a:s:1" })),
    runStep(b.env, node("s", "sheet.add_rows", { fileId: FILE, rows: [{ name: "Cy" }] }), callOf({ key: "run_b:s:1" })),
  ]);
  assert.deepEqual((ra.output as { appended: number }).appended, 2);
  assert.deepEqual((rb.output as { appended: number }).appended, 1);
  assert.deepEqual(w.rows.map((r) => r.values.name).sort(), ["Ann", "Ben", "Cy"]);
  assert.deepEqual(w.versions.map((v) => v.label).sort(), ["Nightly sync (run run_b)", "Welcome email (run run_a)"]);
  assert.equal(a.only("sheets.append_rows")[0]!.input.idempotencyKey, "run_a:s:1");
  assert.deepEqual((ra.output as { rowIds: string[] }).rowIds.length, 2);
});

test("an update changes only the cells it names, in only the row it names", async () => {
  const w = sheetsWorld();
  const h = env(w);
  await runStep(h.env, node("s", "sheet.add_rows", { fileId: FILE, rows: [{ name: "Ann", email: "a@x.com", status: "new", note: "call back" }, { name: "Ben", email: "b@x.com", status: "new" }] }), callOf());
  const byKey = await runStep(h.env, node("u", "sheet.update_rows", { fileId: FILE, key: { column: "email", value: "a@x.com" }, values: { status: "won" } }), callOf());
  assert.deepEqual(w.rows[0]!.values, { name: "Ann", email: "a@x.com", status: "won", note: "call back" });
  assert.deepEqual(w.rows[1]!.values, { name: "Ben", email: "b@x.com", status: "new" });
  assert.deepEqual(byKey.output, { rowId: "r_1", versionId: "ver_2" });
  assert.deepEqual(h.only("sheets.update_row")[0]!.input, { fileId: FILE, key: { column: "email", value: "a@x.com" }, values: { status: "won" }, label: "Welcome email (run run_a)" });
  await runStep(h.env, node("u", "sheet.update_rows", { fileId: FILE, sheet: "Leads", rowId: "r_2", values: { note: "left voicemail" } }), callOf());
  assert.deepEqual(w.rows[1]!.values, { name: "Ben", email: "b@x.com", status: "new", note: "left voicemail" });
  assert.equal(h.only("sheets.update_row")[1]!.input.sheet, "Leads");
  assert.equal("key" in h.only("sheets.update_row")[1]!.input, false);
});

test("an update must say which row, and what to change", async () => {
  const w = sheetsWorld();
  const h = env(w);
  await refused(runStep(h.env, node("u", "sheet.update_rows", { fileId: FILE, values: { a: 1 } }), callOf()), "validation.precondition_failed");
  await refused(runStep(h.env, node("u", "sheet.update_rows", { fileId: FILE, rowId: "r_1", key: { column: "email", value: "x" }, values: { a: 1 } }), callOf()), "validation.precondition_failed");
  await refused(runStep(h.env, node("u", "sheet.update_rows", { fileId: FILE, rowId: "r_1", values: {} }), callOf()), "validation.bad_input");
  await refused(runStep(h.env, node("u", "sheet.update_rows", { fileId: FILE, rowId: "r_1", values: "status=won" }), callOf()), "validation.bad_input");
  assert.equal(h.log.length, 0, "nothing reached the files module");
});

test("adding rows needs rows", async () => {
  const h = env(sheetsWorld());
  await refused(runStep(h.env, node("a", "sheet.add_rows", { fileId: FILE, rows: [] }), callOf()), "validation.bad_input");
  await refused(runStep(h.env, node("a", "sheet.add_rows", { fileId: FILE, rows: ["Ann"] }), callOf()), "validation.bad_input");
  assert.equal(h.log.length, 0);
});

test("delete removes one row by id, labelled; the others stay", async () => {
  const w = sheetsWorld();
  const h = env(w);
  await runStep(h.env, node("s", "sheet.add_rows", { fileId: FILE, rows: [{ n: 1 }, { n: 2 }] }), callOf());
  const r = await runStep(h.env, node("d", "sheet.delete_rows", { fileId: FILE, rowId: "r_1" }), callOf());
  assert.deepEqual(r.output, { deleted: true });
  assert.deepEqual(w.rows.map((x) => x.rowId), ["r_2"]);
  assert.equal(w.versions.at(-1)!.label, "Welcome email (run run_a)");
  assert.deepEqual((await runStep(h.env, node("d", "sheet.delete_rows", { fileId: FILE, rowId: "r_9" }), callOf())).output, { deleted: false });
  await refused(runStep(h.env, node("d", "sheet.delete_rows", { fileId: FILE }), callOf()), "validation.bad_input");
});

test("find rows reads every page with the filter and the columns; read all reads the whole sheet", async () => {
  const w = sheetsWorld();
  const h = env(w);
  const many = Array.from({ length: 1203 }, (_v, i) => ({ name: `P${i}`, kind: i % 3 === 0 ? "vip" : "std", extra: i }));
  await runStep(h.env, node("s", "sheet.add_rows", { fileId: FILE, rows: many }), callOf());
  const all = await runStep(h.env, node("r", "sheet.read_all", { fileId: FILE }), callOf());
  assert.equal((all.output as { rows: unknown[] }).rows.length, 1203);
  assert.equal(h.only("sheets.read_rows").length, 3, "pages of 500");
  const vip = await runStep(h.env, node("f", "sheet.find_rows", { fileId: FILE, where: { kind: "vip" }, columns: ["name"], sheet: "Leads" }), callOf());
  const rows = (vip.output as { rows: Row[] }).rows;
  assert.equal(rows.length, 401);
  assert.deepEqual(Object.keys(rows[0]!.values), ["name"]);
  const last = h.only("sheets.read_rows").at(-1)!.input;
  assert.deepEqual([last.fileId, last.sheet, last.where, last.columns, last.limit], [FILE, "Leads", { kind: "vip" }, ["name"], 500]);
});

test("a sheet too long to read whole is an error, not half a table", async () => {
  const w = sheetsWorld();
  const h = env(w);
  w.rows.push(...Array.from({ length: 10_050 }, (_v, i) => ({ rowId: `r_${i}`, values: { i } })));
  await refused(runStep(h.env, node("r", "sheet.read_all", { fileId: FILE }), callOf()), "validation.too_large");
});

test("create makes a file from the columns and passes the step's key", async () => {
  const h = env(sheetsWorld());
  const r = await runStep(h.env, node("c", "sheet.create", { folderId: "fld_a1", name: "Leads", format: "csv", columns: ["name", "email"] }), callOf({ key: "run_a:c:1" }));
  assert.deepEqual(r.output, { fileId: "fil_new1" });
  assert.deepEqual(h.only("sheets.create")[0]!.input, { folderId: "fld_a1", name: "Leads", format: "csv", columns: ["name", "email"], idempotencyKey: "run_a:c:1" });
});

test("no spreadsheet step ever replaces a file or a sheet: only row-level and create capabilities are called", async () => {
  const w = sheetsWorld();
  const h = env(w);
  const steps = [
    node("1", "sheet.create", { folderId: "fld_a1", name: "T", format: "xlsx", columns: ["a"] }),
    node("2", "sheet.add_rows", { fileId: FILE, rows: [{ a: 1 }] }),
    node("3", "sheet.update_rows", { fileId: FILE, rowId: "r_1", values: { a: 2 } }),
    node("4", "sheet.find_rows", { fileId: FILE }),
    node("5", "sheet.read_all", { fileId: FILE }),
    node("6", "sheet.delete_rows", { fileId: FILE, rowId: "r_1" }),
  ];
  for (const s of steps) await runStep(h.env, s, callOf());
  assert.deepEqual([...new Set(h.log.map((c) => c.cap))].sort(), ["sheets.append_rows", "sheets.create", "sheets.delete_row", "sheets.read_rows", "sheets.update_row"]);
  assert.ok(w.versions.every((v) => v.op === "append" || v.op === "update" || v.op === "delete"));
});

test("a delete the Gate holds parks the Run on the approval task and runs again, unchanged, once it is decided", async () => {
  const w = sheetsWorld();
  const h = env(w);
  await runStep(h.env, node("s", "sheet.add_rows", { fileId: FILE, rows: [{ n: 1 }] }), callOf());
  let held = true;
  const real = w.calls["sheets.delete_row"]!;
  h.callee("sheets.delete_row", (i) => { if (held) throw Object.assign(new Error("held"), { error: { code: "permission.needs_approval", message: "held", retryable: false, details: { taskId: "tsk_gate7" } } }); return real(i); });
  const parked = await runStep(h.env, node("d", "sheet.delete_rows", { fileId: FILE, rowId: "r_1" }), callOf());
  assert.deepEqual(parked.wait, { reason: "approval", taskId: "tsk_gate7", on: "approval to send", cancelOn: ["task.withdrawn"] });
  assert.equal(w.rows.length, 1);
  held = false;
  assert.deepEqual((await runStep(h.env, node("d", "sheet.delete_rows", { fileId: FILE, rowId: "r_1" }), callOf({ resumed: true }))).output, { deleted: true });
});
