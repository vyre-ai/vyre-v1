// A real file opened in the real app shows its content (13 Nov 2026: every CSV and workbook opened as "0 rows, 0 columns" from the first viewer commit, and nobody opened a real file to see it). Real Chromium
// against the production export and a claimed daemon: a CSV, a REAL two-sheet workbook (built through the sheets capabilities, not a stub), a PDF, an image, a Markdown and a text file are each opened from the
// list and their content is asserted on screen; Back returns to the same list; a live file whose fetch fails shows the error with Try again, and Try again shows the content.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { bootFreshSpace, claimOnEdge, edge, dismissOnboarding } from "./real-app-harness.test.ts";

const PASSWORD = "fixture password 123";
const PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const PDF = [
  "%PDF-1.4",
  "1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj",
  "2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj",
  "3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 100]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj",
  "4 0 obj<</Length 44>>stream",
  "BT /F1 18 Tf 10 50 Td (Hello walk PDF) Tj ET",
  "endstream endobj",
  "5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj",
  "trailer<</Root 1 0 R/Size 6>>",
  "%%EOF",
].join("\n");

test("real files open with their content: csv, a two-sheet workbook, pdf, image, markdown, text; Back returns to the list; a failed live fetch shows Try again", async (t) => {
  const dist = process.env["VYRE_APP_DIST"];
  if (!dist) {
    if (process.env["VYRE_REQUIRE_CHROME"] === "1") assert.fail("VYRE_APP_DIST required");
    t.skip("VYRE_APP_DIST required");
    return;
  }
  const { chromium } = await import("playwright-core");
  const exe = process.env["CHROME_BIN"] || chromium.executablePath();
  const space = await bootFreshSpace();
  const web = await edge(dist, space.url);
  const browser = await chromium.launch({ executablePath: exe, args: ["--no-sandbox"] });
  const shots = process.env["VYRE_FILES_SHOTS"] ?? "/tmp/vyre-files-content-shots";
  fs.mkdirSync(shots, { recursive: true });
  try {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await ctx.newPage();
    await page.goto(claimOnEdge(space.claim!, web.origin), { waitUntil: "load" });
    await page.getByTestId("claim-name").fill("Olivia Owner");
    await page.getByTestId("claim-username").fill("olivia");
    await page.getByTestId("claim-password").fill(PASSWORD);
    await page.getByTestId("claim-confirm").fill(PASSWORD);
    await page.getByTestId("claim-next").click();
    await page.getByTestId("claim-saved").click();
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
    const folderId = (await call("files.folder.create", { parentId: root, name: "Walk", idempotencyKey: "walk" }))
      .folder.folderId as string;
    const make = (name: string, content: unknown, mime?: string): Promise<any> =>
      call("files.create", { folderId, name, content, ...(mime ? { mime } : {}), idempotencyKey: `w-${name}` });
    await make("fees.csv", { text: "client,fee\nAcme,10\nBeta,20\n" }, "text/csv");
    // a REAL two-sheet workbook
    const book = (await call("sheets.create", { folderId, name: "book", format: "xlsx", columns: ["client", "fee"], sheet: "Fees" }))
      .file.fileId as string;
    await call("sheets.append_rows", { fileId: book, sheet: "Fees", rows: [{ client: "Gamma", fee: "30" }] });
    await call("sheets.add_sheet", { fileId: book, sheet: "Costs", columns: ["item", "cost"] });
    await call("sheets.append_rows", { fileId: book, sheet: "Costs", rows: [{ item: "Rent", cost: "900" }] });
    await make("brief.pdf", { base64: Buffer.from(PDF).toString("base64") }, "application/pdf");
    await make("logo.png", { base64: PNG }, "image/png");
    await make("notes.md", { text: "# Walk heading\n\nA markdown paragraph." });
    await make("plain.txt", { text: "Plain walk text" });
    await make("live.csv", { text: "client,fee\nLive,99\n" }, "text/csv");

    const openList = async (): Promise<void> => {
      await page.goto(`${web.origin}/files`, { waitUntil: "load" });
      await page.getByTestId("shell").waitFor({ timeout: 30_000 });
      await page.getByText("Walk", { exact: true }).first().dblclick();
      await page.getByText("fees.csv", { exact: true }).first().waitFor({ timeout: 20_000 });
    };
    const open = async (name: string): Promise<void> => {
      await page.getByText(name, { exact: true }).first().dblclick();
    };
    const back = async (): Promise<void> => {
      await page.getByTestId("file-back").click();
      await page.getByText("fees.csv", { exact: true }).first().waitFor({ timeout: 15_000 });
      assert.equal((await page.getByTestId("files-title").innerText()).trim(), "Walk", "Back returns to the same folder");
    };
    const shot = (n: string): Promise<unknown> => page.screenshot({ path: path.join(shots, `${n}.png`) });
    const body = async (): Promise<string> => (await page.locator("body").innerText()).replace(/\s+/g, " ");

    await openList();
    // CSV: rows on screen, not "0 rows"
    await open("fees.csv");
    await page.getByText("Acme").first().waitFor({ timeout: 20_000 });
    assert.doesNotMatch(await body(), /0 rows/);
    assert.match(await body(), /2 rows/);
    await shot("csv");
    await back();
    // the workbook: its first sheet, and the words that it shows the first of two
    await open("book.xlsx");
    await page.getByText("Gamma").first().waitFor({ timeout: 20_000 });
    assert.match(await body(), /Showing the first of 2 sheets/);
    await shot("xlsx");
    await back();
    // PDF
    await open("brief.pdf");
    await page.getByText("Hello walk PDF").first().waitFor({ timeout: 30_000 });
    await shot("pdf");
    await back();
    // image: a picture that loaded, not an empty checkerboard
    await open("logo.png");
    await page.waitForFunction(
      () => [...document.querySelectorAll("img")].some((i) => i.complete && i.naturalWidth > 0),
      undefined,
      { timeout: 30_000 },
    );
    await shot("image");
    await back();
    await open("notes.md");
    await page.getByText("A markdown paragraph.").first().waitFor({ timeout: 20_000 });
    await shot("markdown");
    await back();
    await open("plain.txt");
    await page.getByText("Plain walk text").first().waitFor({ timeout: 20_000 });
    await shot("text");
    // Esc leaves the file too
    await page.keyboard.press("Escape");
    await page.getByText("fees.csv", { exact: true }).first().waitFor({ timeout: 15_000 });

    // a live file whose fetch fails: the error with Try again; Try again shows the content
    const liveId = (await call("files.list", { folder: folderId })).files.find((f: any) => f.name === "live.csv").fileId as string;
    let failedOnce = false;
    await page.route("**/v1/files/get", async (route) => {
      const res = await route.fetch();
      const json = await res.json();
      if (json?.data?.file?.fileId === liveId)
        json.data.file = { ...json.data.file, size: 0, source: { mountId: "mnt_walk", provider: "Google Drive" } };
      await route.fulfill({ response: res, json });
    });
    await page.route("**/v1/files/viewer_data", async (route) => {
      const req = JSON.parse(route.request().postData() ?? "{}");
      if (req.fileId === liveId && !failedOnce) {
        failedOnce = true;
        await route.fulfill({
          status: 502,
          contentType: "application/json",
          body: JSON.stringify({
            error: { code: "provider.unavailable", message: "Drive is down.", retryable: true, traceId: "0".repeat(32), next: [] },
          }),
        });
        return;
      }
      await route.continue();
    });
    await open("live.csv");
    await page.getByTestId("file-viewer-failed").waitFor({ timeout: 20_000 });
    assert.match(await body(), /Could not get this from Google Drive/);
    assert.doesNotMatch(await body(), /0 rows/);
    await shot("failed");
    await page.getByTestId("state-action").click();
    await page.getByText("Live", { exact: true }).first().waitFor({ timeout: 20_000 });
    await shot("retried");
  } finally {
    await browser.close();
    web.close();
    await space.stop();
  }
});
