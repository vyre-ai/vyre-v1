import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createCapCaller } from "../../../client/src/gateway/index.ts";
import { routes } from "../../../generated/routes.ts";
import { bootFreshSpace, claimOnEdge, edge } from "./real-app-harness.test.ts";
import type { CapMap } from "../../../generated/types.ts";

test("a canonical task opens from a copied Home link, edits, transitions, follows, reloads and keeps actual activity", async (t) => {
  const dist = process.env["VYRE_APP_DIST"];
  if (!dist) { t.skip("VYRE_APP_DIST is required for actual task-page proof"); return; }
  const { chromium } = await import("playwright-core");
  const space = await bootFreshSpace(), web = await edge(dist, space.url);
  const browser = await chromium.launch({ executablePath: process.env["CHROME_BIN"] || chromium.executablePath(), args: ["--no-sandbox"] });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } }), page = await context.newPage();
  const errors: string[] = [], refused: string[] = []; page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") console.error("Task page console", message.text()); });
  page.on("response", (response) => { if (response.url().includes("/v1/") && response.status() >= 400) void response.text().then((text) => refused.push(`${response.status()} ${new URL(response.url()).pathname}: ${text.slice(0, 300)}`)); });
  try {
    await page.goto(claimOnEdge(space.claim!, web.origin), { waitUntil: "load" });
    await page.getByTestId("claim-name").fill("Task Owner"); await page.getByTestId("claim-username").fill("taskowner");
    await page.getByTestId("claim-password").fill("fixture password 123"); await page.getByTestId("claim-confirm").fill("fixture password 123");
    await page.getByTestId("claim-next").click(); await page.getByTestId("claim-saved").click(); await page.getByTestId("claim-create").click();
    await page.getByTestId("shell").waitFor({ timeout: 30_000 });
    const token = await page.evaluate(() => { const saved = JSON.parse(localStorage.getItem("vyre.session.v1")!); return saved.sessions?.[location.origin]?.token ?? saved.token; });
    const api = createCapCaller({ baseUrl: web.origin, token: () => token, routes: async () => routes });
    const profile = await api("spaces.get", {}) as CapMap["spaces.get"]["out"];
    const created = await api("tasks.create", { title: "Review the release brief", assigned: { kind: "person", id: profile.space.owner }, why: "Check the facts before publishing", idempotencyKey: "task-page-fixture" }) as CapMap["tasks.create"]["out"];
    const taskId = created.task.id, url = `${web.origin}/home#screen=tasks.page&taskId=${taskId}`;
    await page.goto(url, { waitUntil: "load" }); await page.getByTestId("task-page").waitFor({ timeout: 20_000 });
    await page.getByText("Review the release brief", { exact: true }).waitFor();
    await page.getByRole("button", { name: "Edit task", exact: true }).click();
    await page.getByLabel("Task title", { exact: true }).fill("Review the final release brief");
    await page.getByLabel("Summary", { exact: true }).fill("Confirm contents and links");
    await page.getByLabel("Effort in minutes", { exact: true }).fill("20");
    await page.getByRole("button", { name: "Save task", exact: true }).click(); await page.getByText("Task updated", { exact: true }).waitFor();
    let actual = (await api("tasks.get", { taskId }) as CapMap["tasks.get"]["out"]).task;
    assert.equal(actual.title, "Review the final release brief"); assert.equal(actual.effort, 20); assert.equal(actual.summary, "Confirm contents and links");
    await page.getByLabel("Note name", { exact: true }).fill("Release checks"); await page.getByLabel("Working note", { exact: true }).fill("Verified links and contents");
    await page.getByRole("button", { name: "Save working note", exact: true }).click(); await page.getByText("Working note saved", { exact: true }).waitFor();
    assert.equal((await api("tasks.get", { taskId }) as CapMap["tasks.get"]["out"]).task.workingNotes["Release checks"], "Verified links and contents");
    await page.getByRole("button", { name: "Task status", exact: true }).click(); await page.getByRole("menuitem", { name: "Doing", exact: true }).click();
    await page.getByText("Status: Doing", { exact: true }).waitFor();
    assert.equal((await api("tasks.get", { taskId }) as CapMap["tasks.get"]["out"]).task.state, "doing");
    actual = (await api("tasks.get", { taskId }) as CapMap["tasks.get"]["out"]).task;
    const followed = actual.followers.includes(profile.space.owner);
    await page.getByRole("button", { name: followed ? "Unfollow" : "Follow", exact: true }).click();
    await page.getByText(followed ? "Unfollowed" : "Following", { exact: true }).waitFor();
    assert.equal((await api("tasks.get", { taskId }) as CapMap["tasks.get"]["out"]).task.followers.includes(profile.space.owner), !followed);
    await page.reload({ waitUntil: "load" }); await page.getByText("Review the final release brief", { exact: true }).waitFor();
    await page.getByRole("tab", { name: "Activity", exact: true }).click(); await page.getByText("Transitioned", { exact: true }).waitFor();
    const captureDir = process.env["VYRE_TEST_CAPTURE_DIR"];
    if (captureDir) { fs.mkdirSync(captureDir, { recursive: true }); await page.screenshot({ path: `${captureDir}/task-activity-desktop.png`, fullPage: true }); }
    await page.setViewportSize({ width: 390, height: 844 }); await page.reload({ waitUntil: "load" }); await page.getByTestId("task-page").waitFor();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "the task page fits phone width");
    if (captureDir) await page.screenshot({ path: `${captureDir}/task-phone.png`, fullPage: true });
    assert.deepEqual(errors, []);
  } catch (failure) {
    const dir = process.env["VYRE_TEST_CAPTURE_DIR"] ?? "/tmp/vyre-task-page-failure"; fs.mkdirSync(dir, { recursive: true });
    await page.screenshot({ path: `${dir}/failure.png`, fullPage: true }).catch(() => undefined);
    console.error("Task page failure", page.url(), await page.locator("body").innerText().catch(() => "no body"), errors, refused);
    throw failure;
  } finally { await context.close(); await browser.close(); web.close(); await space.stop(); fs.rmSync(space.dir, { recursive: true, force: true }); }
});
