// Pictures of the real app for the native viewers (dark desktop at 1440, light phone at 390) and the phone layout of each: one page wide, no sideways scroll, the same toolbar. Sample files are neutral.
import test from "node:test";
import assert from "node:assert/strict";
import { session } from "./viewers-session.ts";
import { makeDocx, makePdf, makePptx, reportPages } from "./viewer-fixtures.ts";

const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const PPTX = "application/vnd.openxmlformats-officedocument.presentationml.presentation";
const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

for (const [tag, size, scheme] of [
  ["desk", { width: 1440, height: 900 }, "dark"],
  ["phone", { width: 390, height: 844 }, "light"],
] as const) {
  test(`the native viewers at ${tag} size (${scheme}): each kind opens, and nothing runs off the screen`, async (t) => {
    const s = await session(t, size);
    if (!s) return;
    const { page } = s;
    try {
      await page.emulateMedia({ colorScheme: scheme });
      const ExcelJS = (await import("exceljs")).default;
      const wb = new ExcelJS.Workbook();
      const w = wb.addWorksheet("Budget");
      w.views = [{ state: "frozen", ySplit: 1 }];
      w.columns = [{ width: 22 }, { width: 14 }, { width: 10 }, { width: 14 }];
      w.addRow(["Item", "Cost", "Qty", "Total"]).font = { bold: true };
      w.addRow(["Paper", 12.5, 4, { formula: "B2*C2", result: 50 }]);
      w.addRow(["Ink", 30, 2, { formula: "B3*C3", result: 60 }]);
      w.addRow(["Sum", null, null, { formula: "SUM(D2:D3)", result: 110 }]);
      for (const a of ["B2", "B3"]) w.getCell(a).numFmt = "$#,##0.00";
      wb.addWorksheet("Notes").addRow(["Remember", "the quarterly figures"]);
      const files = {
        pdf: (await s.make("quarterly.pdf", makePdf(reportPages(30)), "application/pdf")).file.fileId as string,
        xlsx: (await s.make("budget.xlsx", Buffer.from(await wb.xlsx.writeBuffer()), XLSX)).file.fileId as string,
        docx: (await s.make("plan.docx", makeDocx(), DOCX)).file.fileId as string,
        pptx: (await s.make("review.pptx", makePptx(), PPTX)).file.fileId as string,
        csv: (
          await s.call("files.create", {
            folderId: s.folderId,
            name: "fees.csv",
            content: { text: "client,fee\nAcme,10\nBeta,20\n" },
            mime: "text/csv",
            idempotencyKey: "csv1",
          })
        ).file.fileId as string,
      };
      const go = async (id: string, ready: string): Promise<void> => {
        await page.goto(`${s.web.origin}/files#subject=file:${id}`, { waitUntil: "load" });
        await page.getByTestId(ready).waitFor({ timeout: 40_000 });
        await page.waitForTimeout(600);
      };
      const fits = async (what: string): Promise<void> => {
        const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        const who =
          over > 2
            ? await page.evaluate(() =>
                [...document.querySelectorAll("body *")]
                  .filter((e) => e.getBoundingClientRect().right > window.innerWidth + 2)
                  .slice(0, 4)
                  .map(
                    (e) =>
                      `${e.tagName}.${String((e as HTMLElement).className).slice(0, 40)}[${(e as HTMLElement).dataset?.["testid"] ?? ""}] right=${Math.round(e.getBoundingClientRect().right)}`,
                  ),
              )
            : [];
        assert.ok(over <= 2, `${what}: the page does not scroll sideways (${over}px over) ${who.join(" | ")}`);
      };
      await go(files.pdf, "vwp");
      await page.waitForFunction(() => !!document.querySelector('[data-testid="vwp-page-1"] canvas'), null, {
        timeout: 20_000,
      });
      await s.shot(`${tag}-pdf`);
      await fits("pdf");
      if (tag === "phone") {
        const pw = (await page.getByTestId("vwp-page-1").boundingBox())!.width;
        assert.ok(pw <= size.width, `a page is one page wide on a phone (${pw})`);
      } else {
        await page.getByTestId("vw-find-btn").click();
        await page.getByTestId("vw-find-input").fill("quarterly report");
        await page.waitForFunction(() => !!document.querySelector("mark.vwf-on"), null, { timeout: 30_000 });
        await s.shot(`${tag}-pdf-find`);
      }
      await go(files.xlsx, "vwg");
      await s.shot(`${tag}-xlsx`);
      await fits("xlsx");
      if (tag === "desk") {
        await page.getByTestId("vw-mode-edit").click();
        await page.getByTestId("vwg-cell-1-2").click();
        await page.keyboard.type("5");
        await s.shot(`${tag}-xlsx-editing`);
        await page.keyboard.press("Escape");
      }
      await go(files.docx, "vww");
      await s.shot(`${tag}-docx`);
      await fits("docx");
      if (tag === "desk") {
        await page.getByTestId("vw-mode-edit").click();
        await page.locator('[data-pid="d1"] [data-r="1"]').dblclick();
        await s.shot(`${tag}-docx-editing`);
      }
      await go(files.pptx, "vws");
      await s.shot(`${tag}-pptx`);
      await fits("pptx");
      await go(files.csv, "vwg");
      await s.shot(`${tag}-csv`);
      await fits("csv");
      assert.deepEqual(s.errors, []);
    } finally {
      await s.close();
    }
  });
}
