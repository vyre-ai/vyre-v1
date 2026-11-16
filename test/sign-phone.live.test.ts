// Signing on a phone, both ends, light (owner, 17 Nov 2026). The sender's phone: open the PDF, the More menu has Send for signature, one sheet, the link to copy. The signer's phone (390 wide, only the link):
// read the document, sign by typing with the keyboard alone, get a calm done state and the signed copy to download; and the sender's file turns Signed. Needs VYRE_APP_DIST and Chromium.
import test from "node:test";
import assert from "node:assert/strict";
import { linkOf, openSpace, shot, signByDrawing } from "./sign-kit.test.ts";

const PHONE = { width: 390, height: 844 };

test("sign on a phone: send from the phone, the link alone is enough to sign by keyboard, the copy downloads, the file turns Signed", async (t) => {
  const s = await openSpace(t, PHONE, "light");
  if (!s) return;
  try {
    const { page } = s;
    await page.goto(`${s.web.origin}/files#subject=file:${s.fileId}`, { waitUntil: "load" });
    await page.getByTestId("vw-more").waitFor({ timeout: 40_000 });
    await page.getByTestId("vw-more").click();
    await page.getByText("Send for signature…").first().click();
    await page.getByTestId("sign-sheet").waitFor({ timeout: 10_000 });
    await shot(page, s.shotsDir, "send-sheet-empty-light-phone");
    await page.getByTestId("sign-name-0").fill("Imran Ibarra");
    await page.getByTestId("sign-email-0").fill("imran@northwind.example");
    await page.getByTestId("sign-add").click();
    await page.getByTestId("sign-name-1").fill("Andrea Lindahl");
    await page.getByTestId("sign-message").fill("Please sign before Friday.");
    await shot(page, s.shotsDir, "send-sheet-filled-light-phone");
    await page.getByTestId("sign-send").click();
    await page.getByTestId("sign-sheet-sent").waitFor({ timeout: 30_000 });
    const path = await linkOf(page, "Imran");
    const andreaPath = await linkOf(page, "Andrea");
    assert.match(path, /^\/p\/sign\/[A-Za-z0-9_-]{43}\/$/);
    await shot(page, s.shotsDir, "send-sheet-sent-light-phone");
    await page.getByTestId("sign-done").click();
    await page.getByText("Waiting for Imran and Andrea").first().waitFor({ timeout: 20_000 });
    await shot(page, s.shotsDir, "file-waiting-light-phone");

    const me = await s.signer(PHONE, "light");
    await me.page.goto(`${s.web.origin}${path}`, { waitUntil: "load" });
    await me.page.locator(".page canvas").first().waitFor({ timeout: 30_000 });
    await shot(me.page, s.shotsDir, "signer-first-light-phone");
    // no sideways scroll at 390
    assert.equal(
      await me.page.evaluate("document.documentElement.scrollWidth <= document.documentElement.clientWidth"),
      true,
      "no horizontal scroll",
    );
    // keyboard only: the name, the Type tab, the consent box with Space, Sign with Enter
    await me.page.focus("#nm");
    await me.page.keyboard.press("Tab"); // the Type tab
    await me.page.keyboard.press("Tab"); // Draw and Clear are out of the order in Type mode: the consent box is next
    assert.equal(await me.page.evaluate("document.activeElement && document.activeElement.id"), "consent");
    await me.page.keyboard.press("Space");
    assert.equal(await me.page.locator("#consent").isChecked(), true);
    await shot(me.page, s.shotsDir, "signer-typed-light-phone");
    await me.page.keyboard.press("Tab");
    assert.equal(await me.page.evaluate("document.activeElement && document.activeElement.id"), "signbtn");
    await me.page.keyboard.press("Enter");
    await me.page.getByText("Thank you, Imran").waitFor({ timeout: 30_000 });
    // not the last signer: a calm done state that says the copy waits for the others, and a way to look again
    await me.page.getByText(/as soon as everyone has signed/).waitFor({ timeout: 15_000 });
    await me.page.getByText("Check for the signed copy").click();
    await me.page.getByText("Not everyone has signed yet.").waitFor({ timeout: 15_000 });
    await shot(me.page, s.shotsDir, "signer-done-light-phone");
    // the link is spent: one sentence on a phone too
    const again = await me.ctx.newPage();
    await again.goto(`${s.web.origin}${path}`, { waitUntil: "load" });
    await again.getByText("This link is not valid").waitFor({ timeout: 15_000 });
    await shot(again, s.shotsDir, "signer-badlink-light-phone");
    // Andrea draws hers with a finger's stand-in, the pointer
    const her = await s.signer(PHONE, "light");
    await her.page.goto(`${s.web.origin}${andreaPath}`, { waitUntil: "load" });
    await signByDrawing(her.page, "Andrea Lindahl", () => shot(her.page, s.shotsDir, "signer-drawn-light-phone"));
    // the last signer gets the whole signed copy
    await her.page.locator("#dl").waitFor({ timeout: 30_000 });
    await shot(her.page, s.shotsDir, "signer-copy-light-phone");
    const [download] = await Promise.all([her.page.waitForEvent("download"), her.page.click("#dl")]);
    assert.match(download.suggestedFilename(), /\(signed\)\.pdf$/);

    // the sender's file turns Signed
    await page
      .getByText(/Signed on/)
      .first()
      .waitFor({ timeout: 45_000 });
    await shot(page, s.shotsDir, "file-signed-light-phone");
    assert.deepEqual(
      s.errors.filter((e) => !/net::ERR|favicon/i.test(e)),
      [],
      "no page errors",
    );
  } finally {
    await s.close();
  }
});
