// @reads /modules/microsoft/handlers/workbook.ts
// Reading and writing the cells of an Excel workbook in a drive (live folders L3): a range read in place, a block written (a single start cell grows to the values' size), rows appended under the last
// used row, and the refusals for a bad range or sheet. Replayed against recorded Graph answers; no socket is opened.
import test from "node:test";
import assert from "node:assert/strict";
import manifest from "../../../manifests/microsoft.ts";
import { validate } from "../../../packages/contracts/src/jsonschema.ts";
import { registry } from "../../../generated/registry.ts";
import { fitRange, workbookAppend, workbookRange, workbookUpdate } from "../handlers/workbook.ts";
import { act, codeOf, harness, seedConsent, U } from "../fixtures/harness.ts";

const conforms = (cap: string, side: "input" | "output", value: unknown): string[] => validate((manifest.capabilities?.find((c) => c.name === cap) as NonNullable<typeof manifest.capabilities>[number])[side], value, "", registry.$defs);
const W = `${U}/drive/items/xl1/workbook/worksheets/Sheet%201`;

function ready() {
  const h = harness();
  seedConsent(h);
  return h;
}
const target = { ...act, itemId: "xl1", sheet: "Sheet 1" };

test("get_range reads the values of a range in place, with the address Excel resolved", async () => {
  const h = ready();
  h.on("GET", `${W}/range(address='A1:B2')`, { body: { address: "Sheet 1!A1:B2", values: [["Name", "Total"], ["Dana", 120.5]] } });
  const out = await workbookRange(h.ctx, { ...target, range: "a1:b2" });
  assert.deepEqual(out, { address: "Sheet 1!A1:B2", values: [["Name", "Total"], ["Dana", 120.5]] });
  assert.deepEqual(conforms("ms.workbook.get_range", "output", out), []);
  assert.equal(new URL(h.hits(`${W}/range`)[0]!.url).searchParams.get("$select"), "address,values");
});

test("update_range writes the block, and a single start cell grows to the size of the values", async () => {
  const h = ready();
  h.on("PATCH", `${W}/range(address='B2:D3')`, { body: { address: "Sheet 1!B2:D3" } });
  h.on("PATCH", `${W}/range(address='A1:B1')`, { body: { address: "Sheet 1!A1:B1" } });
  const values = [["x", 1, true], [null, "y", 2.5]];
  const out = await workbookUpdate(h.ctx, { ...target, range: "B2", values });
  assert.deepEqual(out, { address: "Sheet 1!B2:D3", updatedCells: 6 });
  assert.deepEqual(conforms("ms.workbook.update_range", "output", out), []);
  assert.deepEqual(h.hits(`${W}/range(address='B2:D3')`, "PATCH")[0]!.body, { values });
  await workbookUpdate(h.ctx, { ...target, range: "A1:B1", values: [["a", "b"]] });
  assert.equal(h.hits(`${W}/range(address='A1:B1')`, "PATCH").length, 1, "a block that names its size is kept as it is");
});

test("fitRange grows a start cell, keeps a named block, and counts columns past Z", () => {
  const ctx = ready().ctx;
  assert.equal(fitRange(ctx, "B2", [["a", "b"], ["c", "d"], ["e", "f"]]), "B2:C4");
  assert.equal(fitRange(ctx, "Z1", [["a", "b", "c"]]), "Z1:AB1");
  assert.equal(fitRange(ctx, "a1:c9", [["x"]]), "A1:C9");
  assert.equal(fitRange(ctx, "AA10", [["x"]]), "AA10:AA10");
});

