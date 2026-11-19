// @tsx
// Lane r32-nav, items 3 and 4 (phone, 390 wide, light). Vault and Settings open on their LIST and Back goes list, then out; Settings has a door to the Console for an owner.
import test from "node:test";
import assert from "node:assert/strict";
import { bootNav } from "./r32-nav-kit.test.ts";
import type { Pg } from "./r32-nav-kit.test.ts";

const screens = (page: Pg): Promise<string> =>
  page.evaluate(() =>
    [...document.querySelectorAll('[data-testid^="screen-"]')].map((e) => e.getAttribute("data-testid")).join(","),
  );

test("phone: Vault and Settings open on their list, Back goes list then out; the Console door is for an owner", async (t) => {
  const k = await bootNav({ width: 390, height: 844, scheme: "light", phone: true, tag: "phone-light-390" });
  if (!k) {
    t.skip("VYRE_APP_DIST required");
    return;
  }
  const { page, say, shot } = k;
  try {
    const back = page.getByTestId("mobile-back");
    // Vault
    await page.getByTestId("tab-you").click();
    await page.getByTestId("row-you-vault").click();
    await page.getByTestId("vault-sidebar").waitFor({ timeout: 15_000 });
    await shot("vault-list-first");
    assert.equal(await page.getByTestId("vault-section-page").count(), 0, "no item list yet");
    await page.getByTestId("row-nav-logins").click();
    // wait for the list's own title: the first list-title on the page is sometimes the sidebar's or the previous screen's until the Logins list has drawn
    const logins = page.getByTestId("list-title").filter({ hasText: /^Logins/ });
    await logins.first().waitFor({ timeout: 10_000 });
    assert.match(await logins.first().innerText(), /^Logins/, "the row opens its own list");
    say(`vault logins: ${await screens(page)}`);
    await shot("vault-logins");
    assert.ok(
      (await page.getByTestId("list-title").count()) + (await page.getByText("Search").count()) > 0,
      "the list is drawn",
    );
    await back.click();
    await page.getByTestId("vault-sidebar").waitFor({ timeout: 10_000 });
    await shot("vault-back-to-list");
    await back.click();
    await page.getByTestId("you-screen").waitFor({ timeout: 10_000 });
    say("vault: Back went list, then out to You");
    // Settings
    await page.getByText("Settings", { exact: true }).first().click();
    await page.getByTestId("settings-search").waitFor({ timeout: 15_000 });
    await shot("settings-list-first");
    await page.getByTestId("row-open-console").waitFor({ timeout: 5_000 });
    await shot("settings-console-door-owner");
    await page.getByTestId("row-page-appearance").click();
    await page.getByTestId("page-appearance").waitFor();
    await shot("settings-page");
    await page.getByTestId("back").click();
    await page.getByTestId("settings-search").waitFor();
    await page.getByTestId("settings-leave").click();
    await page.getByTestId("you-screen").waitFor({ timeout: 10_000 });
    say("settings: Back went page, list, then out to You");
  } finally {
    await k.close();
  }
});
