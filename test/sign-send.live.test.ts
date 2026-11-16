// Send a PDF for signature from Files and watch it complete (owner, 17 Nov 2026: "he needs a working signing thing too"). A person opens the PDF, presses the pen, names two signers, presses Send, and is given each
// signer's link. Each signer opens their link in a browser with NO session, signs by typing, and the file's own status turns to Signed; the signed copy opens in the viewer. A used link says one sentence.
// Needs the production web export (VYRE_APP_DIST) and Chromium; with VYRE_REQUIRE_CHROME=1 (CI) it fails instead of skipping.
import test from "node:test";
import assert from "node:assert/strict";
import { linkOf, openSpace, shot, signByDrawing, signByTyping } from "./sign-kit.test.ts";

test("sign: send from the viewer, two signers sign without an account, the file turns Signed and the signed copy opens", async (t) => {
  const s = await openSpace(t, { width: 1440, height: 900 }, "dark");
  if (!s) return;
  try {
    const { page } = s;
    await page.goto(`${s.web.origin}/files#subject=file:${s.fileId}`, { waitUntil: "load" });
    await page.getByTestId("vw-sign").waitFor({ timeout: 40_000 });
    assert.equal(await page.getByTestId("sign-bar").count(), 0, "no request yet, so no status line");
    await page.getByTestId("vw-sign").click();
    await page.getByTestId("sign-sheet").waitFor({ timeout: 10_000 });
    await shot(page, s.shotsDir, "send-sheet-empty-dark");
    // an empty sheet says what is missing, in one sentence
    await page.getByTestId("sign-send").click();
    await page.getByTestId("sign-problem").waitFor({ timeout: 5_000 });
    assert.match(await page.getByTestId("sign-problem").innerText(), /Add the person who signs/);
    await page.getByTestId("sign-name-0").fill("Imran Ibarra");
    await page.getByTestId("sign-email-0").fill("imran@northwind.example");
    await page.getByTestId("sign-add").click();
    await page.getByTestId("sign-name-1").fill("Andrea Lindahl");
    await page.getByTestId("sign-message").fill("Please sign before Friday.");
    await shot(page, s.shotsDir, "send-sheet-filled-dark");
    await page.getByTestId("sign-send").click();
    await page.getByTestId("sign-sheet-sent").waitFor({ timeout: 30_000 });
    // the Space has no mailbox: the sheet says so in the server's words and still gives each link
    assert.match(await page.getByTestId("sign-mail-line").innerText(), /no sending mailbox|Emailed|Copy/i);
    const imranLink = await linkOf(page, "Imran");
    const andreaLink = await linkOf(page, "Andrea");
    assert.notEqual(imranLink, andreaLink);
    await shot(page, s.shotsDir, "send-sheet-sent-dark");
    await page.getByTestId("sign-copy-Imran").click();
    await page.getByTestId("sign-done").click();
    await page.getByTestId("sign-sheet-sent").waitFor({ state: "detached", timeout: 10_000 });
    // the file now says who it waits for
    await page.getByTestId("sign-bar").waitFor({ timeout: 20_000 });
    await page
      .getByText(/Waiting for Imran and Andrea/)
      .first()
      .waitFor({ timeout: 20_000 });
    await shot(page, s.shotsDir, "file-waiting-dark");

    // Imran: no session, the link only
    const imran = await s.signer({ width: 1440, height: 900 }, "dark");
    await imran.page.goto(`${s.web.origin}${imranLink}`, { waitUntil: "load" });
    assert.equal(
      await imran.page.evaluate(
        "(function(){try{return localStorage.getItem('vyre.session.v1')}catch(e){return null}})()",
      ),
      null,
      "the signer's browser holds no session",
    );
    await imran.page.locator(".page canvas").first().waitFor({ timeout: 30_000 });
    await shot(imran.page, s.shotsDir, "signer-first-dark");
    await signByTyping(imran.page, "Imran Ibarra", () => shot(imran.page, s.shotsDir, "signer-typed-dark"));
    await shot(imran.page, s.shotsDir, "signer-done-dark");
    // the link is spent: the same address now says one sentence and nothing else
    const again = await imran.ctx.newPage();
    await again.goto(`${s.web.origin}${imranLink}`, { waitUntil: "load" });
    await again.getByText("This link is not valid").waitFor({ timeout: 15_000 });
    assert.equal(
      await again
        .locator("body")
        .innerText()
        .then((x) => x.split("\n").filter((l) => l.trim() !== "").length),
      1,
      "one sentence and nothing else",
    );
    await shot(again, s.shotsDir, "signer-badlink-dark");
    await imran.ctx.close();

    // the file waits for Andrea only
    await page
      .getByText(/Waiting for Andrea/)
      .first()
      .waitFor({ timeout: 30_000 });

    // Andrea signs the other link
    const andrea = await s.signer({ width: 1440, height: 900 }, "dark");
    await andrea.page.goto(`${s.web.origin}${andreaLink}`, { waitUntil: "load" });
    await signByDrawing(andrea.page, "Andrea Lindahl", () => shot(andrea.page, s.shotsDir, "signer-drawn-dark"));
    await andrea.ctx.close();

    // the file's own status turns to Signed, and the signed copy opens in the viewer
    await page
      .getByText(/Signed on/)
      .first()
      .waitFor({ timeout: 45_000 });
    await shot(page, s.shotsDir, "file-signed-dark");
    await page.getByTestId("sign-bar-status-action").click();
    await page.getByText("Northwind NDA (signed).pdf").first().waitFor({ timeout: 30_000 });
    await page.getByTestId("file-viewer").waitFor({ timeout: 20_000 });
    // the pages are drawn: two pages of the original and the signature page with the audit trail
    await page.getByText("Opening the file").waitFor({ state: "detached", timeout: 30_000 });
    await page.getByText("/ 4").first().waitFor({ timeout: 30_000 });
    await shot(page, s.shotsDir, "signed-copy-open-dark");
    // the added signature page carries both marks; the last page is the audit trail
    await page.getByTestId("vw-page-input").fill("3");
    await page.getByTestId("vw-page-input").press("Enter");
    await page.waitForTimeout(1200);
    await shot(page, s.shotsDir, "signed-copy-signature-page-dark");
    await page.getByTestId("vw-page-input").fill("4");
    await page.getByTestId("vw-page-input").press("Enter");
    await page.waitForTimeout(1200);
    await shot(page, s.shotsDir, "signed-copy-audit-page-dark");
    assert.deepEqual(
      s.errors.filter((e) => !/net::ERR|favicon/i.test(e)),
      [],
      "no page errors",
    );
  } finally {
    await s.close();
  }
});