test("append_rows writes under the last used row, in the first used column, or at row 1 of an empty sheet", async () => {
  const h = ready();
  h.on("GET", `${W}/usedRange(valuesOnly=true)`, { body: { address: "Sheet 1!B1:D20", rowCount: 20, columnCount: 3, values: [["x"]] } });
  h.on("PATCH", `${W}/range(address='B21:C22')`, { body: { address: "Sheet 1!B21:C22" } });
  const out = await workbookAppend(h.ctx, { ...target, values: [["a", "b"], ["c", "d"]] });
  assert.deepEqual(out, { address: "Sheet 1!B21:C22", updatedRows: 2 });
  assert.deepEqual(conforms("ms.workbook.append_rows", "output", out), []);
  assert.deepEqual(h.hits(`${W}/range(address='B21:C22')`, "PATCH")[0]!.body, { values: [["a", "b"], ["c", "d"]] });

  const blank = ready();
  blank.on("GET", `${W}/usedRange(valuesOnly=true)`, { body: { address: "Sheet 1!A1", rowCount: 1, columnCount: 1, values: [[""]] } });
  blank.on("PATCH", `${W}/range(address='A1:A1')`, { body: { address: "Sheet 1!A1" } });
  assert.equal((await workbookAppend(blank.ctx, { ...target, values: [["first"]] })).updatedRows, 1);
  assert.equal(blank.hits(`${W}/range(address='A1:A1')`, "PATCH").length, 1, "an empty sheet starts at row 1");

  const one = ready();
  one.on("GET", `${W}/usedRange(valuesOnly=true)`, { body: { address: "Sheet 1!A1", rowCount: 1, columnCount: 1, values: [["Header"]] } });
  one.on("PATCH", `${W}/range(address='A2:A2')`, { body: {} });
  await workbookAppend(one.ctx, { ...target, values: [["row"]] });
  assert.equal(one.hits(`${W}/range(address='A2:A2')`, "PATCH").length, 1, "a sheet with one cell of text goes under it");
});

test("a bad range, a ragged block, an empty block and a sheet name that is a path are refused before Graph is asked", async () => {
  const h = ready();
  const bad = async (p: Promise<unknown>): Promise<string> => { try { await p; } catch (e) { return codeOf(e); } return "none"; };
  assert.equal(await bad(workbookRange(h.ctx, { ...target, range: "A1:B2')" })), "validation.bad_input");
  assert.equal(await bad(workbookRange(h.ctx, { ...target, range: "Sheet1!A1" })), "validation.bad_input");
  assert.equal(await bad(workbookRange(h.ctx, { ...target, sheet: "../x", range: "A1" })), "validation.bad_input");
  assert.equal(await bad(workbookUpdate(h.ctx, { ...target, range: "A1", values: [["a", "b"], ["c"]] })), "validation.bad_input");
  assert.equal(await bad(workbookUpdate(h.ctx, { ...target, range: "A1", values: [] })), "validation.bad_input");
  assert.equal(await bad(workbookAppend(h.ctx, { ...target, values: [[]] })), "validation.bad_input");
  assert.equal(h.requests.length, 0);
});

test("Graph's refusals map as every drive call's do: a missing workbook, a member without access", async () => {
  const h = ready();
  h.on("GET", `${W}/range(address='A1')`, { status: 404, body: { error: { code: "itemNotFound" } } });
  assert.equal(await (async () => { try { await workbookRange(h.ctx, { ...target, range: "A1" }); } catch (e) { return codeOf(e); } return "none"; })(), "validation.not_found");
  h.on("GET", `${W}/range(address='A1')`, { status: 403, body: { error: { code: "accessDenied" } } });
  assert.notEqual(await (async () => { try { await workbookRange(h.ctx, { ...target, range: "A1" }); } catch (e) { return codeOf(e); } return "none"; })(), "none");
});

test("the workbook capabilities are in the manifest on the files tools, writes behind the Gate act post", () => {
  const caps = (manifest.capabilities ?? []).filter((c) => c.name.startsWith("ms.workbook."));
  assert.deepEqual(caps.map((c) => c.name).sort(), ["ms.workbook.append_rows", "ms.workbook.get_range", "ms.workbook.update_range"]);
  for (const c of caps) {
    assert.equal(c.surfaces.mcp?.toolset, "files");
    assert.ok(c.summary.length <= 300);
    if (c.effects === "outward") assert.equal(c.gate?.act, "post");
  }
});
