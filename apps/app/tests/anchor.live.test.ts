// A hover card sits by what it was asked from (owner, 13 Nov 2026: "I hover there and the menu pops up somewhere else"). In a real chat with enough messages to scroll, hover a message's time: the card must draw
// right under the time, not shifted by a pane's corner. The walk also names any ancestor that would make `position: fixed` measure from itself (transform, filter, perspective, contain, will-change).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { bootFreshSpace, claimOnEdge, edge, dismissOnboarding } from "./real-app-harness.test.ts";
import { guardCrashes } from "./crash-guard.ts";

const PASSWORD = "fixture password 123";

test("a message's time card draws under the time, in a scrolled chat", async (t) => {
  const dist = process.env["VYRE_APP_DIST"];
  if (!dist) {
    t.skip("VYRE_APP_DIST required for production browser evidence");
    return;
  }
  const { chromium } = await import("playwright-core");
  const space = await bootFreshSpace();
  const web = await edge(dist, space.url);
  const browser = await chromium.launch({
    executablePath: process.env["CHROME_BIN"] || chromium.executablePath(),
    args: ["--no-sandbox"],
  });
  const out = process.env["VYRE_ANCHOR_SHOTS"] ?? "/tmp/vyre-anchor-shots";
  fs.mkdirSync(out, { recursive: true });
  try {
    const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
    const page = await ctx.newPage();
    const guard = guardCrashes(page);
    await page.goto(claimOnEdge(space.claim!, web.origin), { waitUntil: "load" });
    await page.getByTestId("claim-name").fill("Olivia Owner");
    await page.getByTestId("claim-username").fill("olivia");
    await page.getByTestId("claim-password").fill(PASSWORD);
    await page.getByTestId("claim-confirm").fill(PASSWORD);
    await page.getByTestId("claim-next").click();
    await page.getByTestId("claim-saved").click();
    await page.getByTestId("claim-create").click();
    await dismissOnboarding(page);
    await page.getByTestId("shell").waitFor({ timeout: 30_000 });
    const token = await page.evaluate(
      () => JSON.parse(localStorage.getItem("vyre.session.v1")!).sessions[location.origin].token as string,
    );
    let n = 0;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const call = async (cap: string, data: Record<string, unknown>): Promise<any> => {
      const r = await ctx.request.post(`${web.origin}/v1/${cap.replaceAll(".", "/")}`, {
        headers: { authorization: `Bearer ${token}` },
        data: { idempotencyKey: `an-${cap}-${++n}`, ...data },
      });
      const body = await r.json();
      assert.equal(r.status(), 200, `${cap}: ${JSON.stringify(body).slice(0, 300)}`);
      return body.data;
    };
    const ch = await call("channels.create", { name: "anchor-room", visibility: "public" });
    const thread = (ch.channel?.mainThreadId ?? ch.mainThreadId) as string;
    for (let i = 1; i <= 40; i++)
      await call("chat.post", { threadId: thread, body: `Message number ${i} in the room` });
    await page.goto(`${web.origin}/chat`, { waitUntil: "load" });
    await page.getByTestId("shell").waitFor({ timeout: 30_000 });
    await page.getByText("anchor-room", { exact: true }).first().click({ timeout: 30_000 });
    await page.getByText("Message number 40 in the room").first().waitFor({ timeout: 30_000 });
    const trigger = page.locator("[data-testid=time-pop] > *").last();
    await trigger.waitFor({ timeout: 20_000 });
    await trigger.scrollIntoViewIfNeeded();
    await trigger.hover();
    const card = page.getByTestId("time-pop-card");
    await card.waitFor({ timeout: 10_000 });
    const r = await page.evaluate(() => {
      const wrap = document.querySelectorAll("[data-testid=time-pop]");
      const el = wrap[wrap.length - 1]!.firstElementChild as HTMLElement;
      const c = document.querySelector("[data-testid=time-pop-card]") as HTMLElement;
      const tb = el.getBoundingClientRect(),
        cb = c.getBoundingClientRect();
      const blockers: string[] = [];
      for (let p = c.parentElement; p; p = p.parentElement) {
        const s = getComputedStyle(p);
        const why = [
          s.transform !== "none" ? `transform ${s.transform}` : "",
          s.filter !== "none" ? `filter ${s.filter}` : "",
          s.perspective !== "none" ? "perspective" : "",
          /paint|layout|strict|content/.test(s.contain) ? `contain ${s.contain}` : "",
          /transform|filter|perspective/.test(s.willChange) ? `will-change ${s.willChange}` : "",
        ].filter(Boolean);
        if (why.length)
          blockers.push(
            `${p.tagName.toLowerCase()}[${p.getAttribute("data-testid") ?? p.className.toString().slice(0, 40)}]: ${why.join(", ")}`,
          );
      }
      return {
        trigger: { left: tb.left, top: tb.top, bottom: tb.bottom },
        card: { left: cb.left, top: cb.top },
        blockers,
        inOverlay: !!c.closest("#vyre-overlay-root"),
      };
    });
    fs.writeFileSync(path.join(out, "time-card-measure.json"), JSON.stringify(r, null, 1));
    await page.screenshot({ path: path.join(out, "time-card-chat.png"), animations: "disabled" });
    assert.ok(
      Math.abs(r.card.left - r.trigger.left) <= 12,
      `the card is under the time horizontally: ${JSON.stringify(r)}`,
    );
    assert.ok(
      r.card.top >= r.trigger.bottom - 2 && r.card.top <= r.trigger.bottom + 14,
      `the card is right below the time: ${JSON.stringify(r)}`,
    );
    await guard.check("a message's time card");
  } finally {
    await browser.close();
    web.close();
    await space.stop();
  }
});
