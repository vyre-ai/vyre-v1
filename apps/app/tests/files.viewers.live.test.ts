// The owner's words (15 Nov 2026): "being able to see drive files here in native vyre viewers with all our native features is important". A PDF, a workbook, a Word file and a deck open in the Files
// viewer as the real thing, and the viewer's own features work on them. Real Chromium against the production export and a claimed daemon. Pictures go to VYRE_VIEWER_SHOTS.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { bootFreshSpace, claimOnEdge, edge, dismissOnboarding } from "./real-app-harness.test.ts";
import { makePdf, reportPages } from "./viewer-fixtures.ts";

const PASSWORD = "fixture password 123";
type Pg = import("playwright-core").Page;

async function session(t: { skip(m?: string): void }, size = { width: 1440, height: 900 }) {
  const dist = process.env["VYRE_APP_DIST"];
  if (!dist) {
    if (process.env["VYRE_REQUIRE_CHROME"] === "1") assert.fail("VYRE_APP_DIST required");
    t.skip("VYRE_APP_DIST required");
    return null;
  }
  const { chromium } = await import("playwright-core");
  const exe = process.env["CHROME_BIN"] || chromium.executablePath();
  const space = await bootFreshSpace();
  const web = await edge(dist, space.url);
  const browser = await chromium.launch({ executablePath: exe, args: ["--no-sandbox"] });
  const ctx = await browser.newContext({ viewport: size, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error" || m.type() === "warning") console.log(`BROWSER ${m.type()}: ${m.text().slice(0, 300)}`);
  });
  page.on("response", (r) => {
    if (r.status() >= 400 && /\/v1\//.test(r.url())) void r.text().then((b) => console.log(`HTTP ${r.status()} ${r.url().replace(/^.*\/v1\//, "")} ${b.slice(0, 300)}`)).catch(() => undefined);
  });
  page.on("requestfailed", (r) => console.log(`REQFAIL ${r.url().slice(0, 120)} ${r.failure()?.errorText}`));
  await page.goto(claimOnEdge(space.claim!, web.origin), { waitUntil: "load" });
  await page.getByTestId("claim-name").fill("Olivia Owner");
  await page.getByTestId("claim-username").fill("olivia");
  await page.getByTestId("claim-password").fill(PASSWORD);
  await page.getByTestId("claim-confirm").fill(PASSWORD);
  await page.getByTestId("claim-next").click();
  await page.getByTestId("claim-create").click();
  await dismissOnboarding(page);
  const token = await page.evaluate(
    () => JSON.parse(localStorage.getItem("vyre.session.v1")!).sessions[location.origin].token as string,
  );
  const call = async (cap: string, data: unknown): Promise<any> => {
    // eslint-disable-line @typescript-eslint/no-explicit-any
    const r = await ctx.request.post(`${web.origin}/v1/${cap.replaceAll(".", "/")}`, {
      headers: { authorization: `Bearer ${token}` },
      data,
    });
    const body = await r.json();
    assert.equal(r.status(), 200, `${cap}: ${JSON.stringify(body)}`);
    return body.data;
  };
  const root = JSON.stringify(await call("files.tree", {})).match(/"(fld_[a-z0-9]+)"/)![1]!;
  const folderId = (await call("files.folder.create", { parentId: root, name: "Viewers", idempotencyKey: "vw" }))
    .folder.folderId as string;
  const shots = process.env["VYRE_VIEWER_SHOTS"] ?? "/tmp/vyre-viewer-shots";
  fs.mkdirSync(shots, { recursive: true });
  return {
    page,
    ctx,
    call,
    web,
    folderId,
    errors,
    shot: (n: string) => page.screenshot({ path: path.join(shots, `${n}.png`) }),
    make: async (name: string, bytes: Buffer, mime: string): Promise<any> => {
      let content: unknown = { base64: bytes.toString("base64") };
      if (bytes.length > 190 * 1024) {
        // over the direct-write size: the bytes go to a one-time upload address first
        const slot = await call("files.upload_url", { size: bytes.length, mime });
        const r = await ctx.request.put(`${web.origin}${slot.url}`, {
          headers: { authorization: `Bearer ${token}`, "content-type": "application/octet-stream" },
          data: bytes,
        });
        assert.ok(r.ok(), `upload ${r.status()}`);
        content = { blobId: slot.blobId };
      }
      return call("files.create", { folderId, name, content, mime, idempotencyKey: `m-${name}` });
    },
    open: async (name: string): Promise<void> => {
      await page.goto(`${web.origin}/files`, { waitUntil: "load" });
      await page.getByTestId("shell").waitFor({ timeout: 30_000 });
      await page.getByText("Viewers", { exact: true }).first().dblclick();
      await page.getByText(name, { exact: true }).first().waitFor({ timeout: 20_000 });
      await page.getByText(name, { exact: true }).first().dblclick();
    },
    close: async (): Promise<void> => {
      await browser.close();
      web.close();
      await space.stop();
    },
  };
}

const drawn = (page: Pg, n: number): Promise<boolean> =>
  page.evaluate((k) => !!document.querySelector(`[data-testid="vwp-page-${k}"] canvas`), n);

test("a 30 page PDF is drawn as pages: find steps through, a comment pins to page 12, a redacted copy has no text", async (t) => {
  const s = await session(t);
  if (!s) return;
  const { page } = s;
  try {
    const pdf = await s.make("quarterly.pdf", makePdf(reportPages(30)), "application/pdf");
    const fileId = pdf.file.fileId as string;
    await s.open("quarterly.pdf");
    await page.getByTestId("vwp").waitFor({ timeout: 30_000 }).catch(async (e) => {
      await s.shot("pdf-debug");
      console.log("BODY", (await page.locator("body").innerText()).replace(/\s+/g, " ").slice(0, 500));
      throw e;
    });
    await page.waitForFunction(() => !!document.querySelector('[data-testid="vwp-page-1"] canvas'), null, { timeout: 20_000 });
    assert.equal(await page.getByTestId("vwp").getAttribute("data-pages"), "30");
    assert.match(await page.getByTestId("vw-page-count").innerText(), /30/);
    // lazy: the first pages are drawn, the last is not
    assert.equal(await drawn(page, 1), true);
    assert.equal(await drawn(page, 30), false, "page 30 is not drawn until it is near the screen");
    // the words are real, selectable text on the page
    await page.waitForFunction(() => document.querySelector('[data-testid="vwp-page-1"] .vwp-text')?.textContent?.includes("Section 1 of the report"), null, { timeout: 15_000 });
    await s.shot("pdf-open");
    // find: highlights matches on the page and steps through them
    await page.getByTestId("vw-find-btn").click();
    await page.getByTestId("vw-find-input").fill("quarterly report");
    await page.waitForFunction(() => /1 of 30/.test(document.querySelector('[data-testid="vw-count"]')?.textContent ?? ""), null, { timeout: 30_000 });
    await page.waitForFunction(() => !!document.querySelector('[data-testid="vwp-page-1"] mark.vwf-on'), null, { timeout: 10_000 });
    await s.shot("pdf-find");
    for (let i = 0; i < 11; i++) await page.getByTestId("vw-next").click();
    await page.waitForFunction(() => /12 of 30/.test(document.querySelector('[data-testid="vw-count"]')?.textContent ?? ""));
    await page.waitForFunction(() => !!document.querySelector('[data-testid="vwp-page-12"] mark.vwf-on'), null, { timeout: 10_000 });
    assert.equal(await page.getByTestId("vw-page-input").inputValue(), "12", "the page number follows the match");
    await page.getByTestId("vw-find-input").fill("");
    // jump to page 12 by its number
    await page.getByTestId("vw-page-input").fill("12");
    await page.getByTestId("vw-page-input").press("Enter");
    // a comment on a place of page 12
    await page.getByTestId("vw-tool-comment").click();
    const box = await page.getByTestId("vwp-page-12").boundingBox();
    assert.ok(box, "page 12 is on screen");
    await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.1);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.18, { steps: 6 });
    await page.mouse.up();
    await page.getByTestId("vwp-note-input").fill("Check this figure");
    await page.getByTestId("vwp-note-input").press("Enter");
    await page.getByTestId("vwp-pin-1").waitFor({ timeout: 10_000 });
    const list = await s.call("files.comments.list", { fileId });
    const c = list.comments.find((x: any) => x.text === "Check this figure");
    assert.equal(c?.anchor.kind, "area");
    assert.equal(c?.anchor.page, 12, "the comment is anchored to page 12");
    await s.shot("pdf-comment");
    await page.getByTestId("vw-tool-comment").click();
    // redact an area of page 3 for AI, then save a redacted copy
    await page.getByTestId("vw-page-input").fill("3");
    await page.getByTestId("vw-page-input").press("Enter");
    await page.getByTestId("vw-tool-redact").click();
    const b3 = await page.getByTestId("vwp-page-3").boundingBox();
    assert.ok(b3);
    await page.mouse.move(b3.x + b3.width * 0.05, b3.y + b3.height * 0.05);
    await page.mouse.down();
    await page.mouse.move(b3.x + b3.width * 0.9, b3.y + b3.height * 0.2, { steps: 6 });
    await page.mouse.up();
    await page.waitForFunction(() => document.querySelectorAll('[data-testid^="vwp-rbox-"]').length >= 1, null, { timeout: 10_000 });
    const marks = await s.call("files.marks.list", { fileId });
    assert.ok(marks.marks.some((m: any) => m.shape === "box" && m.page === 3), "the redaction is on page 3");
    await page.getByTestId("vw-more").click();
    await page.getByText("Save a redacted copy", { exact: true }).click();
    await page.getByText(/redacted\)\.pdf beside the original/).waitFor({ timeout: 60_000 }).catch(async (e) => {
      console.log("NOTE", await page.getByTestId("file-viewer-note").innerText().catch(() => "(none)"));
      throw e;
    });
    const files = (await s.call("files.list", { folder: s.folderId })).files as { name: string; fileId: string }[];
    const copy = files.find((f) => f.name === "quarterly (redacted).pdf");
    assert.ok(copy, "the copy is a new file beside the original");
    const bytes = Buffer.from((await s.call("files.read", { fileId: copy.fileId, as: "base64" })).base64, "base64");
    assert.equal(bytes.subarray(0, 5).toString(), "%PDF-");
    assert.doesNotMatch(bytes.toString("latin1"), /\/Font|\bBT\b|\bTj\b/, "no text operators in the copy");
    const text = await s.call("previews.text", { fileId: copy.fileId });
    assert.equal((text.text ?? "").replace(/\s+/g, ""), "", "extracting text from the copy gives nothing");
    const orig = await s.call("previews.text", { fileId });
    assert.match(orig.text, /Section 3 of the report/, "the original keeps its words");
    assert.deepEqual(s.errors, []);
  } finally {
    await s.close();
  }
});

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
    await page.waitForFunction(() => !!document.querySelector('[data-testid="vwp-page-1"] canvas'), null, { timeout: 30_000 });
    const open = Date.now() - t0;
    console.log(`SPEED pdf-500-open-ms=${open}`);
    assert.ok(open < 2000, `the first page of a 500 page file draws in under two seconds (took ${open} ms)`);
    await page.getByTestId("vw-page-input").fill("400");
    const t1 = Date.now();
    await page.getByTestId("vw-page-input").press("Enter");
    await page.waitForFunction(() => !!document.querySelector('[data-testid="vwp-page-400"] canvas'), null, { timeout: 15_000 });
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
    await page.waitForFunction(() => !!document.querySelector('[data-testid="vwp-page-1"] canvas'), null, { timeout: 20_000 });
    await page.getByTestId("vw-find-btn").click();
    await page.getByTestId("vw-find-input").fill("anything");
    await page.getByText("No text to search here").waitFor({ timeout: 20_000 });
    await s.open("broken.pdf");
    await page.getByText("This PDF is damaged and cannot be shown here.").waitFor({ timeout: 20_000 });
  } finally {
    await s.close();
  }
});

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
    const f = await s.make("budget.xlsx", await threeSheetBook(), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
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
    await page.waitForFunction(() => document.querySelector('[data-testid="vwg-cell-1-1"]')?.textContent?.trim() === "12.25", null, { timeout: 5000 });
    // saved as a new version
    await page.waitForFunction(() => /v2/.test(document.querySelector('[data-testid="vw-saved"]')?.textContent ?? ""), null, { timeout: 20_000 });
    const versions = (await s.call("files.versions", { fileId })).versions as { n: number }[];
    assert.ok(versions.length >= 2, "History has the new version");
    // reopen: the change is there, the other sheets are intact
    await s.open("budget.xlsx");
    await page.getByTestId("vwg").waitFor({ timeout: 40_000 });
    assert.equal((await page.getByTestId("vwg-cell-1-3").innerText()).trim(), "62.50");
    await page.getByTestId("vwg-tab-1").click();
    await page.waitForFunction(() => document.querySelector('[data-testid="vwg-cell-0-1"]')?.textContent?.trim() === "the quarterly figures");
    const bytes = Buffer.from((await s.call("files.read", { fileId, as: "base64" })).base64, "base64");
    const ExcelJS = (await import("exceljs")).default;
    const re = new ExcelJS.Workbook();
    await re.xlsx.load(bytes as never);
    assert.deepEqual(re.worksheets.map((w) => w.name), ["Budget", "Notes", "Tax"]);
    assert.equal(re.getWorksheet("Budget")!.getCell("B2").numFmt, "$#,##0.00");
    assert.equal(re.getWorksheet("Budget")!.getCell("D2").formula, "B2*C2");
    assert.equal(re.getWorksheet("Budget")!.getCell("C2").value, 5);
    assert.equal(re.getWorksheet("Budget")!.views[0]?.ySplit, 1, "the frozen header row is kept");
    // find across sheets steps into another tab
    await page.getByTestId("vw-find-btn").click();
    await page.getByTestId("vw-find-input").fill("quarterly");
    await page.waitForFunction(() => /1 of 1/.test(document.querySelector('[data-testid="vw-count"]')?.textContent ?? ""), null, { timeout: 10_000 });
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
    await page.waitForFunction(() => !!document.querySelector('[data-testid="vwg-cell-40010-1"]'), null, { timeout: 10_000 });
    assert.equal((await page.getByTestId("vwg-cell-40010-1").innerText()).trim(), "row 40010");
  } finally {
    await s.close();
  }
});
