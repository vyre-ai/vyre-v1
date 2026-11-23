// @tsx
// A tap on a record row (phone, 390 wide): the page that opens says the row's name in its very first frame. It used to say "Record" until the record had loaded. The title is read at every animation
// frame from the tap (a plain script, so no helper from the test transform leaks into the page).
import test from "node:test";
import assert from "node:assert/strict";
import { bootNav } from "./r32-nav-kit.test.ts";

test("phone Records: a tapped row's page never says Record, only its name", async (t) => {
  const k = await bootNav({ width: 390, height: 844, scheme: "light", phone: true, tag: "phone-records-tap" });
  if (!k) {
    t.skip("VYRE_APP_DIST required");
    return;
  }
  const { page, api } = k;
  try {
    for (const [i, name] of ["Northwind", "Harbor Studio", "Acme"].entries())
      await api("records.create", { type: "company", fields: { name }, idempotencyKey: `r41-co-${i}` });
    // a cold page: the record has not been read yet
    await page.reload({ waitUntil: "load" });
    await page.getByTestId("mobile-shell").waitFor({ timeout: 30_000 });
    await page.getByTestId("tab-records").click();
    const row = page.locator('[data-testid^="row-rec-"]').first();
    await row.waitFor({ timeout: 20_000 });
    const name = (await page.locator('[data-testid^="face-"]').first().getAttribute("data-testid"))!.slice(5);
    await page.evaluate(`(function () {
      window.__heads = [];
      window.__rec = true;
      function tick() {
        var els = document.querySelectorAll('[role="heading"]');
        for (var i = 0; i < els.length; i++) window.__heads.push(els[i].innerText.trim());
        if (window.__rec) requestAnimationFrame(tick);
      }
      requestAnimationFrame(tick);
    })()`);
    await row.click();
    await page.waitForFunction(
      `[...document.querySelectorAll('[role="heading"]')].some((e) => e.innerText.trim() === ${JSON.stringify(name)})`,
      null,
      { timeout: 10_000 },
    );
    await page.waitForTimeout(800);
    const seen = (await page.evaluate(`(function () { window.__rec = false; return window.__heads; })()`)) as string[];
    assert.ok(seen.includes(name), `the page said ${name}`);
    assert.deepEqual(
      seen.filter((x) => x === "Record" || x === "Loading"),
      [],
      "no placeholder title at any frame",
    );
  } finally {
    await k.close();
  }
});
