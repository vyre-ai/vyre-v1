// A real file opened in the real app shows its content (13 Nov 2026: every CSV and workbook opened as "0 rows, 0 columns" from the first viewer commit, and nobody opened a real file to see it). Real Chromium
// against the production export and a claimed daemon: a CSV, a REAL two-sheet workbook (built through the sheets capabilities, not a stub), a PDF, an image, a Markdown and a text file are each opened from the
// list and their content is asserted on screen; Back returns to the same list; a live file whose fetch fails shows the error with Try again, and Try again shows the content.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { bootFreshSpace, claimOnEdge, edge, dismissOnboarding } from "./real-app-harness.test.ts";

const PASSWORD = "fixture password 123";
/** A real 64 by 64 red PNG, built here (a 1 by 1 picture is one pixel at 100%, which reads as an empty checkerboard). */
function redPng(): string {
  const w = 64;
  const h = 64;
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) raw.set([200, 30, 30], y * (w * 3 + 1) + 1 + x * 3);
  const chunk = (type: string, data: Buffer): Buffer => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(Buffer.concat([Buffer.from(type), data])) >>> 0);
    return Buffer.concat([len, Buffer.from(type), data, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]).toString("base64");
}
const PNG = redPng();
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
    const book = (
      await call("sheets.create", {
        folderId,
        name: "book",
        format: "xlsx",
        columns: ["client", "fee"],
        sheet: "Fees",
        idempotencyKey: "w-book",
      })
    ).file.fileId as string;
    await call("sheets.append_rows", {
      fileId: book,
      sheet: "Fees",
      rows: [{ client: "Gamma", fee: "30" }],
      idempotencyKey: "w-r1",
    });
    await call("sheets.add_sheet", { fileId: book, sheet: "Costs", columns: ["item", "cost"], idempotencyKey: "w-s2" });
    await call("sheets.append_rows", {
      fileId: book,
      sheet: "Costs",
      rows: [{ item: "Rent", cost: "900" }],
      idempotencyKey: "w-r2",
    });
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
      assert.equal(
        (await page.getByTestId("files-title").innerText()).trim(),
        "Walk",
        "Back returns to the same folder",
      );
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
    const seenResponses: string[] = [];
    page.on("response", (r) => {
      if (/\/spaces\/|blobs|viewer_data|previews/.test(r.url()))
        seenResponses.push(
          `${r.status()} ${r.url().replace(web.origin, "")} ${r.headers()["content-type"] ?? ""} ${r.headers()["content-length"] ?? ""}`,
        );
    });
    // image: a picture that loaded, not an empty checkerboard
    await open("logo.png");
    await page.waitForTimeout(1200);
    const drawn = await page.evaluate(() => {
      const hit = [...document.querySelectorAll("*")].filter((e) =>
        /blobs\//.test(getComputedStyle(e).backgroundImage),
      );
      const img = [...document.querySelectorAll("img")].filter((i) => i.complete && i.naturalWidth > 1);
      return {
        bg: hit.map((e) => [Math.round(e.getBoundingClientRect().width), Math.round(e.getBoundingClientRect().height)]),
        img: img.map((i) => [i.naturalWidth, Math.round(i.getBoundingClientRect().width)]),
      };
    });
    await shot("image");
    assert.ok(
      drawn.bg.some(([w, h]) => w! >= 60 && h! >= 60) || drawn.img.some(([nw, w]) => nw! >= 60 && w! >= 60),
      `the picture is on screen at a real size: ${JSON.stringify(drawn)} responses=${JSON.stringify(seenResponses)}`,
    );
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
    const liveId = (await call("files.list", { folder: folderId })).files.find((f: any) => f.name === "live.csv")
      .fileId as string;
    let failedOnce = false;
    let arm = false; // the list also reads viewer_data for its thumbnails: only the viewer's own read after the file is opened fails
    await page.route("**/v1/files/get", async (route) => {
      const res = await route.fetch();
      const json = await res.json();
      if (json?.data?.file?.fileId === liveId)
        json.data.file = { ...json.data.file, size: 0, source: { mountId: "mnt_walk", provider: "Google Drive" } };
      await route.fulfill({ response: res, json });
    });
    await page.route("**/v1/files/viewer_data", async (route) => {
      const req = JSON.parse(route.request().postData() ?? "{}");
      if (req.fileId === liveId && arm) {
        failedOnce = true;
        await route.fulfill({
          status: 502,
          contentType: "application/json",
          body: JSON.stringify({
            error: {
              code: "provider.unavailable",
              message: "Drive is down.",
              retryable: true,
              traceId: "0".repeat(32),
              next: [],
            },
          }),
        });
        return;
      }
      await route.continue();
    });
    arm = true;
    await open("live.csv");
    await page
      .getByTestId("file-viewer-failed")
      .waitFor({ timeout: 20_000 })
      .catch(async (e) => {
        await shot("failed-missing");
        throw new Error(
          `no failed state: armed=${failedOnce} body=${(await body()).slice(0, 400)} ${String(e).slice(0, 60)}`,
        );
      });
    assert.match(await body(), /Could not get this from Google Drive/);
    assert.doesNotMatch(await body(), /0 rows/);
    await shot("failed");
    arm = false; // the provider is back: Try again reads the file
    await page.getByTestId("state-action").click();
    await page.getByText("Live", { exact: true }).first().waitFor({ timeout: 20_000 });
    await shot("retried");
  } finally {
    await browser.close();
    web.close();
    await space.stop();
  }
});
