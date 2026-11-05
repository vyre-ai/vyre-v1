import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createCapCaller } from "../../../client/src/gateway/index.ts";
import { routes } from "../../../generated/routes.ts";
import { bootFreshSpace, claimOnEdge, edge, dismissOnboarding} from "./real-app-harness.test.ts";
import type { CapMap } from "../../../generated/types.ts";
import { guardCrashes } from "./crash-guard.ts";

test("a task opens in the Tasks place from a link, and its title, status, assignee, due date and comments change and persist; a second editor on an old version is told, not overwritten", async (t) => {
  const dist = process.env["VYRE_APP_DIST"];
  if (!dist) { t.skip("VYRE_APP_DIST is required for actual task-page proof"); return; }
  const { chromium } = await import("playwright-core");
  const space = await bootFreshSpace(), web = await edge(dist, space.url);
  const browser = await chromium.launch({ executablePath: process.env["CHROME_BIN"] || chromium.executablePath(), args: ["--no-sandbox"] });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } }), page = await context.newPage();
  const guard = guardCrashes(page);
  const errors: string[] = [], refused: string[] = []; page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") console.error("Task page console", message.text()); });
  page.on("response", (response) => { if (response.url().includes("/v1/") && response.status() >= 400) void response.text().then((text) => refused.push(`${response.status()} ${new URL(response.url()).pathname}: ${text.slice(0, 300)}`)); });
  try {
    await page.goto(claimOnEdge(space.claim!, web.origin), { waitUntil: "load" });
    await page.getByTestId("claim-name").fill("Task Owner"); await page.getByTestId("claim-username").fill("taskowner");
    await page.getByTestId("claim-password").fill("fixture password 123"); await page.getByTestId("claim-confirm").fill("fixture password 123");
    await page.getByTestId("claim-next").click(); await page.getByTestId("claim-saved").click(); await page.getByTestId("claim-create").click();await dismissOnboarding(page);
    await page.getByTestId("shell").waitFor({ timeout: 30_000 });
    const token = await page.evaluate(() => { const saved = JSON.parse(localStorage.getItem("vyre.session.v1")!); return saved.sessions?.[location.origin]?.token ?? saved.token; });
    const api = createCapCaller({ baseUrl: web.origin, token: () => token, routes: async () => routes });
    const profile = await api("spaces.get", {}) as CapMap["spaces.get"]["out"];
    const owner = profile.space.owner;
    const created = await api("tasks.create", { title: "Review the release brief", assigned: { kind: "person", id: owner }, why: "Check the facts before publishing", idempotencyKey: "task-page-fixture" }) as CapMap["tasks.create"]["out"];
    const taskId = created.task.id;
    const read = async (): Promise<CapMap["tasks.get"]["out"]["task"]> => (await api("tasks.get", { taskId }) as CapMap["tasks.get"]["out"]).task;
    // the link opens in the Tasks place (Chats); a link that still says Home lands there too
    const url = `${web.origin}/chats#screen=tasks.page&taskId=${taskId}`;
    await page.goto(url, { waitUntil: "load" }); await page.getByTestId("task-detail").waitFor({ timeout: 20_000 });
    await page.getByTestId("task-title").waitFor();
    assert.equal(await page.getByTestId("task-title").inputValue(), "Review the release brief");
    await page.goto(`${web.origin}/home#screen=tasks.page&taskId=${taskId}`, { waitUntil: "load" }); await page.getByTestId("task-detail").waitFor({ timeout: 20_000 });
    // title
    await page.getByTestId("task-title").fill("Review the final release brief"); await page.getByTestId("task-title").blur();
    for (let i = 0; i < 40 && (await read()).title !== "Review the final release brief"; i++) await page.waitForTimeout(250);
    assert.equal((await read()).title, "Review the final release brief");
    // status
    await page.getByTestId("task-start").click();
    for (let i = 0; i < 40 && (await read()).state !== "doing"; i++) await page.waitForTimeout(250);
    assert.equal((await read()).state, "doing");
    // due date
    await page.getByTestId("rail-due").click(); await page.getByRole("menuitem", { name: "Tomorrow", exact: true }).click();
    for (let i = 0; i < 40 && (await read()).due === undefined; i++) await page.waitForTimeout(250);
    assert.notEqual((await read()).due, undefined);
    // assignee: the first seat that is not the owner
    await page.getByTestId("rail-assigned").click();
    const seats = await page.getByRole("menuitem").allTextContents();
    const other = seats.map((s) => s.trim()).find((s) => s !== "" && !s.startsWith("You") && !s.endsWith("✓"));
    assert.ok(other, "the assignee menu offers someone besides you");
    await page.getByRole("menuitem", { name: other, exact: true }).first().click();
    for (let i = 0; i < 40 && (await read()).assigned.id === owner; i++) await page.waitForTimeout(250);
    assert.notEqual((await read()).assigned.id, owner);
    // a comment on the task's thread
    await page.getByTestId("composer-field").first().fill("Checked the dates, all good"); await page.getByTestId("composer-field").first().press("Enter");
    await page.getByText("Checked the dates, all good", { exact: true }).first().waitFor({ timeout: 15_000 });
    // the person on an old version: the title is started on this version, someone else changes the task, and the save is told, not applied
    const base = (await read()).version!;
    await page.getByTestId("task-title").focus();
    await page.getByTestId("task-title").fill("My edit on an old version");
    await page.route("**/v1/tasks/update", async (route) => {   // the change by someone else lands between this person's focus and save
      await api("tasks.update", { taskId, title: "Someone else's title" });
      await route.continue();
    });
    await page.getByTestId("task-title").blur();
    // the conflict card (task-conflict, since the Markdown editor change): who changed it, for the title their value beside the task's current one, and a plain line that nothing is lost
    await page.getByTestId("task-conflict").waitFor({ timeout: 15_000 }).catch(async (e: unknown) => { await guard.check("waiting for the conflict card"); throw e; });
    await guard.check("after the conflict card");
    const said = await page.getByTestId("task-conflict").innerText();
    assert.match(said, /changed this task while you were editing/); assert.match(said, /Someone else's title/); assert.match(said, /My edit on an old version/); assert.match(said, /not saved yet/);
    const after = await read();
    assert.equal(after.title, "Someone else's title", "the second save did not overwrite the first");
    assert.ok(after.version! > base);
    await page.unroute("**/v1/tasks/update");
    // it all persists across a reload and fits a phone
    await page.reload({ waitUntil: "load" }); await page.getByTestId("task-title").waitFor();
    assert.equal(await page.getByTestId("task-title").inputValue(), "Someone else's title");
    const captureDir = process.env["VYRE_TEST_CAPTURE_DIR"];
    if (captureDir) { fs.mkdirSync(captureDir, { recursive: true }); await page.screenshot({ path: `${captureDir}/task-detail-desktop.png`, fullPage: true }); }
    await page.setViewportSize({ width: 390, height: 844 }); await page.reload({ waitUntil: "load" }); await page.getByTestId("task-detail").waitFor();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "the task page fits phone width");
    if (captureDir) await page.screenshot({ path: `${captureDir}/task-phone.png`, fullPage: true });
    await guard.check("at the end");
    assert.deepEqual(errors, []);
  } catch (failure) {
    const dir = process.env["VYRE_TEST_CAPTURE_DIR"] ?? "/tmp/vyre-task-page-failure"; fs.mkdirSync(dir, { recursive: true });
    await page.screenshot({ path: `${dir}/failure.png`, fullPage: true }).catch(() => undefined);
    console.error("Task page failure", page.url(), await page.locator("body").innerText().catch(() => "no body"), errors, refused);
    throw failure;
  } finally { await context.close(); await browser.close(); web.close(); await space.stop(); fs.rmSync(space.dir, { recursive: true, force: true }); }
});
