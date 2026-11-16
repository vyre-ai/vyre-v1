// The owner's words (15 Nov 2026): "being able to see drive files here in native vyre viewers with all our native features is important". A PDF, a workbook, a Word file and a deck open in the Files
// viewer as the real thing, and the viewer's own features work on them. Real Chromium against the production export and a claimed daemon. Pictures go to VYRE_VIEWER_SHOTS.
// Part "pdf, the 500 page file and the scan" of the viewer walk (split from files.viewers.live.test.ts, which ran 65 to 80 s).
import test from "node:test";
import assert from "node:assert/strict";
import { session } from "./viewers-harness.test.ts";
import { makePdf, reportPages } from "./viewer-fixtures.ts";
import { drawn } from "./files-viewers-kit.ts";

test("a 500 page PDF opens on its first page quickly and a far page draws on demand", async (t) => {
  const s = await session(t);
  if (!s) return;
  const { page } = s;
  try {
    await s.make("long.pdf", makePdf(reportPages(500)), "application/pdf");
    await page.goto(`${s.web.origin}/files`, { waitUntil: "load" });
    await page.getByTestId("shell").waitFor({ timeout: 30_000 });
    await page.getByText("Viewers", { exact: true }).first().dblclick();
    await page.getByText("long.pdf", { exact: true }).first().waitFor({ timeout: 20_000 });
    const t0 = Date.now();
    await page.getByText("long.pdf", { exact: true }).first().dblclick();
    await page.waitForFunction(() => !!document.querySelector('[data-testid="vwp-page-1"] canvas'), null, {
      timeout: 30_000,
    });
    const open = Date.now() - t0;
    console.log(`SPEED pdf-500-open-ms=${open}`);
    assert.ok(open < 2000, `the first page of a 500 page file draws in under two seconds (took ${open} ms)`);
    await page.getByTestId("vw-page-input").fill("400");
    const t1 = Date.now();
    await page.getByTestId("vw-page-input").press("Enter");
    await page.waitForFunction(() => !!document.querySelector('[data-testid="vwp-page-400"] canvas'), null, {
      timeout: 15_000,
    });
    console.log(`SPEED pdf-500-jump-ms=${Date.now() - t1}`);
    const canvases = await page.evaluate(() => document.querySelectorAll(".vwp-page canvas").length);
    assert.ok(canvases <= 14, `only the pages near the screen hold a canvas (${canvases})`);
  } finally {
    await s.close();
  }
});

test("a scan with no text layer still draws and Find says there is no text; a broken PDF says so", async (t) => {
  const s = await session(t);
  if (!s) return;
  const { page } = s;
  try {
    await s.make("blank.pdf", makePdf([[""]]).length ? makePdf([[]]) : makePdf([[]]), "application/pdf");
    await s.make("broken.pdf", Buffer.from("%PDF-1.4\nthis is not a pdf at all"), "application/pdf");
    await s.open("blank.pdf");
    await page.waitForFunction(() => !!document.querySelector('[data-testid="vwp-page-1"] canvas'), null, {
      timeout: 20_000,
    });
    await page.getByTestId("vw-find-btn").click();
    await page.getByTestId("vw-find-input").fill("anything");
    await page.getByText("No text to search here").waitFor({ timeout: 20_000 });
    await s.open("broken.pdf");
    await page.getByText("This PDF is damaged and cannot be shown here.").waitFor({ timeout: 20_000 });
  } finally {
    await s.close();
  }
});
