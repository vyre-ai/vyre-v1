// The signer's Sign button follows what is in the card, not only the events the page saw (24 Nov 2026: in one CI run the button stayed disabled for 30 s on a page whose name and consent were set).
// A browser can restore or autofill a form without the page seeing a change event: the page reads its controls again when it is shown, and the button is enabled for a name and a consent that are there.
// Needs VYRE_APP_DIST and Chromium (with VYRE_REQUIRE_CHROME=1 a missing one fails).
import test from "node:test";
import assert from "node:assert/strict";
import { linkOf, openSpace } from "./sign-kit.test.ts";

test("sign: a card whose name and consent were set without an event has an enabled Sign button once the page is shown", async (t) => {
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
    // a restored or autofilled form: the controls hold the values, the page saw no event
    await me.page.evaluate(() => {
      (document.getElementById("nm") as HTMLInputElement).value = "Imran Ibarra";
      (document.getElementById("consent") as HTMLInputElement).checked = true;
    });
    assert.equal(await me.page.locator("#signbtn").isDisabled(), true, "no event yet: the page has not looked");
    await me.page.evaluate(() => window.dispatchEvent(new Event("pageshow")));
    await me.page.locator("#signbtn:not([disabled])").waitFor({ timeout: 5_000 });
    await me.page.click("#signbtn");
    await me.page.getByText("Thank you, Imran").waitFor({ timeout: 30_000 });
    await me.ctx.close();
  } finally {
    await s.close();
  }
});
