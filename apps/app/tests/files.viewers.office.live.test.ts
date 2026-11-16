// A scan and a Word file in the Files viewer as the real thing (16 Nov 2026, the viewers walk split to stay under its time cap): a scan with no text layer says so, and a Word file is drawn, edited and saved back unchanged elsewhere. Pictures go to VYRE_VIEWER_SHOTS.
import test from "node:test";
import assert from "node:assert/strict";
import { session } from "./viewers-harness.test.ts";
import { makeDocx, makePdf, unzip } from "./viewer-fixtures.ts";

const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

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

test("a Word file is drawn as its page, a word is edited and saved back, and everything else in the file is the same", async (t) => {
  const s = await session(t);
  if (!s) return;
  const { page } = s;
  try {
    const original = makeDocx();
    const f = await s.make("plan.docx", original, DOCX);
    const fileId = f.file.fileId as string;
    await s.open("plan.docx");
    await page.getByTestId("vww").waitFor({ timeout: 30_000 });
    assert.match(await page.getByTestId("vww-header").innerText(), /Sample company report/);
    assert.match(await page.getByTestId("vww-footer").innerText(), /Confidential sample/);
    assert.match(await page.getByTestId("vww-footnotes").innerText(), /Figures are estimates/);
    assert.equal(await page.getByTestId("vww-table").locator("td").count(), 4);
    assert.equal(await page.getByTestId("vww-img").count(), 1);
    const head = page.locator('[data-pid="d0"]');
    assert.equal(await head.evaluate((e) => getComputedStyle(e).fontWeight), "700");
    assert.equal(await page.locator('a[href="https://example.com/sample"]').count(), 1);
    await s.shot("docx-open");
    // find marks the words on the page
    await page.getByTestId("vw-find-btn").click();
    await page.getByTestId("vw-find-input").fill("quarter");
    await page.waitForFunction(() => document.querySelectorAll("mark.vwf").length >= 2, null, { timeout: 10_000 });
    await s.shot("docx-find");
    await page.getByTestId("vw-find-input").fill("");
    await page.getByTestId("vw-find-btn").click();
    // a comment on a passage and a highlight, through the viewer's own selection bar
    await page.locator('[data-pid="d2"] [data-r="0"]').dblclick();
    await page.getByTestId("vw-sel-highlight").click();
    await page.waitForFunction(() => !!document.querySelector('[data-hlt="1"]'), null, { timeout: 10_000 });
    await page.locator('[data-pid="d4"] [data-r="0"]').dblclick();
    await page.getByTestId("vw-sel-comment").click();
    await page.getByTestId("vw-pick-input").fill("Check this goal");
    await page.getByTestId("vw-pick-post").click();
    await page.waitForFunction(() => !!document.querySelector('[data-testid^="vw-comment-"]'), null, {
      timeout: 10_000,
    });
    const cm = (await s.call("files.comments.list", { fileId })).comments.find(
      (x: any) => x.text === "Check this goal",
    );
    assert.ok(cm?.anchor.quote, "the comment is anchored to the words selected");
    await s.shot("docx-comment");
    // edit: a word is replaced
    await page.getByTestId("vw-mode-edit").click();
    const tracked = page.locator('[data-ro="1"]');
    assert.equal(
      await tracked.first().getAttribute("contenteditable"),
      "false",
      "a paragraph with a tracked change is not edited",
    );
    const p1 = page.locator('[data-pid="d1"] [data-r="1"]');
    await p1.dblclick();
    await page.keyboard.type("coming");
    await s.shot("docx-edit");
    const nt = await page
      .getByTestId("file-viewer-note")
      .waitFor({ timeout: 4000 })
      .then(() => page.getByTestId("file-viewer-note").innerText())
      .catch(() => "(no note)");
    console.log("NOTE-AFTER-EDIT", nt);
    console.log(
      "FFLATE",
      await page.evaluate(() => {
        try {
          const f = (window as any).fflate;
          const z = f.zipSync({ "a.xml": [new Uint8Array([1, 2]), { level: 6, mtime: 0 }] });
          return "ok " + z.length;
        } catch (e: any) {
          return "ERR " + e.message;
        }
      }),
    );
    await page
      .waitForFunction(() => /v2/.test(document.querySelector('[data-testid="vw-saved"]')?.textContent ?? ""), null, {
        timeout: 20_000,
      })
      .catch(async (e) => {
        console.log(
          "NOTE",
          await page
            .getByTestId("file-viewer-note")
            .innerText()
            .catch(() => "(none)"),
          "SAVED",
          await page
            .getByTestId("vw-saved")
            .innerText()
            .catch(() => "(none)"),
        );
        throw e;
      });
    const out = unzip(Buffer.from((await s.call("files.read", { fileId, as: "base64" })).base64, "base64"));
    const was = unzip(original);
    for (const k of Object.keys(was))
      if (k !== "word/document.xml") assert.deepEqual(out[k], was[k], `${k} is the file's own bytes`);
    const docXml = new TextDecoder().decode(out["word/document.xml"]!);
    assert.match(docXml, /coming/, docXml.slice(docXml.indexOf("This plan") - 80, docXml.indexOf("This plan") + 400));
    assert.match(docXml, /<w:ins w:id="5"/, "the tracked change is kept");
    assert.match(docXml, /<w:drawing>/, "the picture is kept");
    // reopen: the change is there
    await s.open("plan.docx");
    await page.getByTestId("vww").waitFor({ timeout: 30_000 });
    assert.match(await page.getByTestId("vww-card").innerText(), /coming/);
    assert.deepEqual(s.errors, []);
  } finally {
    await s.close();
  }
});
