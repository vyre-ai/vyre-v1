// @tsx
// A tap goes where it says on a phone (390 wide): there is no double tap, so one tap on a form in the Apps list opens it. It used to only select the row (opening was a double tap).
import test from "node:test";
import assert from "node:assert/strict";
import { bootNav } from "./r32-nav-kit.test.ts";

const SCREEN = `(document.querySelector('[data-testid^="screen-"]') || { innerText: "" }).innerText`;

test("phone Apps: a tap on a form in the list opens it", async (t) => {
  const k = await bootNav({ width: 390, height: 844, scheme: "light", phone: true, tag: "phone-apps-tap" });
  if (!k) {
    t.skip("VYRE_APP_DIST required");
    return;
  }
  const { page, api } = k;
  try {
    await api("forms.create", {
      name: "Contact us",
      recordType: "contact",
      kind: "public",
      idempotencyKey: "r41-form",
    });
    await page.reload({ waitUntil: "load" });
    await page.getByTestId("mobile-shell").waitFor({ timeout: 30_000 });
    await page.getByTestId("tab-you").click();
    await page.getByTestId("row-you-apps").click();
    await page.locator('[data-testid^="row-nav:frm_"]').first().click();
    // the group's list is on show (New form is its button)
    await page.getByTestId("apps-title").waitFor({ timeout: 10_000 });
    assert.match(await page.evaluate(SCREEN), /New form/, "the list of forms");
    // a person takes a moment to read the list: well over the double-tap window, so this tap is a tap on its own
    await page.waitForTimeout(1000);
    await page.locator('[data-testid^="row-frm_"]:not([data-testid$="-trailing"])').first().click();
    await page.waitForFunction(`!(${SCREEN}).includes("New form")`, null, { timeout: 10_000 });
  } finally {
    await k.close();
  }
});
