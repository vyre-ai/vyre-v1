// Consent to sign is a click in this view (24 Nov 2026). A browser can restore or autofill a form: the name it puts in the box is the signer's to see and is used, but a tick it restores is never taken as
// the signer's consent. The page clears it on load and whenever it is shown again, and Sign waits for the person's own tick (a real click, like the walks of sign-send and sign-phone).
// Needs VYRE_APP_DIST and Chromium (with VYRE_REQUIRE_CHROME=1 a missing one fails).
import test from "node:test";
import assert from "node:assert/strict";
import { linkOf, openSpace } from "./sign-kit.test.ts";

test("sign: a tick the browser restored is never consent; the name it restored is kept; Sign waits for the person's own click", async (t) => {
  const s = await openSpace(t, { width: 1440, height: 900 }, "light");
  if (!s) return;
  try {
    const { page } = s;
    await page.goto(`${s.web.origin}/files#subject=file:${s.fileId}`, { waitUntil: "load" });
    await page.getByTestId("vw-more").waitFor({ timeout: 40_000 });
    await page.getByTestId("vw-more").click();
    await page.getByText("Send for signature…").first().click();
    await page.getByTestId("sign-sheet").waitFor({ timeout: 10_000 });
    await page.getByTestId("sign-name-0").fill("Imran Ibarra");
    await page.getByTestId("sign-email-0").fill("imran@northwind.example");
    await page.getByTestId("sign-send").click();
    await page.getByTestId("sign-sheet-sent").waitFor({ timeout: 30_000 });
    const link = await linkOf(page, "Imran");
    const me = await s.signer({ width: 1440, height: 900 }, "light");
    await me.page.goto(`${s.web.origin}${link}`, { waitUntil: "load" });
    await me.page.locator(".page canvas").first().waitFor({ timeout: 30_000 });
    assert.equal(await me.page.locator("#signbtn").isDisabled(), true, "nothing is ticked yet: Sign waits");
    assert.equal(
      await me.page.locator("#consent").getAttribute("autocomplete"),
      "off",
      "browsers do not restore the tick",
    );
    // a restored page: the browser put a tick in the box (no event the page saw) and a name in the field, then shows the page again
    await me.page.evaluate(() => {
      (document.getElementById("nm") as HTMLInputElement).value = "Imran Ibarra";
      (document.getElementById("consent") as HTMLInputElement).checked = true;
      window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
    });
    assert.equal(await me.page.locator("#consent").isChecked(), false, "a restored tick is cleared");
    assert.equal(await me.page.locator("#signbtn").isDisabled(), true, "a restored tick does not enable Sign");
    // the person's own tick, a real click: now Sign is enabled for the name that is there
    await me.page.check("#consent");
    await me.page.locator("#signbtn:not([disabled])").waitFor({ timeout: 5_000 });
    // the page is shown again after the tick (back and forward): the tick is cleared once more, Sign waits again
    await me.page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true })));
    assert.equal(await me.page.locator("#consent").isChecked(), false, "the tick is the person's, in this view");
    assert.equal(await me.page.locator("#signbtn").isDisabled(), true);
    await me.page.check("#consent");
    await me.page.click("#signbtn");
    await me.page.getByText("Thank you, Imran").waitFor({ timeout: 30_000 });
    await me.ctx.close();
  } finally {
    await s.close();
  }
});
