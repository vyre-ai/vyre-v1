// The tab strip's More menu opens under the control that was pressed (owner, rc.26, 13 Nov 2026: it opened over the agent's name and Share). Needs the production web export (VYRE_APP_DIST) and Chromium.
import test from "node:test";
import assert from "node:assert/strict";
import { shoot } from "./support/mail-browser.ts";
import { world } from "./support/computer-tab-world.ts";

const DIR = "shots-evidence/computer-tab-bugs";

test("B4 the tab strip's More menu opens under the More control, inside the pane", { timeout: 240_000 }, async (t) => {
  const k = await world(t);
  if (!k) return;
  try {
    await k.computerTab();
    const more = k.me.page.getByLabel("More tabs", { exact: true }).first();
    await more.waitFor({ timeout: 20_000 });
    const at = (await more.boundingBox())!;
    await more.click();
    const menu = k.me.page.getByRole("menu").first();
    await menu.waitFor({ timeout: 10_000 });
    const box = (await menu.boundingBox())!;
    await shoot(k.me.page, `${DIR}/b4`, "more-menu");
    // under the control, within a few pixels sideways, and not above it
    assert.ok(
      box.y >= at.y + at.height - 2 && box.y <= at.y + at.height + 24,
      `menu top ${Math.round(box.y)} is not just under the control (${Math.round(at.y)}..${Math.round(at.y + at.height)})`,
    );
    assert.ok(
      box.x + box.width >= at.x - 4 && box.x <= at.x + at.width + 4,
      `menu x ${Math.round(box.x)}..${Math.round(box.x + box.width)} is not at the control ${Math.round(at.x)}..${Math.round(at.x + at.width)}`,
    );
  } finally {
    await k.close();
  }
});
