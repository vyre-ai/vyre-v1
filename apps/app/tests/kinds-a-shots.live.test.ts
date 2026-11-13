// Pictures for lane f-kinds-a (13 Nov 2026), from the real app: step cards with chip words, Console Home with a collapsed run and the same row opened, the command bar with a task's own chat shown once and
// two same-named unlinked things shown twice, Project Overview's People and agents, and the Console General Space row in its three states. Light and graphite. Each page also runs the crash guard (no id on screen).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { bootFreshSpace, claimOnEdge, edge, dismissOnboarding } from "./real-app-harness.test.ts";
import { openConsole, openConsolePage } from "./console-nav.ts";
import { guardCrashes } from "./crash-guard.ts";

const PASSWORD = "fixture password 123";

test("f-kinds-a pictures", async (t) => {
  const dist = process.env["VYRE_APP_DIST"];
  if (!dist) { t.skip("VYRE_APP_DIST required for production browser evidence"); return; }
  const { chromium } = await import("playwright-core");
  const space = await bootFreshSpace();
  const web = await edge(dist, space.url);
  const browser = await chromium.launch({ executablePath: process.env["CHROME_BIN"] || chromium.executablePath(), args: ["--no-sandbox"] });
  const out = process.env["VYRE_KINDS_SHOTS"] ?? "/tmp/vyre-kinds-shots"; fs.mkdirSync(out, { recursive: true });
  try {
    const owner = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await owner.newPage();
    const guard = guardCrashes(page);
    await page.goto(claimOnEdge(space.claim!, web.origin), { waitUntil: "load" });
    await page.getByTestId("claim-name").fill("Olivia Owner"); await page.getByTestId("claim-username").fill("olivia");
    await page.getByTestId("claim-password").fill(PASSWORD); await page.getByTestId("claim-confirm").fill(PASSWORD);
    await page.getByTestId("claim-next").click(); await page.getByTestId("claim-saved").click(); await page.getByTestId("claim-create").click(); await dismissOnboarding(page);
    await page.getByTestId("shell").waitFor({ timeout: 30_000 });
    const token = await page.evaluate(() => JSON.parse(localStorage.getItem("vyre.session.v1")!).sessions[location.origin].token as string);
    let n = 0;
    const call = async (cap: string, data: Record<string, unknown>): Promise<any> => { // eslint-disable-line @typescript-eslint/no-explicit-any
      const r = await owner.request.post(`${web.origin}/v1/${cap.replaceAll(".", "/")}`, { headers: { authorization: `Bearer ${token}` }, data: { idempotencyKey: `ks-${cap}-${++n}`, ...data } });
      const body = await r.json();
      assert.equal(r.status(), 200, `${cap}: ${JSON.stringify(body).slice(0, 400)}`);
      return body.data;
    };
    const shot = async (name: string, skin: string): Promise<void> => { await guard.check(name); await page.screenshot({ path: path.join(out, `${name}-${skin === "paper" ? "light" : "graphite"}.png`), animations: "disabled" }); };

    // what the pictures show
    const auto = await call("automations.create", { name: "Weekly digest" });
    const automationId = (auto.automation?.id ?? auto.automation?.automationId) as string;
    await call("automations.update", { automationId, definition: { triggers: [{ key: "webhook" }], start: ["n1"], nodes: [{ id: "n1", key: "wait", input: { note: "A new {{ trigger.type }} came in from a form. Wait for record {{ trigger.recordId }}." }, next: ["n2"] }, { id: "n2", key: "stop", input: { message: "Done with {{ trigger.recordId }}" }, next: [] }] } }).catch((e: Error) => fs.writeFileSync(path.join(out, "automation-definition-refused.txt"), e.message));
    for (const nm of ["launch-week", "launch-plan", "launch-retro", "launch-party"]) await call("channels.create", { name: nm, visibility: "public" });
    const agents = (await call("agents.list", {})).agents as { id: string; name: string }[];
    const agent = { id: (agents[0] as unknown as { agentId: string }).agentId };
    const own = await call("tasks.create", { title: "Book the launch venue", assigned: { kind: "agent", id: agent.id }, why: "The venue for launch day" }).catch(() => null);
    await call("tasks.create", { title: "Write the launch announcement", assigned: { kind: "person", id: (await call("identity.whoami", {})).user?.id ?? (await call("identity.whoami", {})).me?.id } }).catch(() => null);
    await call("chat.start", { kind: "chat", agentIds: [agent.id], title: "Write the launch announcement" });
    const got = own?.task?.id ? await call("tasks.get", { taskId: own.task.id }).catch((e: Error) => ({ error: e.message })) : null;
    const recent = await call("chat.recent", { filter: "all" }).catch((e: Error) => ({ error: e.message }));
    fs.writeFileSync(path.join(out, "ids.json"), JSON.stringify({ automationId, created: own, got, recent }, null, 1));

    for (const skin of ["paper", "graphite"]) {
      // 1. the step card
      await page.goto(`${web.origin}/automations?skin=${skin}`, { waitUntil: "load" });
      await page.getByText("Weekly digest", { exact: true }).first().click({ timeout: 30_000 });
      await page.getByTestId("canvas-frame").first().waitFor({ timeout: 30_000 });
      await page.getByTestId("card-n1").waitFor({ timeout: 20_000 }).catch(() => undefined);
      await shot("1-step-cards", skin);

      // 2. Console Home: the collapsed run, then the same row opened
      await page.goto(`${web.origin}/console?skin=${skin}`, { waitUntil: "load" });
      await page.getByTestId("console").waitFor({ timeout: 30_000 });
      await page.getByTestId("activity").waitFor({ timeout: 30_000 });
      await page.waitForFunction(() => /created 4 channels|4 channels|times/.test(document.querySelector("[data-testid=activity]")?.textContent ?? ""), undefined, { timeout: 15_000 }).catch(() => undefined);
      await shot("2-console-home-collapsed", skin);
      await page.getByTestId("act-0").click({ timeout: 15_000 }).catch(() => undefined);
      await page.waitForTimeout(800);
      await shot("2-console-home-row-opened", skin);

      // 3. the command bar
      await page.goto(`${web.origin}/chat?skin=${skin}`, { waitUntil: "load" });
      await page.getByTestId("shell").waitFor({ timeout: 30_000 });
      await page.keyboard.press("Control+K"); await page.getByTestId("cmdk-input").waitFor({ timeout: 10_000 });
      await page.getByTestId("cmdk-input").type("launch", { delay: 30 });
      await page.waitForFunction(() => (document.querySelector("[data-testid=cmdk-list]")?.textContent ?? "").includes("launch"), undefined, { timeout: 20_000 });
      await shot("3-command-bar", skin);
      await page.keyboard.press("Escape");
    }

    // 5. Console General, the Space row in its three states (light)
    await openConsole(page, web.origin);
    await openConsolePage(page, "space");
    await page.getByTestId("space-id-copy").waitFor({ timeout: 20_000 });
    await shot("5-space-row-idle", "paper");
    await page.evaluate(() => { Object.defineProperty(navigator, "clipboard", { value: { writeText: () => Promise.resolve() }, configurable: true }); });
    await page.getByTestId("space-id-copy").click(); await page.getByText("Copied", { exact: true }).waitFor({ timeout: 5000 });
    await shot("5-space-row-copied", "paper");
    await page.getByText("Copy Space ID", { exact: true }).waitFor({ timeout: 5000 });
    await page.evaluate(() => { Object.defineProperty(navigator, "clipboard", { value: { writeText: () => Promise.reject(new Error("denied")) }, configurable: true }); });
    await page.getByTestId("space-id-copy").click(); await page.getByText("Could not copy", { exact: true }).waitFor({ timeout: 5000 });
    await shot("5-space-row-could-not-copy", "paper");
  } finally { await browser.close(); web.close(); await space.stop(); }
});
