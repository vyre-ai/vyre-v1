// Records, schema map: no card lies over another, and every card's "Show more fields" button is hit by a pointer (17 Nov 2026: a Project card's row covered another card's button). Opens every card, checks by geometry.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { session } from "../apps/app/tests/viewers-harness.test.ts";

type Page = import("playwright-core").Page;
const OUT = process.env["VYRE_SCHEMA_SHOTS"] ?? "/tmp/vyre-schema-shots";

async function check(page: Page, label: string): Promise<void> {
  const bad = await page.evaluate(`(function(){
    var cards=[].slice.call(document.querySelectorAll('[data-testid^="schema-card-"]'));
    var out=[];
    var boxes=cards.map(function(c){return {id:c.getAttribute('data-testid'),r:c.getBoundingClientRect()}});
    for(var i=0;i<boxes.length;i++)for(var j=i+1;j<boxes.length;j++){var a=boxes[i].r,b=boxes[j].r;
      if(a.left<b.right-1&&b.left<a.right-1&&a.top<b.bottom-1&&b.top<a.bottom-1)out.push('overlap '+boxes[i].id+' '+boxes[j].id)}
    [].slice.call(document.querySelectorAll('[data-testid^="schema-more-"]')).forEach(function(m){
      var r=m.getBoundingClientRect();var e=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);
      if(!(e&&(e===m||m.contains(e))))out.push('covered '+m.getAttribute('data-testid'))});
    return out;})()`);
  assert.deepEqual(bad, [], label);
}

for (const [tag, size, scheme] of [
  ["dark", { width: 1440, height: 900 }, "dark"],
  ["light", { width: 1024, height: 768 }, "light"],
] as const) {
  test(`schema map ${tag}: no card overlaps another and every Show more button is reachable, closed and opened`, async (t) => {
    const s = await session(t, size, scheme);
    if (!s) return;
    try {
      fs.mkdirSync(OUT, { recursive: true });
      const { page } = s;
      await page.goto(`${s.web.origin}/records#screen=records.schema-map`, { waitUntil: "load" });
      await page.getByTestId("schema-world").waitFor({ timeout: 40_000 });
      await page.locator('[data-testid^="schema-card-"]').first().waitFor({ timeout: 20_000 });
      await page.waitForTimeout(1200);
      // the map may be zoomed to fit: look at it at full size by zooming to 1 would move cards; geometry is checked as drawn
      await check(page, "closed");
      await page.screenshot({ path: `${OUT}/schema-closed-${tag}.png` });
      const ids = await page
        .locator('[data-testid^="schema-more-"]')
        .evaluateAll((els) => els.map((e) => e.getAttribute("data-testid")));
      assert.ok(ids.length >= 3, "the seeded Space has several cards with more fields");
      for (const id of ids) {
        await page.getByTestId(id!).dispatchEvent("click");
        await page.waitForTimeout(250);
        await check(page, `after opening ${id}`);
      }
      await page.screenshot({ path: `${OUT}/schema-opened-${tag}.png` });
      assert.deepEqual(s.errors, [], "no page errors");
    } finally {
      await s.close();
    }
  });
}
