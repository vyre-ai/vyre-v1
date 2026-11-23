// Owner report, 24 Nov: "it doesnt scroll in automations when I am on a certain automation". An Automation taller than the window (many steps, a long version history) must scroll with the wheel and the keyboard
// to its last step and its last version, at the computer size and at the phone size. The page makes a 40-step automation and 30 versions through the API, opens each in the real app and scrolls to the end.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import type { Page } from "playwright-core";
import { bootFreshSpace, claimOnEdge, dismissOnboarding, edge } from "./real-app-harness.test.ts";

const PASSWORD = "fixture password 123";
const SHOTS = process.env["SHOTS"];
const LOOKS = [
  { tag: "d", viewport: { width: 1440, height: 900 }, colorScheme: "dark" as const },
  { tag: "p", viewport: { width: 390, height: 844 }, colorScheme: "light" as const },
];
const STEPS = 40;

/** The last element that matches is wholly inside the window. */
const lastFits = (page: Page, sel: string): Promise<boolean> =>
  page.evaluate((q) => {
    const all = document.querySelectorAll(q);
    const el = all[all.length - 1];
    if (!el) return false;
    const r = el.getBoundingClientRect();
    return r.height > 0 && r.top >= 0 && r.bottom <= window.innerHeight;
  }, sel);
const byId = (id: string): string => `[data-testid="${id}"]`;

/** Scroll with the wheel over the page until the target is wholly inside the window; false when it never gets there. */
async function wheelTo(page: Page, sel: string, over: { x: number; y: number }): Promise<boolean> {
  const fits = (): Promise<boolean> => lastFits(page, sel);
  await page.mouse.move(over.x, over.y);
  for (let i = 0; i < 80; i++) {
    if (await fits()) return true;
    await page.mouse.wheel(0, 240);
    await page.waitForTimeout(40);
  }
  return fits();
}

/** Same with the keyboard: Page Down presses, after a click on a quiet spot of the page. */
async function keysTo(page: Page, sel: string, click: { x: number; y: number }): Promise<boolean> {
  const fits = (): Promise<boolean> => lastFits(page, sel);
  await page.mouse.click(click.x, click.y);
  for (let i = 0; i < 40; i++) {
    if (await fits()) return true;
    await page.keyboard.press("PageDown");
    await page.waitForTimeout(60);
  }
  return fits();
}

