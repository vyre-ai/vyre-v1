// Living tasks (lane r42-alive): a task is put away with its reason and put back with one press; the Archived list says why; work due two weeks ago does not lead the list.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createCapCaller } from "../../../client/src/gateway/index.ts";
import { routes } from "../../../generated/routes.ts";
import { bootFreshSpace, claimOnEdge, edge, dismissOnboarding } from "./real-app-harness.test.ts";
import type { CapMap } from "../../../generated/types.ts";
import { guardCrashes } from "./crash-guard.ts";

test("an archived task shows why on the Archived list and is put back with one press; Archive in the task page puts one away; both survive a reload", async (t) => {
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
    await make("Send the quarterly letter", { due: Date.now() - 14 * day });
    await make("Reply to Andrea", { due: Date.now() - day });
    const paid = await make("Pay the hosting invoice");
    const call = await make("Join the Thursday call");
    await api("tasks.archive", { taskId: paid, why: "Paid 6 Nov, the receipt says payment received" });
    assert.ok((await read(paid)).archived, "the API marks it archived with its reason");

    await page.goto(`${web.origin}/chats#screen=tasks.my-work`, { waitUntil: "load" });
    await page.getByTestId("tasks-page").waitFor({ timeout: 30_000 });
    await page.getByText("Reply to Andrea", { exact: true }).first().waitFor({ timeout: 20_000 });
    assert.equal(
      await page.getByText("Pay the hosting invoice", { exact: true }).count(),
      0,
      "an archived task is off the main list",
    );
    await shot("tasks-list-dark-desktop");

    // the Archived scope: the row says why
    await page.getByTestId("tasks-scope").click();
    await page.getByRole("menuitem", { name: "Archived" }).click();
    await page.getByText("Pay the hosting invoice", { exact: true }).first().waitFor({ timeout: 20_000 });
    await page
      .getByText(/Archived · Paid 6 Nov/)
      .first()
      .waitFor();
    await shot("tasks-archived-dark-desktop");

    // open it: who and why, and Put back returns it exactly
    await page.getByText("Pay the hosting invoice", { exact: true }).first().click();
    await page.getByTestId("task-archived").waitFor({ timeout: 20_000 });
    assert.match(await page.getByTestId("task-archived-why").innerText(), /Paid 6 Nov/);
    await shot("task-archived-dark-desktop");
    await page.getByTestId("task-put-back").click();
    for (let i = 0; i < 40 && (await read(paid)).archived !== undefined; i++) await page.waitForTimeout(250);
    assert.equal((await read(paid)).archived, undefined, "Put back clears the mark");
    assert.equal((await read(paid)).state, "todo", "and the task is where it was");

    // Archive from the task page
    await page.goto(`${web.origin}/chats#screen=tasks.page&taskId=${call}`, { waitUntil: "load" });
    await page.getByTestId("task-detail").waitFor({ timeout: 20_000 });
    await page.getByTestId("rail-archive").click();
    for (let i = 0; i < 40 && (await read(call)).archived === undefined; i++) await page.waitForTimeout(250);
    assert.ok((await read(call)).archived, "Archive puts it away");
    await page.reload({ waitUntil: "load" });
    await page.getByTestId("task-archived").waitFor({ timeout: 20_000 });

    // a phone
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${web.origin}/chats#screen=tasks.my-work`, { waitUntil: "load" });
    await page.getByTestId("tasks-page").waitFor({ timeout: 30_000 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "Tasks fits a phone");
    await shot("tasks-list-dark-phone");
    await guard.check("at the end");
    assert.deepEqual(errors, []);
  } catch (failure) {
    const dir = process.env["VYRE_TEST_CAPTURE_DIR"] ?? "/tmp/vyre-alive-failure";
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
