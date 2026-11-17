// Records, schema map: no card lies over another, and every card's "Show more fields" button is hit by a pointer (17 Nov 2026: a Project card's row covered another card's button). Opens every card, checks by geometry.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { session } from "../apps/app/tests/viewers-harness.test.ts";

type Page = import("playwright-core").Page;
const OUT = process.env["VYRE_SCHEMA_SHOTS"] ?? "/tmp/vyre-schema-shots";

const CHECK = `(function(){
    var cards=[].slice.call(document.querySelectorAll('[data-testid^="schema-card-"]'));
    var out=[];
    var boxes=cards.map(function(c){return {id:c.getAttribute('data-testid'),r:c.getBoundingClientRect()}});
    for(var i=0;i<boxes.length;i++)for(var j=i+1;j<boxes.length;j++){var a=boxes[i].r,b=boxes[j].r;
      if(a.left<b.right-1&&b.left<a.right-1&&a.top<b.bottom-1&&b.top<a.bottom-1)out.push('overlap '+boxes[i].id+' '+boxes[j].id)}
    [].slice.call(document.querySelectorAll('[data-testid^="schema-card-"] [role="button"]')).forEach(function(m){
      var r=m.getBoundingClientRect();var cv=document.querySelector('[data-testid="schema-map"]').getBoundingClientRect();if(r.bottom>cv.bottom||r.top<cv.top||r.right>cv.right||r.left<cv.left)return;var e=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);
      var tid=m.getAttribute('data-testid');if(e&&e.closest&&e.closest('[data-testid="schema-minimap"],[aria-label^="Zoom"]'))return;if(!(e&&(e===m||m.contains(e)||(tid&&e.closest('[data-testid="'+tid+'"]'))))){var host=e&&e.closest&&e.closest('[data-testid^="schema-card-"]');out.push('covered '+(m.getAttribute('data-testid')||m.textContent)+' at '+Math.round(r.left)+','+Math.round(r.top)+' by '+(e?((e.getAttribute('data-testid')||e.tagName)+' in '+(host&&host.getAttribute('data-testid'))):'nothing')+' vw '+innerWidth+'x'+innerHeight+' el '+(e?(JSON.stringify(e.getBoundingClientRect())+' parent '+(e.parentElement&&(e.parentElement.getAttribute('data-testid')||e.parentElement.className))):''))}});
    return out;})()`;

async function check(page: Page, label: string): Promise<void> {
  assert.deepEqual(await page.evaluate(CHECK), [], label);
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
      // types like the ones that broke the map: many fields, long titles, and relations that draw "Linked from" rows on the other card
      const names = ["report", "ticket", "invoice", "site visit", "claim", "audit"];
      const ops = names.map((n, i) => ({
        op: "type.create",
        type: `rt_${n.replace(" ", "_")}`,
        def: {
          title: `${n[0]!.toUpperCase()}${n.slice(1)} of the quarterly review`,
          plural: `${n}s`,
          icon: "task",
          titleField: "name",
          fields: [
            { key: "name", type: "text", title: "Name", required: true },
            ...Array.from({ length: 14 + i * 4 }, (_, k) => ({
              key: `f${k}`,
              type: k % 5 === 0 ? "longtext" : "text",
              title: `A field title long enough to wrap onto a second line in a narrow card ${k}`,
            })),
          ],
        },
      }));
      await s.call("schema.apply", { ops, idempotencyKey: "schema-many" });
      const key = (n: string): string => `rt_${n.replace(" ", "_")}`;
      await s.call("schema.apply", {
        ops: names.flatMap((n, i) =>
          [
            ["reporter", "reporter_of", 1],
            ["related", "related_from", 2],
          ].map(([f, inverse, d]) => ({
            op: "relation.add",
            type: key(n),
            field: f,
            def: { to: key(names[(i + (d as number)) % names.length]!), inverse: `${inverse}_${i}` },
          })),
        ),
        idempotencyKey: "schema-many-links",
      });
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
      // rows that draw taller than any estimate, checked in the very task that changes them, before the page could have measured and re-laid anything: nothing may lie over anything
      const bad = await page.evaluate(
        `(function(){var st=document.createElement('style');st.textContent='[data-testid^="field-"]{min-height:44px !important}';document.head.appendChild(st);return (${CHECK.replace(/;\s*$/, "")})})()`,
      );
      assert.deepEqual(bad, [], "taller rows, before they are measured");
      await page.waitForTimeout(800);
      // the crawler's own sequence: every Show more pressed one after another with no pause, then every button hit-tested at once, on the next frame, and after things settle
      await page.evaluate(
        `(function(){[].slice.call(document.querySelectorAll('[data-testid^="schema-more-"]')).forEach(function(b){b.click()})})()`,
      );
      await check(page, "straight after opening every card");
      await page.evaluate("new Promise(function(r){requestAnimationFrame(function(){r(1)})})");
      await check(page, "one frame after");
      await page.waitForTimeout(1200);
      await check(page, "settled");
      // and one at a time, each pressed the moment the last returned
      for (const id of ids) {
        await page.getByTestId(id!).dispatchEvent("click");
        await check(page, `straight after closing ${id}`);
        await page.getByTestId(id!).dispatchEvent("click");
        await check(page, `straight after reopening ${id}`);
      }
      await page.screenshot({ path: `${OUT}/schema-opened-${tag}.png` });
      assert.deepEqual(s.errors, [], "no page errors");
    } finally {
      await s.close();
    }
  });
}
