// @tsx
// A tap goes where it says (phone, 390 wide): You > Replies opens the Replies list, and a sidebar row tapped after going back to the Inbox ("By contact") ends on that row's list. The link in the address
// used to be applied by the middle pane when it first mounted, which on a phone is at the first sidebar tap: it took the tap away and ended on Replies.
import test from "node:test";
import assert from "node:assert/strict";
import { bootNav } from "./r32-nav-kit.test.ts";

test("phone: You > Replies opens Replies, and By contact after Back ends on By contact", async (t) => {
  const k = await bootNav({ width: 390, height: 844, scheme: "light", phone: true, tag: "phone-replies-tap" });
  if (!k) {
    t.skip("VYRE_APP_DIST required");
    return;
  }
  const { page } = k;
  try {
    await page.getByTestId("tab-you").click();
    await page.getByTestId("row-you-replies").click();
    const heads = (): Promise<string[]> =>
      page.evaluate(() =>
        [...document.querySelectorAll('[role="heading"]')].map((e) => (e as HTMLElement).innerText.trim()),
      );
    await page.waitForTimeout(1200);
    assert.deepEqual(await heads(), ["Replies"], "the Replies row opens Replies");
    await page.getByTestId("phone-back-to-inboxes").click();
    await page.getByTestId("row-nav:view:contact").first().waitFor({ timeout: 15_000 });
    await page.getByTestId("row-nav:view:contact").first().click();
    await page.waitForTimeout(1500);
    const after = await heads();
    assert.ok(after.includes("By contact"), `the tap opened By contact, the screen shows ${JSON.stringify(after)}`);
    assert.ok(!after.includes("Replies"), `and not Replies: ${JSON.stringify(after)}`);
  } finally {
    await k.close();
  }
});
