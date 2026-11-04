// A card that hangs under a control stays inside the window (owner, 5 Nov, rc.21 on MLA: "All agents" opened from a low sidebar row ran off the bottom of a 1440x900 window).
// Real app in Chromium at 1440x900 and 1280x720: with more agents than the sidebar shows, the "All agents (N)" row sits low in the list; pressing it opens the card, which must lie fully
// inside the window with the window's padding. Shot in both skins. Needs the production web export (VYRE_APP_DIST) and Chromium; with VYRE_REQUIRE_CHROME=1 (CI) it fails instead of skipping.
import test from "node:test";
import assert from "node:assert/strict";
import { guardCrashes } from "../apps/app/tests/crash-guard.ts";
import { bootScreens, browserOrSkip, open, seat, shoot } from "./support/mail-browser.ts";

const OUT = "shots-evidence/popover-fit";
const VIEWS = [{ width: 1440, height: 900 }, { width: 1280, height: 720 }] as const;

test("the All agents card opened from a low sidebar row stays fully inside the window", async (t) => {
  const env = await browserOrSkip();
  if (typeof env === "string") { t.skip(env); return; }
  const s = await bootScreens({ kind: "team" }, env);
  try {
    const w = s.world;
    for (let n = 0; n < 12; n++) await w.owner.ok("agents.create", { name: `Agent ${String.fromCharCode(65 + n)}`, role: "You help.", idempotencyKey: `pf-a${n}` });
    const me = await seat(s, w.owner, "Owner");
    const guard = guardCrashes(me.page);
    for (const view of VIEWS) {
      await me.page.setViewportSize(view);
      await open(me, s, "/chat");
      await me.page.waitForTimeout(3000);
      console.log("SIDEBAR " + JSON.stringify((await me.page.getByTestId("chats-sidebar").innerText()).slice(0, 900)));
      const row = me.page.getByText(/^All agents \(\d+\)/).first();
      await row.waitFor({ timeout: 20_000 });
      await row.click();
      const card = me.page.getByTestId("all-agents");
      await card.waitFor({ timeout: 15_000 });
      await me.page.waitForTimeout(600);   // measured, then placed
      const box = await card.boundingBox();
      assert.ok(box !== null, "the card is on screen");
      assert.ok(box!.y >= 8 - 1, `top ${box!.y} is inside the window (${view.width}x${view.height})`);
      assert.ok(box!.y + box!.height <= view.height - 8 + 1, `bottom ${Math.round(box!.y + box!.height)} is inside the window (${view.width}x${view.height})`);
      assert.ok(box!.x >= 8 - 1 && box!.x + box!.width <= view.width - 8 + 1, "and inside it sideways");
      assert.equal(await me.page.getByTestId("layer-close").isVisible(), true, "its Close button is reachable");
      await guard.check(`All agents at ${view.width}x${view.height}`);
      await shoot(me.page, OUT, `all-agents-${view.width}x${view.height}`);
      await me.page.keyboard.press("Escape");
      await card.waitFor({ state: "detached", timeout: 10_000 });
    }
    await guard.check("end of the walk");
    assert.deepEqual(me.errors, [], "no page errors");
  } finally { await s.close(); }
});
