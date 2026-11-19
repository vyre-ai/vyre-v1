// Living tasks, the alive line (lane r42-alive): what the Space puts away on its own (a moment that passed) shows at the top of Tasks as one line with the reason of each, and Put back returns it.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createCapCaller } from "../../../client/src/gateway/index.ts";
import { routes } from "../../../generated/routes.ts";
import { bootFreshSpace, claimOnEdge, edge, dismissOnboarding } from "./real-app-harness.test.ts";
import type { CapMap } from "../../../generated/types.ts";
import { guardCrashes } from "./crash-guard.ts";

test("a task whose moment passed is put away by the Space within a minute; the alive line says so with the reason and Put back returns it", async (t) => {
  const dist = process.env["VYRE_APP_DIST"];
  if (!dist) {
    t.skip("VYRE_APP_DIST is required for the living tasks walk");
    return;
  }
  const { chromium } = await import("playwright-core");
  const space = await bootFreshSpace(),
    web = await edge(dist, space.url);
  const browser = await chromium.launch({
    executablePath: process.env["CHROME_BIN"] || chromium.executablePath(),
    args: ["--no-sandbox"],
  });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "dark" }),
    page = await context.newPage();
  const guard = guardCrashes(page);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const captureDir = process.env["VYRE_TEST_CAPTURE_DIR"];
  const shot = async (name: string): Promise<void> => {
    if (!captureDir) return;
    fs.mkdirSync(captureDir, { recursive: true });
    await page.screenshot({ path: `${captureDir}/${name}.png` });
  };
  try {
    await page.goto(claimOnEdge(space.claim!, web.origin), { waitUntil: "load" });
    await page.getByTestId("claim-name").fill("Task Owner");
    await page.getByTestId("claim-username").fill("taskowner");
    await page.getByTestId("claim-password").fill("fixture password 123");
    await page.getByTestId("claim-confirm").fill("fixture password 123");
    await page.getByTestId("claim-next").click();
    await page.getByTestId("claim-create").click();
    await dismissOnboarding(page);
    await page.getByTestId("shell").waitFor({ timeout: 30_000 });
    const token = await page.evaluate(() => {
      const saved = JSON.parse(localStorage.getItem("vyre.session.v1")!);
      return saved.sessions?.[location.origin]?.token ?? saved.token;
    });
    const api = createCapCaller({ baseUrl: web.origin, token: () => token, routes: async () => routes });
    const owner = ((await api("spaces.get", {})) as CapMap["spaces.get"]["out"]).space.owner;
    const me = { kind: "person" as const, id: owner };
    const day = 86_400_000;
    const make = async (title: string, over: Record<string, unknown> = {}): Promise<string> =>
      (
        (await api("tasks.create", {
          title,
          assigned: me,
          idempotencyKey: `alive-${title}`,
          ...over,
        })) as CapMap["tasks.create"]["out"]
      ).task.id;
    const read = async (id: string): Promise<CapMap["tasks.get"]["out"]["task"]> =>
      ((await api("tasks.get", { taskId: id })) as CapMap["tasks.get"]["out"]).task;
    const passed = await make("Join the call from last week", { relevantUntil: Date.now() - 2 * day });
    // the Space's clock runs once a minute: wait for it, then look
    for (let i = 0; i < 100 && (await read(passed)).archived === undefined; i++) await page.waitForTimeout(1000);
    const was = (await read(passed)).archived;
    assert.ok(was, "the clock put the task away");
    assert.equal(was.code, "passed");
    assert.match(was.why, /^It was for /);

    await page.goto(`${web.origin}/chats#screen=tasks.my-work`, { waitUntil: "load" });
    await page.getByTestId("tasks-page").waitFor({ timeout: 30_000 });
    await page.getByTestId("tasks-alive").waitFor({ timeout: 20_000 });
    assert.match(await page.getByTestId("tasks-alive").innerText(), /1 put away/);
    await page.getByTestId("alive-open").click();
    await page
      .getByText(/It was for/)
      .first()
      .waitFor({ timeout: 10_000 });
    await shot("alive-line-dark-desktop");
    await page.getByTestId("alive-put-back").click();
    for (let i = 0; i < 40 && (await read(passed)).archived !== undefined; i++) await page.waitForTimeout(250);
    assert.equal((await read(passed)).archived, undefined, "Put back returns it");
    await page.getByTestId("tasks-alive").waitFor({ state: "detached", timeout: 10_000 });

    // a phone
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${web.origin}/chats#screen=tasks.my-work`, { waitUntil: "load" });
    await page.getByTestId("tasks-page").waitFor({ timeout: 30_000 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "Tasks fits a phone");
    await guard.check("at the end");
    assert.deepEqual(errors, []);
  } catch (failure) {
    const dir = process.env["VYRE_TEST_CAPTURE_DIR"] ?? "/tmp/vyre-alive-line-failure";
    fs.mkdirSync(dir, { recursive: true });
    await page.screenshot({ path: `${dir}/failure.png`, fullPage: true }).catch(() => undefined);
    console.error(
      "alive failure",
      page.url(),
      await page
        .locator("body")
        .innerText()
        .catch(() => "no body"),
      errors,
    );
    throw failure;
  } finally {
    await context.close();
    await browser.close();
    web.close();
    await space.stop();
    fs.rmSync(space.dir, { recursive: true, force: true });
  }
});
