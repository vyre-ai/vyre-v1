// A deck in the Files viewer as the real thing (16 Nov 2026, the viewers walk split to stay under its time cap): slides with a filmstrip, find, a comment on a slide, present, and an edited word saved back. Pictures go to VYRE_VIEWER_SHOTS.
import test from "node:test";
import assert from "node:assert/strict";
import { session } from "./viewers-harness.test.ts";
import { makePptx, unzip } from "./viewer-fixtures.ts";

const PPTX = "application/vnd.openxmlformats-officedocument.presentationml.presentation";

test("a deck is drawn as slides with a filmstrip, find, a comment on a slide, present, and an edited word saved back", async (t) => {
  const s = await session(t);
  if (!s) return;
  const { page } = s;
  try {
    const original = makePptx();
    const f = await s.make("review.pptx", original, PPTX);
    const fileId = f.file.fileId as string;
    await s.open("review.pptx");
    await page.getByTestId("vws").waitFor({ timeout: 30_000 });
    assert.equal(await page.getByTestId("vws").getAttribute("data-slides"), "3");
    assert.equal(await page.getByTestId("vws-count").innerText(), "Slide 1 of 3");
    await s.shot("pptx-open");
    await page.getByTestId("vws-thumb-2").click();
    await page.getByText("Revenue grew in every region").first().waitFor({ timeout: 10_000 });
    const box = page.locator('[data-testid="vws-slide-2"] .vws-sh').nth(2);
    assert.equal(
      await box.evaluate((e) => getComputedStyle(e).backgroundColor),
      "rgb(79, 129, 189)",
      "a shape's fill is drawn",
    );
    await page.getByTestId("vws-thumb-3").click();
    await page.getByText("12 percent").first().waitFor();
    assert.equal((await page.getByTestId("vws-img").count()) >= 1, true, "the picture is drawn");
    // find across slides steps into the slide with the match
    await page.getByTestId("vw-find-btn").click();
    await page.getByTestId("vw-find-input").fill("hiring");
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="vws"] mark.vwf').length >= 1, null, {
      timeout: 10_000,
    });
    assert.equal(await page.getByTestId("vws").getAttribute("data-current"), "2");
    await s.shot("pptx-find");
    await page.getByTestId("vw-find-input").fill("");
    // a comment pinned on the slide
    await page.getByTestId("vw-tool-comment").click();
    const sb = await page.locator('.vws-stage [data-testid="vws-slide-2"]').boundingBox();
    assert.ok(sb);
    await page.mouse.move(sb.x + sb.width * 0.1, sb.y + sb.height * 0.3);
    await page.mouse.down();
    await page.mouse.move(sb.x + sb.width * 0.5, sb.y + sb.height * 0.5, { steps: 5 });
    await page.mouse.up();
    await page.getByTestId("vwp-note-input").fill("Add the source");
    await page.getByTestId("vwp-note-input").press("Enter");
    await page.getByTestId("vwp-pin-1").waitFor({ timeout: 10_000 });
    const c = (await s.call("files.comments.list", { fileId })).comments.find((x: any) => x.text === "Add the source");
    assert.equal(c?.anchor.page, 2, "the comment is pinned to slide 2");
    await page.getByTestId("vw-tool-comment").click();
    // present: full screen, arrows
    await page.getByTestId("vws-present").click();
    await page.getByTestId("vws-full").waitFor();
    await page.keyboard.press("ArrowRight");
    await page.waitForFunction(() => document.querySelector('[data-testid="vws-full"] [data-testid="vws-slide-3"]'));
    await page.keyboard.press("Escape");
    // edit a word
    await page.getByTestId("vws-thumb-2").click();
    await page.getByTestId("vw-mode-edit").click();
    const target = page.locator('[data-testid="vws-slide-2"] p', { hasText: "Costs stayed flat" }).locator("[data-r]");
    await target.click({ clickCount: 3 });
    await page.keyboard.type("Costs fell slightly");
    await page.waitForFunction(
      () => /v2/.test(document.querySelector('[data-testid="vw-saved"]')?.textContent ?? ""),
      null,
      { timeout: 20_000 },
    );
    const out = unzip(Buffer.from((await s.call("files.read", { fileId, as: "base64" })).base64, "base64"));
    const was = unzip(original);
    for (const k of Object.keys(was))
      if (k !== "ppt/slides/slide2.xml") assert.deepEqual(out[k], was[k], `${k} is the file's own bytes`);
    assert.match(new TextDecoder().decode(out["ppt/slides/slide2.xml"]!), /Costs fell slightly/);
    assert.deepEqual(s.errors, []);
  } finally {
    await s.close();
  }
});
