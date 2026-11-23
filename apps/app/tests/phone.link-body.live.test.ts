// @tsx
// A link that names a page opens that page on a phone, from the first frame, on every load and every compact width (lead ruling 24 Nov 2026): the Notes link `#screen=chats.notes` never draws
// the Chats list first and swaps it away (the first frame showed the list, then the page: a walk pressing "Notes & artifacts" lost its row to a detach). Back goes to the list; a bare address shows
// the list. Five loads at 390 and at 320.
import test from "node:test";
import assert from "node:assert/strict";
import { session } from "./viewers-harness.test.ts";

for (const width of [390, 320]) {
  test(`a link naming Notes opens Notes at once on a ${width} wide phone, five loads, and Back goes to the list`, async (t) => {
    const s = await session(t, { width, height: 844 }, "light");
    if (!s) return;
    const { page } = s;
    try {
      await page.addInitScript(() => {
        const w = window as unknown as { __list: number; __body: number };
        w.__list = 0;
        w.__body = 0;
        const look = (): void => {
          if (document.querySelector('[data-testid="notes-artifacts"]')) w.__body = 1;
          for (const e of document.querySelectorAll("span"))
            if (e.textContent === "Notes & artifacts" && !e.closest('[data-testid="notes-artifacts"]')) w.__list = 1;
        };
        new MutationObserver(look).observe(document, { childList: true, subtree: true, characterData: true });
      });
      for (let load = 1; load <= 5; load++) {
        await page.goto("about:blank"); // a fresh load each time, not a hash change
        await page.goto(`${s.web.origin}/chat#screen=chats.notes`, { waitUntil: "load" });
        await page.getByTestId("notes-artifacts").waitFor({ timeout: 30_000 });
        await page.waitForTimeout(1500);
        const seen = await page.evaluate(() => {
          const w = window as unknown as { __list: number; __body: number };
          return { list: w.__list, body: document.querySelector('[data-testid="notes-artifacts"]') ? 1 : w.__body };
        });
        assert.deepEqual(seen, { list: 0, body: 1 }, `load ${load} at ${width}: the list was drawn before the Notes page`);
        // a bare address is the list
        await page.goto(`${s.web.origin}/chat`, { waitUntil: "load" });
        await page.getByText("Notes & artifacts", { exact: true }).first().waitFor({ timeout: 30_000 });
        assert.equal(await page.getByTestId("notes-artifacts").count(), 0, `load ${load} at ${width}: a bare address opened a page`);
      }
    } finally {
      await s.close();
    }
  });
}
