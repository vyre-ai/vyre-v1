// Lane r41-kanban: pictures of the real Kanban board beside the prototype's frames (vyre-v1.html#records,at:kanban[.drag|.gate|.fields|.lanes|.face|.sel|.big|.visual]). Exports the shots app once, serves it,
// and for each scene opens the R41_02 mount and presses what the scene needs, in paper and graphite at the wide size (a few at the phone size).
//   node scripts/shots/r41-kanban-shoot.mjs [out-dir] [--skip-export] [--only=board,drag] [--size=wide|phone]
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
const REPO = process.cwd();
const { serve } = await import(path.join(REPO, "scripts/shots/serve.mjs"));
const { routeUrl } = await import(path.join(REPO, "scripts/shots/lib.mjs"));
const { exportEnv } = await import(path.join(REPO, "scripts/lib/registry-hash.mjs"));
const appDir = path.join(REPO, "scripts/shots/app");
const args = process.argv.slice(2);
const out = args.find((a) => !a.startsWith("--")) || "/root/wt/tmp-r41-kanban/shots";
const only = (args.find((a) => a.startsWith("--only=")) ?? "").slice(7).split(",").filter(Boolean);
const sizeOnly = (args.find((a) => a.startsWith("--size=")) ?? "").slice(7);
if (!args.includes("--skip-export")) {
  fs.rmSync(path.join(appDir, "dist"), { recursive: true, force: true });
  execSync((await import(path.join(REPO, "scripts/shots/expo-cmd.mjs"))).exportCmd(REPO), {
    cwd: appDir,
    stdio: "inherit",
    env: exportEnv(),
  });
}
fs.mkdirSync(out, { recursive: true });
const SIZES = { wide: { width: 1440, height: 900 }, phone: { width: 390, height: 844 } };
const tid = (id) => `[data-testid="${id}"]`;
const click = async (page, id) => {
  await page.locator(tid(id)).first().click({ timeout: 8000 });
  await page.waitForTimeout(250);
};
const dragTo = async (page, card, lane, hold) => {
  const a = await page
    .locator(tid(`drag-${card}`))
    .first()
    .boundingBox();
  const b = await page
    .locator(tid(`drop-${lane}`))
    .first()
    .boundingBox();
  await page.mouse.move(a.x + a.width / 2, a.y + 20);
  await page.mouse.down();
  await page.mouse.move(a.x + a.width / 2 + 12, a.y + 30, { steps: 4 });
  await page.mouse.move(b.x + b.width / 2, b.y + Math.min(b.height - 10, 200), { steps: 14 });
  await page.waitForTimeout(300);
  if (!hold) {
    await page.mouse.up();
    await page.waitForTimeout(700);
  }
};
const SCENES = [
  { id: "board", part: "board", sizes: ["wide", "phone"], run: async () => {} },
  { id: "drag", part: "board", sizes: ["wide"], run: async (p) => dragTo(p, "cl_4", "prop", true) },
  {
    id: "gate",
    part: "board",
    sizes: ["wide"],
    run: async (p) => {
      await dragTo(p, "cl_5", "sign", false);
      await p.waitForSelector(tid("card-refused-cl_5"), { timeout: 8000 }).catch(() => {});
    },
  },
  {
    id: "fields",
    part: "board",
    sizes: ["wide"],
    run: async (p) => {
      await dragTo(p, "cl_11", "prop", false);
      await p.waitForSelector(tid("card-fields-cl_11"), { timeout: 8000 }).catch(() => {});
    },
  },
  {
    id: "lanes",
    part: "board",
    sizes: ["wide"],
    run: async (p) => {
      await click(p, "board-swim");
      await click(p, "menu-item-Owner");
      await p.waitForTimeout(600);
    },
  },
  { id: "face", part: "board", sizes: ["wide"], run: async (p) => click(p, "board-face") },
  {
    id: "visual",
    part: "board",
    sizes: ["wide"],
    run: async (p) => {
      await click(p, "board-face");
      await click(p, "face-preset-visual");
      await p.waitForTimeout(400);
    },
  },
  {
    id: "select",
    part: "board",
    sizes: ["wide"],
    run: async (p) => {
      for (const id of ["cl_0", "cl_1", "cl_3"])
        (await p
          .locator(tid(`card-${id}`))
          .first()
          .hover(),
          await click(p, `tick-${id}`));
    },
  },
  {
    id: "select",
    part: "board",
    sizes: ["phone"],
    run: async (p) => {
      for (const id of ["cl_0", "cl_1"])
        await p
          .locator(tid(`tick-${id}`))
          .first()
          .click();
      await p.waitForTimeout(300);
    },
  },
  { id: "keys", part: "board", sizes: ["wide"], run: async (p) => click(p, "board-keys") },
  { id: "big", part: "big", sizes: ["wide"], run: async () => {} },
];
const real = await serve(path.join(appDir, "dist"), { spa: true });
const { createRequire } = await import("node:module");
const { chromium } = createRequire(path.join(REPO, "package.json"))("playwright-core");
const browser = await chromium.launch({ args: ["--no-sandbox"] });
for (const sc of SCENES) {
  if (only.length && !only.includes(sc.id)) continue;
  for (const skin of ["paper", "graphite"])
    for (const size of sc.sizes) {
      if (sizeOnly && size !== sizeOnly) continue;
      const ctx = await browser.newContext({
        viewport: SIZES[size],
        deviceScaleFactor: 1,
        colorScheme: skin === "graphite" ? "dark" : "light",
        reducedMotion: "reduce",
        ...(size === "phone" ? { hasTouch: true, isMobile: true } : {}),
      });
      const page = await ctx.newPage();
      const errs = [];
      page.on("pageerror", (e) => errs.push(String(e)));
      const url = routeUrl(real.origin, `/m/R41_02?part=${sc.part}`, skin);
      await page
        .goto(url, { waitUntil: "load", timeout: 60000 })
        .catch(() => page.goto(url, { waitUntil: "load", timeout: 60000 }));
      const found = await page.waitForSelector(tid("records-board"), { timeout: 12000 }).then(
        () => true,
        () => false,
      );
      await page.waitForTimeout(1200);
      await sc.run(page).catch((e) => errs.push(`step: ${String(e).slice(0, 200)}`));
      await page.waitForTimeout(500);
      const file = path.join(out, `${sc.id}-${skin}-${size}.png`);
      await page.screenshot({ path: file });
      console.log(
        `shot ${path.basename(file)} board=${found}${errs.length ? " errors=" + errs.join(" | ").slice(0, 500) : ""}`,
      );
      await ctx.close();
    }
}
// a mouse drag moves a card (pointer path in a real browser)
let mouseBad = 0;
{
  const ctx = await browser.newContext({ viewport: SIZES.wide });
  const page = await ctx.newPage();
  await page.goto(routeUrl(real.origin, "/m/R41_02?part=board", "graphite"), { waitUntil: "load", timeout: 60000 });
  await page.waitForSelector(tid("records-board"), { timeout: 12000 });
  await page.waitForTimeout(1500);
  await dragTo(page, "cl_4", "prop", true);
  const lifted = await page.evaluate(
    () =>
      !!document.querySelector('[data-testid^="place-"]') &&
      [...document.body.children].some((e) => e.style.position === "fixed"),
  );
  await page.mouse.up();
  await page.waitForTimeout(1200);
  const lane = await page.evaluate(
    () => document.querySelector('[data-card-id="cl_4"]')?.closest("[data-lane]")?.dataset.lane ?? null,
  );
  const ok = lifted && lane === "prop";
  if (!ok) mouseBad++;
  console.log(`mouse drag: lifted with placeholder ${lifted}, card now in ${lane} ${ok ? "PASS" : "FAIL"}`);
  await ctx.close();
}
// real touch through CDP on a phone-size viewport: a hold then a drag moves the card; a swipe scrolls the board and moves nothing
let touchBad = 0;
{
  const ctx = await browser.newContext({ viewport: SIZES.phone, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  await page.goto(routeUrl(real.origin, "/m/R41_02?part=board", "graphite"), { waitUntil: "load", timeout: 60000 });
  await page.waitForSelector(tid("records-board"), { timeout: 12000 });
  await page.waitForTimeout(1500);
  const cdp = await ctx.newCDPSession(page);
  const touch = (type, x, y) =>
    cdp.send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x, y }] });
  const laneOf = (id) =>
    page.evaluate(
      (i) => document.querySelector(`[data-card-id="${i}"]`)?.closest("[data-lane]")?.dataset.lane ?? null,
      id,
    );
  const card = await page.locator(tid("drag-cl_0")).first().boundingBox();
  const cx = card.x + card.width / 2,
    cy = card.y + 30;
  // swipe: quick move before the hold
  await touch("touchStart", cx, cy);
  for (let i = 1; i <= 8; i++) {
    await touch("touchMove", cx - i * 20, cy);
    await page.waitForTimeout(12);
  }
  await touch("touchEnd", 0, 0);
  await page.waitForTimeout(500);
  const scrolled = await page.evaluate(() => document.querySelector('[data-testid="board-lanes"]')?.scrollLeft ?? 0);
  const afterSwipe = await laneOf("cl_0");
  const swipeOk = afterSwipe === "lead" && scrolled > 0;
  // hold, then drag to the right edge: the board scrolls by itself, the next lane slides under the finger, move back to the middle and let go
  await page.evaluate(() => {
    const e = document.querySelector('[data-testid="board-lanes"]');
    if (e) e.scrollLeft = 0;
  });
  await page.waitForTimeout(300);
  const c2 = await page.locator(tid("drag-cl_0")).first().boundingBox();
  const x0 = c2.x + c2.width / 2,
    y0 = c2.y + 30;
  await touch("touchStart", x0, y0);
  await page.waitForTimeout(400);
  for (let i = 1; i <= 10; i++) {
    await touch("touchMove", x0 + i * ((SIZES.phone.width - 8 - x0) / 10), y0 + i * 6);
    await page.waitForTimeout(16);
  }
  await page.waitForTimeout(500);
  const scrolledByDrag = await page.evaluate(() => document.querySelector('[data-testid="board-lanes"]')?.scrollLeft ?? 0);
  for (let i = 1; i <= 14; i++) {
    await touch("touchMove", SIZES.phone.width - 8 - i * 13, y0 + 66);
    await page.waitForTimeout(60);
  }
  await page.waitForTimeout(300);
  const lifted = await page.evaluate(() => [...document.body.children].some((e) => e.style.position === "fixed"));
  const under = await page.evaluate(([x, y]) => { const e = document.elementFromPoint(x, y); const path = []; for (let n = e; n && path.length < 8; n = n.parentElement) path.push(n.tagName + (n.dataset?.testid ? "#" + n.dataset.testid : "")); return `${path.join(">")}|${e?.closest("[data-lane]")?.dataset.lane}@${[...document.querySelectorAll("[data-lane]")].map((l) => Math.round(l.getBoundingClientRect().left)).join(",")}`; }, [SIZES.phone.width - 8 - 14 * 13, y0 + 66]);
  console.log("under the finger at release:", under);
  await touch("touchEnd", 0, 0);
  await page.waitForTimeout(1200);
  const after = await laneOf("cl_0");
  // the drop was taken by the lane under the finger: the card moved, or the stage refused it (reason on the card) or asked for fields
  const handled = await page.evaluate(() => !!document.querySelector('[data-testid="card-refused-cl_0"], [data-testid="card-fields-cl_0"], [data-testid="board-toast"]'));
  const dragOk = lifted && scrolledByDrag > 0 && (handled || (after !== null && after !== "lead"));
  if (!swipeOk) touchBad++;
  if (!dragOk) touchBad++;
  console.log(`touch swipe: scrollLeft ${scrolled}, card stays in ${afterSwipe} ${swipeOk ? "PASS" : "FAIL"}`);
  console.log(`touch hold and drag: lifted ${lifted}, board scrolled itself ${scrolledByDrag}px, card now in ${after}, drop handled ${handled} ${dragOk ? "PASS" : "FAIL"}`);
  await page.screenshot({ path: path.join(out, "touch-drag-graphite-phone.png") });
  await ctx.close();
}
// the finish strips are on screen at 1280, 1440 and 1920 (exit 1 if not)
let bad = 0;
for (const w of [1280, 1440, 1920]) {
  const ctx = await browser.newContext({ viewport: { width: w, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(routeUrl(real.origin, "/m/R41_02?part=board", "graphite"), { waitUntil: "load", timeout: 60000 });
  await page.waitForSelector(tid("records-board"), { timeout: 12000 });
  await page.waitForTimeout(1500);
  const r = await page.evaluate(() => {
    const box = (id) => document.querySelector(`[data-testid="${id}"]`)?.getBoundingClientRect();
    const lost = box("finish-lost");
    const lead = box("lane-lead");
    return { right: lost ? Math.round(lost.right) : null, lead: lead ? Math.round(lead.width) : null, win: innerWidth };
  });
  const ok = r.right !== null && r.right <= r.win;
  if (!ok) bad++;
  console.log(`layout ${w}: strip right edge ${r.right} of ${r.win}, column ${r.lead}px ${ok ? "PASS" : "FAIL"}`);
  await ctx.close();
}
await browser.close();
real.close();
if (bad || touchBad || mouseBad) process.exitCode = 1;
process.exit(process.exitCode ?? 0);
