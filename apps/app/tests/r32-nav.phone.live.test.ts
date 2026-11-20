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
    // the list's title at every animation frame from the tap: nothing but Logins may ever show under the new row's name (the old selection used to show for a frame or two)
    // in-page code is a plain string: a named function inside a callback gets the transform's __name helper, which does not exist in the page (it failed on the CI runner)
    await page.evaluate(`(function () {
      window.__titles = [];
      window.__rec = true;
      function tick() {
        var els = document.querySelectorAll('[data-testid="list-title"]');
        for (var i = 0; i < els.length; i++) window.__titles.push(els[i].innerText.trim());
        if (window.__rec) requestAnimationFrame(tick);
      }
      requestAnimationFrame(tick);
    })()`);
    await page.getByTestId("row-nav-logins").click();
    // the first list-title on the page must be the Logins list's: wait (retrying) until it says so, and fail with what it said if it never does
    const title = page.getByTestId("list-title").first();
    await title.waitFor({ timeout: 10_000 });
    await page
      .waitForFunction(
        `/^Logins/.test((document.querySelector('[data-testid="list-title"]') || { innerText: "" }).innerText)`,
        null,
        { timeout: 10_000 },
      )
      .catch(() => undefined);
    assert.match(await title.innerText(), /^Logins/, "the row opens its own list");
    await page.waitForTimeout(500);
    const seen = (await page.evaluate(`(function () { window.__rec = false; return window.__titles; })()`)) as string[];
    assert.ok(seen.length > 0, "the title was seen");
    assert.deepEqual(
      seen.filter((x) => !/^Logins/.test(x)),
      [],
      "no frame showed another list's title after the tap",
    );
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