for (const look of LOOKS) {
  test(`production Automations (${look.tag}): a tall Automation scrolls to its last step and its last version`, async (t) => {
    const dist = process.env["VYRE_APP_DIST"];
    if (!dist) {
      if (process.env["VYRE_REQUIRE_CHROME"] === "1") assert.fail("VYRE_APP_DIST required");
      t.skip("VYRE_APP_DIST required for production browser evidence");
      return;
    }
    const { chromium } = await import("playwright-core");
    const exe = process.env["CHROME_BIN"] || chromium.executablePath();
    assert.ok(fs.existsSync(exe), `Chromium is required at ${exe}`);
    const space = await bootFreshSpace();
    const web = await edge(dist, space.url);
    const browser = await chromium.launch({ executablePath: exe, args: ["--no-sandbox"] });
    const context = await browser.newContext({ viewport: look.viewport, colorScheme: look.colorScheme });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const shot = async (name: string): Promise<void> => {
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}-${look.tag}.png` });
    };
    try {
      await page.goto(claimOnEdge(space.claim!, web.origin), { waitUntil: "load" });
      await page.getByTestId("claim-name").fill("Olivia Owner");
      await page.getByTestId("claim-username").fill("olivia");
      await page.getByTestId("claim-password").fill(PASSWORD);
      await page.getByTestId("claim-confirm").fill(PASSWORD);
      await page.getByTestId("claim-next").click();
      await page.getByTestId("claim-create").click();
      await dismissOnboarding(page);
      if (look.tag === "d") await page.getByTestId("shell").waitFor({ timeout: 30_000 });
      else await page.waitForTimeout(4000);
      const token = await page.evaluate(
        () => JSON.parse(localStorage.getItem("vyre.session.v1")!).sessions[location.origin].token as string,
      );
      const api = async (cap: string, data: Record<string, unknown>): Promise<any> => {
        const r = await context.request.post(`${web.origin}/v1/${cap.replace(/\./g, "/")}`, {
          headers: { authorization: `Bearer ${token}` },
          data: { idempotencyKey: `${cap}-${Math.random()}`, ...data },
        });
        assert.equal(r.status(), 200, `${cap}: ${await r.text()}`);
        return r.json();
      };
      const who = JSON.stringify(await api("identity.whoami", {})).match(/usr_[a-z0-9]+/)?.[0];
      assert.ok(who, "the person's own id");
      // a long automation: a chain of forty task steps
      const nodes = Array.from({ length: STEPS }, (_, i) => ({
        id: `n${i + 1}`,
        key: "create_task",
        input: { title: `Step number ${i + 1}`, assigned: { kind: "person", id: who } },
        ...(i + 1 < STEPS ? { next: [`n${i + 2}`] } : {}),
      }));
      const made = await api("automations.create", {
        name: "Long chain",
        definition: { triggers: [{ key: "manual" }], nodes, start: ["n1"] },
      });
      const id = (made.automation ?? made.data?.automation ?? made.data ?? made).id as string;
      // thirty versions of it
      let version = 1;
      for (let v = 0; v < 30; v++) {
        const bumped = nodes.map((n, i) =>
          i === 0 ? { ...n, input: { ...n.input, title: `Step number 1 v${v}` } } : n,
        );
        const r = await api("automations.update", {
          automationId: id,
          definition: { triggers: [{ key: "manual" }], nodes: bumped, start: ["n1"] },
          reason: `edit ${v}`,
        });
        version = (r.automation ?? r.data?.automation ?? r.data ?? r).version ?? version + 1;
      }
      void version;
      await page.goto(`${web.origin}/automations`, { waitUntil: "load" });
      await page.getByText("Long chain", { exact: true }).first().click({ timeout: 30_000 });
      const w = look.viewport.width;
      const h = look.viewport.height;
      if (look.tag === "d") {
        await page.getByTestId("story").waitFor({ timeout: 20_000 });
        await page.waitForTimeout(1500);
        await shot("1-top");
        // the page is taller than the window: the last step starts out of view
        assert.equal(
          await page.evaluate(() => {
            const r = document.querySelector('[data-testid="sv-step-n40"]')?.getBoundingClientRect();
            return !!r && r.bottom <= window.innerHeight;
          }),
          false,
          "the last step is below the fold to begin with",
        );
        assert.ok(
          await wheelTo(page, byId(`sv-step-n${STEPS}`), { x: w * 0.4, y: h * 0.6 }),
          "the wheel reaches the last step",
        );
        await shot("2-last-step-wheel");
        await page.reload({ waitUntil: "load" });
        await page.getByTestId("story").waitFor({ timeout: 20_000 });
        await page.waitForTimeout(1000);
        assert.ok(
          await keysTo(page, byId(`sv-step-n${STEPS}`), { x: w * 0.4, y: h * 0.5 }),
          "Page Down reaches the last step",
        );
        // the Test pane open beside the steps: the steps still scroll
        await page.reload({ waitUntil: "load" });
        await page.getByTestId("story").waitFor({ timeout: 20_000 });
        await page.getByTestId("sv-test").click();
        await page.getByTestId("test-pane").waitFor({ timeout: 20_000 });
        await page.waitForTimeout(800);
        assert.ok(
          await wheelTo(page, byId(`sv-step-n${STEPS}`), { x: w * 0.3, y: h * 0.6 }),
          "the wheel reaches the last step with the Test pane open",
        );
        await shot("3-test-open");
        // the version history is a long page of its own
        await page.getByTestId("page-menu").click();
        await page.getByText("History", { exact: true }).first().click();
        await page.getByTestId("versions-list").waitFor({ timeout: 20_000 });
        await page.waitForTimeout(800);
        assert.ok(
          await wheelTo(page, byId("row-ver-1"), { x: w * 0.5, y: h * 0.6 }),
          "the wheel reaches the first version at the end of the history",
        );
        await shot("4-history-end");
        // a run of it is a page of forty rows
        await api("automations.set_enabled", { automationId: id, enabled: true });
        await api("automations.run", { automationId: id, payload: {} });
        await page.getByTestId("page-tab-runs").click();
        await page.locator('[data-testid^="row-run-"]').first().click({ timeout: 30_000 });
        await page.getByTestId("run-page").waitFor({ timeout: 20_000 });
        await page.waitForTimeout(1500);
        await shot("5-run-page-top");
        assert.ok(
          await wheelTo(page, '[data-testid^="rv-row-"]', { x: w * 0.5, y: h * 0.6 }),
          "the wheel reaches the last row of a run",
        );
        await shot("5-run-page-end");
      } else {
        // a phone: the build page says so and the Runs list is what is there; thirty runs make it taller than the screen
        await api("automations.set_enabled", { automationId: id, enabled: true });
        for (let k = 0; k < 30; k++) await api("automations.run", { automationId: id, payload: {} });
        await page.waitForTimeout(2500);
        await page.goto(`${web.origin}/automations`, { waitUntil: "load" });
        await page.getByText("Long chain", { exact: true }).first().click({ timeout: 30_000 });
        await page.waitForTimeout(3000);
        await shot("1-phone-top");
        assert.ok(await page.locator('[data-testid^="row-run-"]').count(), "the runs are listed");
        assert.ok(
          await wheelTo(page, '[data-testid^="row-run-"]', { x: w * 0.5, y: h * 0.5 }),
          "the wheel reaches the last run on the phone",
        );
        await shot("2-phone-last-run");
      }
      assert.deepEqual(errors, [], "no page error");
    } finally {
      await browser.close();
      web.close();
      await space.stop();
    }
  });
}
