// The workbook half of the native viewers walk (split from files.viewers.live.test.ts so each file stays inside its 120 s cap on a busy box): a three sheet workbook is a real grid, and a 50,000 row sheet opens and scrolls.
import test from "node:test";
import assert from "node:assert/strict";
import { session } from "./viewers-harness.test.ts";

async function threeSheetBook(): Promise<Buffer> {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  const b = wb.addWorksheet("Budget");
  b.views = [{ state: "frozen", ySplit: 1 }];
  b.columns = [{ width: 22 }, { width: 14 }, { width: 10 }, { width: 14 }];
  b.addRow(["Item", "Cost", "Qty", "Total"]).font = { bold: true };
  b.addRow(["Paper", 12.5, 4, { formula: "B2*C2", result: 50 }]);
  b.addRow(["Ink", 30, 2, { formula: "B3*C3", result: 60 }]);
  b.addRow(["Sum", null, null, { formula: "SUM(D2:D3)", result: 110 }]);
  for (const a of ["B2", "B3"]) b.getCell(a).numFmt = "$#,##0.00";
  b.getCell("D2").numFmt = "#,##0.00";
  const n = wb.addWorksheet("Notes");
  n.addRow(["Remember", "the quarterly figures"]);
  const t = wb.addWorksheet("Tax");
  t.addRow(["Rate", 0.1]);
  t.getCell("B1").numFmt = "0%";
  t.addRow(["Due", { formula: "Budget!D4*B1", result: 11 }]);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

test("a three sheet workbook is a real grid: tabs, formats, a cell edit that recomputes and saves as a new version, the other sheets intact", async (t) => {
  const s = await session(t);
  if (!s) return;
  const { page } = s;
  try {
    const f = await s.make(
      "budget.xlsx",
      await threeSheetBook(),
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    const fileId = f.file.fileId as string;
    await s.open("budget.xlsx");
    await page.getByTestId("vwg").waitFor({ timeout: 40_000 });
    assert.equal(await page.getByTestId("vwg-tab-0").innerText(), "Budget");
    assert.equal(await page.getByTestId("vwg-tab-2").innerText(), "Tax");
    // formats: currency, the formula's value
    assert.equal((await page.getByTestId("vwg-cell-1-1").innerText()).trim(), "$12.50");
    assert.equal((await page.getByTestId("vwg-cell-1-3").innerText()).trim(), "50.00");
    await page.getByTestId("vwg-cell-1-3").click();
    assert.equal(await page.getByTestId("vwg-formula").inputValue(), "=B2*C2", "the formula is in the formula bar");
    await s.shot("xlsx-open");
    // view mode does not type; Edit does
    await page.getByTestId("vw-mode-edit").click();
    await page.getByTestId("vwg-cell-1-2").click();
    await page.keyboard.type("5");
    await page.getByTestId("vwg-editor").waitFor({ timeout: 5000 });
    await s.shot("xlsx-editing");
    await page.keyboard.press("Enter");
    assert.equal((await page.getByTestId("vwg-cell-1-3").innerText()).trim(), "62.50", "the formula recomputed");
    assert.equal((await page.getByTestId("vwg-cell-3-3").innerText()).trim(), "122.5");
    // the other sheet follows
    await page.getByTestId("vwg-tab-2").click();
    await page.waitForFunction(
      () => document.querySelector('[data-testid="vwg-cell-1-1"]')?.textContent?.trim() === "12.25",
      null,
      { timeout: 5000 },
    );
    // saved as a new version
    await page.waitForFunction(
      () => /v2/.test(document.querySelector('[data-testid="vw-saved"]')?.textContent ?? ""),
      null,
      { timeout: 20_000 },
    );
    const versions = (await s.call("files.versions", { fileId })).versions as { n: number }[];
    assert.ok(versions.length >= 2, "History has the new version");
    // History lists the new version
    await page.getByTestId("vw-history").click();
    await page.getByText(/v2/).first().waitFor({ timeout: 10_000 });
    await page.keyboard.press("Escape");
    // reopen: the change is there, the other sheets are intact
    await s.open("budget.xlsx");
    await page.getByTestId("vwg").waitFor({ timeout: 40_000 });
    assert.equal((await page.getByTestId("vwg-cell-1-3").innerText()).trim(), "62.50");
    await page.getByTestId("vwg-tab-1").click();
    await page.waitForFunction(
      () => document.querySelector('[data-testid="vwg-cell-0-1"]')?.textContent?.trim() === "the quarterly figures",
    );
    const bytes = Buffer.from((await s.call("files.read", { fileId, as: "base64" })).base64, "base64");
    const ExcelJS = (await import("exceljs")).default;
    const re = new ExcelJS.Workbook();
    await re.xlsx.load(bytes as never);
    assert.deepEqual(
      re.worksheets.map((w) => w.name),
      ["Budget", "Notes", "Tax"],
    );
    assert.equal(re.getWorksheet("Budget")!.getCell("B2").numFmt, "$#,##0.00");
    assert.equal(re.getWorksheet("Budget")!.getCell("D2").formula, "B2*C2");
    assert.equal(re.getWorksheet("Budget")!.getCell("C2").value, 5);
    assert.equal(re.getWorksheet("Budget")!.views[0]?.ySplit, 1, "the frozen header row is kept");
    // find across sheets steps into another tab
    await page.getByTestId("vw-find-btn").click();
    await page.getByTestId("vw-find-input").fill("quarterly");
    await page.waitForFunction(
      () => /1 of 1/.test(document.querySelector('[data-testid="vw-count"]')?.textContent ?? ""),
      null,
      { timeout: 10_000 },
    );
    await s.shot("xlsx-find");
    assert.deepEqual(s.errors, []);
  } finally {
    await s.close();
  }
});

test("a 50,000 row sheet opens and scrolls: only the rows near the screen are drawn", async (t) => {
  const s = await session(t);
  if (!s) return;
  const { page } = s;
  try {
    const ExcelJS = (await import("exceljs")).default;
    const wb = new ExcelJS.Workbook();
    const w = wb.addWorksheet("Big");
    w.addRow(["id", "name", "amount"]);
    for (let i = 1; i <= 50_000; i++) w.addRow([i, `row ${i}`, i * 1.5]);
    const bytes = Buffer.from(await wb.xlsx.writeBuffer());
    await s.make("big.xlsx", bytes, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    await page.goto(`${s.web.origin}/files`, { waitUntil: "load" });
    await page.getByTestId("shell").waitFor({ timeout: 30_000 });
    await page.getByText("Viewers", { exact: true }).first().dblclick();
    await page.getByText("big.xlsx", { exact: true }).first().waitFor({ timeout: 20_000 });
    const t0 = Date.now();
    await page.getByText("big.xlsx", { exact: true }).first().dblclick();
    await page.getByTestId("vwg").waitFor({ timeout: 60_000 });
    console.log(`SPEED xlsx-50k-open-ms=${Date.now() - t0}`);
    assert.equal(await page.getByTestId("vwg").getAttribute("data-rows"), "50001");
    const drawnRows = await page.evaluate(() => document.querySelectorAll(".vwg-row").length);
    assert.ok(drawnRows < 80, `only the rows near the screen exist (${drawnRows})`);
    await page.getByTestId("vwg-scroll").evaluate((el) => (el.scrollTop = 28 * 40_000));
    await page.waitForFunction(() => !!document.querySelector('[data-testid="vwg-cell-40010-1"]'), null, {
      timeout: 10_000,
    });
    assert.equal((await page.getByTestId("vwg-cell-40010-1").innerText()).trim(), "row 40010");
  } finally {
    await s.close();
  }
});
