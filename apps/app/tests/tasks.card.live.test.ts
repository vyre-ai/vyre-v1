// Living tasks, the Still need these card (lane r42-alive): the card at the top of Tasks lists what the Space cannot tell about with why, Keep and Archive answer one or all and each sends the right call. The server's list is a fixture here (the real one needs two weeks to pass); the rules are in modules/tasks/tests/moment.test.ts and needs-decay.test.ts.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createCapCaller } from "../../../client/src/gateway/index.ts";
import { routes } from "../../../generated/routes.ts";
import { bootFreshSpace, claimOnEdge, edge, dismissOnboarding } from "./real-app-harness.test.ts";
import type { CapMap } from "../../../generated/types.ts";
import { guardCrashes } from "./crash-guard.ts";

test("the card shows what is asked with why, in light and dark and on a phone; Keep and Archive send the right calls and the rows go", async (t) => {
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
    await make("Open one real task so the page has a list");
    let items = [
      { id: "tsk_fix1", title: "Check the quarterly report", why: "Nothing has happened here for 14 days." },
      {
        id: "tsk_fix2",
        title: "Reply to the vendor",
        why: "Nothing said when it stops mattering, and the day it was guessed for has passed.",
      },
      { id: "tsk_fix3", title: "Book the venue", why: "Nothing has happened here for 14 days." },
    ];
    const answers: { taskIds: string[]; answer: string }[] = [];
    const row = (i: { id: string; title: string; why: string }) => ({
      task: { id: i.id, title: i.title, kind: "work", state: "todo" },
      why: i.why,
      askedAt: Date.now() - 86_400_000,
    });
    await page.route("**/v1/tasks/still_needed*", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ data: { items: items.map(row), total: items.length } }),
      }),
    );
    await page.route("**/v1/tasks/still_answer", async (route) => {
      const body = route.request().postDataJSON() as { taskIds: string[]; answer: string };
      answers.push(body);
      items = items.filter((i) => !body.taskIds.includes(i.id));
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          data: {
            kept: body.answer === "keep" ? body.taskIds.length : 0,
            archived: body.answer === "archive" ? body.taskIds.length : 0,
          },
        }),
      });
    });
    await page.goto(`${web.origin}/chats#screen=tasks.my-work`, { waitUntil: "load" });
    await page.getByTestId("tasks-still").waitFor({ timeout: 30_000 });
    assert.match(await page.getByTestId("tasks-still").innerText(), /3 tasks may be finished/);
    await shot("card-closed-dark-desktop");
    await page.getByTestId("still-open").click();
    await page.getByText("Reply to the vendor", { exact: true }).waitFor();
    await page.getByText(/Nothing said when it stops mattering/).waitFor();
    await shot("card-open-dark-desktop");
    await page.emulateMedia({ colorScheme: "light" });
    await page.waitForTimeout(400);
    await shot("card-open-light-desktop");
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(400);
    assert.ok(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      "the card fits a phone",
    );
    // the page redraws at phone width: open the card there
    await page.getByTestId("tasks-still").waitFor({ timeout: 10_000 });
    if ((await page.getByTestId("still-keep").count()) === 0) await page.getByTestId("still-open").click();
    await page.waitForTimeout(300);
    await shot("card-open-light-phone");
    await page.emulateMedia({ colorScheme: "dark" });
    await page.waitForTimeout(400);
    await shot("card-open-dark-phone");
    await page.setViewportSize({ width: 1440, height: 900 });

    await page.waitForTimeout(800);
    // a resize may redraw the page: open the card again if it closed
    await page.getByTestId("tasks-still").waitFor({ timeout: 10_000 });
    if ((await page.getByTestId("still-keep").count()) === 0) await page.getByTestId("still-open").click();
    // Keep one, then Archive the rest
    await page.getByTestId("still-keep").first().click();
    for (let i = 0; i < 40 && answers.length < 1; i++) await page.waitForTimeout(250);
    assert.deepEqual(answers[0], { taskIds: ["tsk_fix1"], answer: "keep" });
    await page.getByText("Check the quarterly report", { exact: true }).waitFor({ state: "detached", timeout: 10_000 });
    await page.getByTestId("still-archive-all").click();
    for (let i = 0; i < 40 && answers.length < 2; i++) await page.waitForTimeout(250);
    assert.deepEqual(answers[1], { taskIds: ["tsk_fix2", "tsk_fix3"], answer: "archive" });
    await page.getByTestId("tasks-still").waitFor({ state: "detached", timeout: 10_000 });
    await guard.check("at the end");
    assert.deepEqual(errors, []);
  } catch (failure) {
    const dir = process.env["VYRE_TEST_CAPTURE_DIR"] ?? "/tmp/vyre-alive-card-failure";
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
