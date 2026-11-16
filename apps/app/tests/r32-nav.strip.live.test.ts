// @tsx
// Lane r32-nav, item 6 (desktop, 1440, dark): the picture faults of round two, walked in the dark scheme. A new tab shows a plus icon; the tab strip's fade follows the number of tabs (it is on the edge that has more
// behind it, after every tab opened and every tab closed); the tabs menu's "Find a tab" appears past 12 tabs and not before.
import test from "node:test";
import assert from "node:assert/strict";
import { bootNav } from "./r32-nav-kit.test.ts";
import type { Pg } from "./r32-nav-kit.test.ts";

const PLUS = "M8 3.5v9M3.5 8h9";

const stripState = (page: Pg): Promise<{ count: number; fade: string; truth: string; scrolls: boolean }> =>
  page.evaluate(() => {
    const strip = document.querySelector('[data-testid="tab-strip"]')!;
    const count = strip.querySelectorAll('[role="tab"]').length;
    const sc = [...strip.querySelectorAll("*")].find((e) => (e as HTMLElement).hasAttribute("data-tabfade")) as
      | HTMLElement
      | undefined;
    if (!sc) return { count, fade: "none", truth: "none", scrolls: false };
    const more = sc.scrollWidth - (sc.scrollLeft + sc.clientWidth);
    const left = sc.scrollLeft > 2;
    const right = more > 2;
    return {
      count,
      fade: sc.getAttribute("data-tabfade") ?? "",
      truth: left && right ? "both" : left ? "left" : right ? "right" : "none",
      scrolls: sc.scrollWidth > sc.clientWidth + 2,
    };
  });

test("tab strip, dark: a new tab shows a plus; the fade follows the tabs; Find a tab appears past 12", async (t) => {
  const k = await bootNav({ width: 1440, height: 900, scheme: "dark", tag: "strip-dark-1440" });
  if (!k) {
    t.skip("VYRE_APP_DIST required");
    return;
  }
  const { page, api, say, shot } = k;
  try {
    // a new tab shows a plus icon
    await page.keyboard.press("Control+t");
    await page.waitForTimeout(900);
    const selected = page.locator('[data-testid="tab-strip"] [role="tab"][aria-selected="true"]').first();
    const html = await selected.innerHTML();
    say(`new tab selected: ${await selected.getAttribute("aria-label")}`);
    await shot("new-tab-plus");
    assert.ok(html.includes(PLUS), "the new tab carries the plus icon");
    await page.keyboard.press("Escape");

    // many tabs, one at a time
    const mains: string[] = [];
    for (let i = 1; i <= 16; i++) {
      const c = (
        await api("channels.create", {
          name: `Room ${String(i).padStart(2, "0")} planning`,
          visibility: "public",
          memberIds: [],
          agentIds: [],
        })
      ).channel as { mainThreadId: string };
      mains.push(c.mainThreadId);
    }
    await page
      .getByTestId("rail-chats")
      .or(page.getByTestId("rail-chats-selected"))
      .first()
      .evaluate((el) => (el as HTMLElement).click());
    await page.waitForTimeout(1200);
    const find = async (picture?: string): Promise<number> => {
      await page.getByTestId("tab-strip-tabs").click();
      await page.waitForTimeout(500);
      const n = await page.getByPlaceholder("Find a tab").count();
      if (picture !== undefined) await shot(picture);
      await page.keyboard.press("Escape");
      await page.waitForTimeout(200);
      return n;
    };
    const rows: string[] = [];
    let sawFindAt = -1;
    let lastNoFind = -1;
    for (let i = 0; i < mains.length; i++) {
      await page.evaluate((h) => void (location.hash = h), `subject=thread:${mains[i]}`);
      await page.waitForTimeout(500);
      const st = await stripState(page);
      rows.push(`${st.count}:${st.fade}/${st.truth}`);
      assert.equal(st.fade, st.truth, `with ${st.count} tabs the fade is "${st.truth}" (it says "${st.fade}")`);
      if (st.count >= 10 && st.scrolls) {
        const has = await find(st.count === 13 ? "tabs-menu-find-a-tab" : undefined);
        if (has > 0 && sawFindAt < 0) sawFindAt = st.count;
        if (has === 0) lastNoFind = st.count;
      }
    }
    say(`fade per count: ${rows.join(" ")}; Find a tab first at ${sawFindAt}, last absent at ${lastNoFind}`);
    await shot("tabs-many");
    assert.ok(sawFindAt === 13, `Find a tab appears with the 13th tab (first seen at ${sawFindAt})`);
    assert.ok(lastNoFind <= 12, `and not before (absent up to ${lastNoFind})`);
    // closing tabs follows too
    for (let i = 0; i < 6; i++) {
      await page.keyboard.press("Control+w");
      await page.waitForTimeout(450);
      const st = await stripState(page);
      assert.equal(
        st.fade,
        st.truth,
        `after closing, with ${st.count} tabs the fade is "${st.truth}" (it says "${st.fade}")`,
      );
    }
    await shot("tabs-after-close");
    await page
      .getByTestId("tab-strip-tabs")
      .click({ timeout: 3000 })
      .catch(() => undefined);
    await shot("tabs-menu-dark");
  } finally {
    await k.close();
  }
});
