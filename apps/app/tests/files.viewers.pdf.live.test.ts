// The owner's words (15 Nov 2026): "being able to see drive files here in native vyre viewers with all our native features is important". A PDF, a workbook, a Word file and a deck open in the Files
// viewer as the real thing, and the viewer's own features work on them. Real Chromium against the production export and a claimed daemon. Pictures go to VYRE_VIEWER_SHOTS.
// Part "pdf" of the viewer walk (split from files.viewers.live.test.ts, which ran 65 to 80 s).
import test from "node:test";
import assert from "node:assert/strict";
import { session } from "./viewers-harness.test.ts";
import { pdfText } from "./pdf-text-node.ts";
import { makePdf, reportPages } from "./viewer-fixtures.ts";
import { drawn } from "./files-viewers-kit.ts";

test("a 30 page PDF is drawn as pages: find steps through, a comment pins to page 12, a redacted copy has no text", async (t) => {
  const s = await session(t);
  if (!s) return;
  const { page } = s;
  try {
    const pdf = await s.make("quarterly.pdf", makePdf(reportPages(30)), "application/pdf");
    const fileId = pdf.file.fileId as string;
    await s.open("quarterly.pdf");
    await page
      .getByTestId("vwp")
      .waitFor({ timeout: 30_000 })
      .catch(async (e) => {
        await s.shot("pdf-debug");
        console.log("BODY", (await page.locator("body").innerText()).replace(/\s+/g, " ").slice(0, 500));
        throw e;
      });
    await page.waitForFunction(() => !!document.querySelector('[data-testid="vwp-page-1"] canvas'), null, {
      timeout: 20_000,
    });
    assert.equal(await page.getByTestId("vwp").getAttribute("data-pages"), "30");
    assert.match(await page.getByTestId("vw-page-count").innerText(), /30/);
    // lazy: the first pages are drawn, the last is not
    assert.equal(await drawn(page, 1), true);
    assert.equal(await drawn(page, 30), false, "page 30 is not drawn until it is near the screen");
    // the words are real, selectable text on the page
    await page.waitForFunction(
      () =>
        document
          .querySelector('[data-testid="vwp-page-1"] .vwp-text')
          ?.textContent?.includes("Section 1 of the report"),
      null,
      { timeout: 15_000 },
    );
    await s.shot("pdf-open");
    // find: highlights matches on the page and steps through them
    await page.getByTestId("vw-find-btn").click();
    await page.getByTestId("vw-find-input").fill("quarterly report");
    await page.waitForFunction(
      () => /1 of 30/.test(document.querySelector('[data-testid="vw-count"]')?.textContent ?? ""),
      null,
      { timeout: 30_000 },
    );
    await page.waitForFunction(() => !!document.querySelector('[data-testid="vwp-page-1"] mark.vwf-on'), null, {
      timeout: 10_000,
    });
    await s.shot("pdf-find");
    for (let i = 0; i < 11; i++) await page.getByTestId("vw-next").click();
    await page.waitForFunction(() =>
      /12 of 30/.test(document.querySelector('[data-testid="vw-count"]')?.textContent ?? ""),
    );
    await page.waitForFunction(() => !!document.querySelector('[data-testid="vwp-page-12"] mark.vwf-on'), null, {
      timeout: 10_000,
    });
    // the page number is set by the page coming into view, a frame or two after the match is marked: wait for it, then assert it (CI, 16 Nov 2026: read in that gap on a busy runner)
    await page
      .waitForFunction(
        () => (document.querySelector('[data-testid="vw-page-input"]') as HTMLInputElement | null)?.value === "12",
        null,
        { timeout: 5_000 },
      )
      .catch(() => undefined);
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
    await page.waitForFunction(() => document.querySelectorAll('[data-testid^="vwp-rbox-"]').length >= 1, null, {
      timeout: 10_000,
    });
    const marks = await s.call("files.marks.list", { fileId });
    assert.ok(
      marks.marks.some((m: any) => m.shape === "box" && m.page === 3),
      "the redaction is on page 3",
    );
    await page.getByTestId("vw-more").click();
    await page.getByText("Save a redacted copy", { exact: true }).click();
    await page
      .getByText(/redacted\)\.pdf beside the original/)
      .waitFor({ timeout: 60_000 })
      .catch(async (e) => {
        console.log(
          "NOTE",
          await page
            .getByTestId("file-viewer-note")
            .innerText()
            .catch(() => "(none)"),
        );
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
    // a real extractor (pdf.js, in node) reads the copy: three pages, and not one word on any of them; the original gives its words
    const viaPdfjs = await pdfText(new Uint8Array(bytes));
    assert.equal(viaPdfjs.pages, 30, "the copy keeps its 30 pages");
    assert.equal(viaPdfjs.text.replace(/\s+/g, ""), "", "pdf.js extracts no text from the copy");
    const originalBytes = Buffer.from((await s.call("files.read", { fileId, as: "base64" })).base64, "base64");
    assert.match((await pdfText(new Uint8Array(originalBytes))).text, /Section 3 of the report/);
    const orig = await s.call("previews.text", { fileId });
    assert.match(orig.text, /Section 3 of the report/, "the original keeps its words");
    assert.deepEqual(s.errors, []);
  } finally {
    await s.close();
  }
});
