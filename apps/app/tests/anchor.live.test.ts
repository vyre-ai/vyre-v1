// A hover card sits by what it was asked from (owner, 13 Nov 2026: "I hover there and the menu pops up somewhere else"). In a real chat with enough messages to scroll, hover a message's time: the card must draw
// right under the time, not shifted by a pane's corner. The walk also names any ancestor that would make `position: fixed` measure from itself (transform, filter, perspective, contain, will-change).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { bootFreshSpace, claimOnEdge, edge, dismissOnboarding } from "./real-app-harness.test.ts";
import { guardCrashes } from "./crash-guard.ts";

const PASSWORD = "fixture password 123";
// the picture skin: paper (light) or graphite (dark); the pictures are named after it
const skin = process.env["VYRE_ANCHOR_SKIN"] === "graphite" ? "graphite" : "paper";
const tone = skin === "paper" ? "light" : "dark";

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
    let last = "";
    for (let i = 1; i <= 40; i++)
      last = (await call("chat.post", { threadId: thread, body: `Message number ${i} in the room` })).message
        .messageId as string;
    await page.goto(`${web.origin}/chat?skin=${skin}`, { waitUntil: "load" });
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
    await page.screenshot({ path: path.join(out, `time-card-chat-${tone}.png`), animations: "disabled" });
    assert.ok(
      Math.abs(r.card.left - r.trigger.left) <= 12,
      `the card is under the time horizontally: ${JSON.stringify(r)}`,
    );
    assert.ok(
      r.card.top >= r.trigger.bottom - 2 && r.card.top <= r.trigger.bottom + 14,
      `the card is right below the time: ${JSON.stringify(r)}`,
    );
    await guard.check("a message's time card");
    await page.keyboard.press("Escape");

    // the same class, every other card in the scrolled chat: drawn in the overlay layer or under no transform, and sitting by what opened it
    const rectOf = async (
      sel: string,
    ): Promise<{ left: number; top: number; right: number; bottom: number; blockers: string[] }> =>
      page.evaluate((q) => {
        const el = document.querySelector(q) as HTMLElement;
        const b = el.getBoundingClientRect();
        const blockers: string[] = [];
        for (let p = el.parentElement; p; p = p.parentElement) {
          const c = getComputedStyle(p);
          if (
            c.transform !== "none" ||
            c.filter !== "none" ||
            c.perspective !== "none" ||
            /paint|layout|strict|content/.test(c.contain)
          )
            blockers.push(`${p.tagName.toLowerCase()}[${p.getAttribute("data-testid") ?? ""}]`);
        }
        return { left: b.left, top: b.top, right: b.right, bottom: b.bottom, blockers };
      }, sel);
    const bySide = (
      name: string,
      trig: { left: number; top: number; right: number; bottom: number },
      card: { left: number; top: number; right: number; bottom: number; blockers: string[] },
    ): void => {
      // by its trigger: under it, over it, beside it, or (squeezed by the window's edge) over it: the card's box is within 24 px of the trigger's
      const near =
        card.left <= trig.right + 24 &&
        card.right >= trig.left - 24 &&
        card.top <= trig.bottom + 24 &&
        card.bottom >= trig.top - 24;
      assert.ok(near, `${name} sits by what opened it: trigger ${JSON.stringify(trig)}, card ${JSON.stringify(card)}`);
      assert.ok(
        card.right > 0 && card.bottom > 0 && card.left < 1600 && card.top < 900,
        `${name} is inside the window: ${JSON.stringify(card)}`,
      );
      assert.deepEqual(card.blockers, [], `${name} is under no transform that would move a fixed box`);
    };
    const lastRow = page.getByTestId(`msg-${last}`);
    await lastRow.hover();
    await page.getByTestId(`act-add-${last}`).waitFor({ timeout: 10_000 });
    const addAt = await rectOf(`[data-testid=act-add-${last}]`);
    await page.getByTestId(`act-add-${last}`).click();
    await page.getByTestId("reaction-picker").waitFor({ timeout: 10_000 });
    const pick = await rectOf("[data-testid=reaction-picker]");
    bySide("the reaction picker", addAt, pick);
    // never over what opened it: above the button when the window has no room below
    assert.ok(
      pick.top >= addAt.bottom - 2 || pick.bottom <= addAt.top + 2,
      `the picker does not cover its button: ${JSON.stringify({ addAt, pick })}`,
    );
    await page.screenshot({ path: path.join(out, `reaction-picker-${tone}.png`), animations: "disabled" });
    await page.keyboard.press("Escape");
    await page.mouse.move(5, 5);
    await lastRow.hover();
    await page.getByTestId(`act-more-${last}`).waitFor({ timeout: 10_000 });
    const moreAt = await rectOf(`[data-testid=act-more-${last}]`);
    await page.getByTestId(`act-more-${last}`).click();
    await page.getByTestId("menu").waitFor({ timeout: 10_000 });
    bySide("the message menu", moreAt, await rectOf("[data-testid=menu]"));
    await page.screenshot({ path: path.join(out, `message-menu-${tone}.png`), animations: "disabled" });
    await page.keyboard.press("Escape");
    const box = page.locator("textarea, [contenteditable=true]").last();
    for (const [key, tag] of [
      ["@", "mention menu"],
      ["/", "slash menu"],
    ] as const) {
      await box.click();
      await box.fill("");
      await box.type(key);
      await page.getByTestId("composer-popup").first().waitFor({ timeout: 10_000 });
      const trig = await page.evaluate(() => {
        const b = (
          document.querySelector("[data-testid=composer-popup]") as HTMLElement
        ).parentElement!.getBoundingClientRect();
        return { left: b.left, top: b.top, right: b.right, bottom: b.bottom };
      });
      const c = await rectOf("[data-testid=composer-popup]");
      assert.ok(
        c.bottom <= trig.bottom + 8 && c.right > 0 && c.left < 1600,
        `the ${tag} is inside the composer's area: ${JSON.stringify({ trig, c })}`,
      );
      assert.deepEqual(c.blockers, [], `the ${tag} is under no transform`);
      await page.screenshot({ path: path.join(out, `${tag.replace(" ", "-")}-${tone}.png`), animations: "disabled" });
      await page.keyboard.press("Escape");
    }
  } finally {
    await browser.close();
    web.close();
    await space.stop();
  }
});
