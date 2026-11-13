// Attach on the Computer tab shows the terminal in the same chat (owner, rc.26, 13 Nov 2026: it sent the tab to the landing page). Needs the production web export (VYRE_APP_DIST) and Chromium.
import test from "node:test";
import assert from "node:assert/strict";
import { shoot } from "./support/mail-browser.ts";
import { world } from "./support/computer-tab-world.ts";

const DIR = "shots-evidence/computer-tab-bugs";

test("B1 Attach shows the terminal in the chat's tab, never the new tab page", { timeout: 240_000 }, async (t) => {
  const k = await world(t);
  if (!k) return;
  try {
    await k.computerTab();
    await k.me.page.getByTestId("terminal-attach").waitFor({ timeout: 20_000 });
    await shoot(k.me.page, `${DIR}/b1`, "before-attach");
    await k.me.page.getByTestId("terminal-attach").click();
    // the terminal is shown, in the same tab: the page that opens is the terminal, not the new tab page
    const shown = await k.me.page.getByTestId("terminal-tab").first().waitFor({ timeout: 20_000 }).then(() => true, () => false);
    await shoot(k.me.page, `${DIR}/b1`, "after-attach");
    assert.equal(await k.me.page.getByTestId("newtab-page").count(), 0, "Attach did not land on the new tab page");
    assert.ok(shown, "the terminal is on screen after Attach");
    assert.equal(await k.me.page.getByTestId("composer-field").count(), 1, "the chat is still the page: Attach shows the terminal beside it");
    await k.guard.check("after Attach");
  } finally { await k.close(); }
});
