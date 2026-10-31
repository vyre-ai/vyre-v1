// Production web export against a fresh claimed Team Space: the Console pages for Skills and for Plugins and outside tools (CHAT-DESIGN rulings 4 and 6). An admin adds a skill by pasting it, adds a
// marketplace, installs a plugin, sets a secret option by Vault handle, connects an MCP server by address; every change is read back through the real gateway. Screenshots in light, dark and phone width
// go to VYRE_TEST_CAPTURE_DIR when it is set.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createCapCaller } from "../../../client/src/gateway/index.ts";
import { routes } from "../../../generated/routes.ts";
import { bootFreshSpace, claimOnEdge, edge, dismissOnboarding} from "./real-app-harness.test.ts";

const MARKET = new URL("../../../fixtures/plugins/test-marketplace", import.meta.url).pathname;
const SKILL = "---\nname: matter-intake\ndescription: How this firm opens a matter. Use when a new client calls.\n---\n\nGet the conflict names before anything else.\n";

test("production Console: Skills and Plugins add, install, configure and connect, and persist", async (t) => {
  const dist = process.env["VYRE_APP_DIST"];
  if (!dist) { t.skip("VYRE_APP_DIST is required for production browser evidence"); return; }
  const { chromium } = await import("playwright-core");
  const exe = process.env["CHROME_BIN"] || chromium.executablePath();
  if (!fs.existsSync(exe)) assert.fail(`Chromium is required at ${exe}`);
  const space = await bootFreshSpace();
  const web = await edge(dist, space.url);
  const browser = await chromium.launch({ executablePath: exe, args: ["--no-sandbox"] });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const captureDir = process.env["VYRE_TEST_CAPTURE_DIR"];
  const shoot = async (name: string): Promise<void> => {
    if (!captureDir) return;
    fs.mkdirSync(captureDir, { recursive: true });
    await page.screenshot({ path: `${captureDir}/${name}-light.png`, fullPage: true });
    // dark is the Graphite skin: chosen from the Console's own skin menu, or by the ?skin address the app understands where there is no such menu
    await page.emulateMedia({ colorScheme: "dark" });
    const menu = page.getByTestId("console-skin");
    if (await menu.count() > 0) { await menu.click(); await page.getByRole("menuitem", { name: "Graphite", exact: true }).click(); }
    else { const here = new URL(page.url()); here.searchParams.set("skin", "graphite"); await page.goto(here.toString(), { waitUntil: "load" }); }
    await page.waitForTimeout(900);
    await page.screenshot({ path: `${captureDir}/${name}-dark.png`, fullPage: true });
    if (await menu.count() > 0) { await menu.click(); await page.getByRole("menuitem", { name: "System", exact: true }).click(); }
    else { const here = new URL(page.url()); here.searchParams.set("skin", "paper"); await page.goto(here.toString(), { waitUntil: "load" }); await page.waitForTimeout(600); }
    await page.emulateMedia({ colorScheme: "light" });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(900);
    await page.screenshot({ path: `${captureDir}/${name}-phone.png`, fullPage: true });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${name}: the page fits phone width without sideways scrolling`);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.waitForTimeout(400);
  };
  const errors: string[] = [], refused: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("response", (response) => { if (response.url().includes("/v1/") && response.status() >= 400) void response.text().then((body) => refused.push(`${response.status()} ${new URL(response.url()).pathname}: ${body.slice(0, 180)}`)); });
  try {
    await page.goto(claimOnEdge(space.claim!, web.origin), { waitUntil: "load" });
    await page.getByTestId("claim-name").fill("Eco Owner"); await page.getByTestId("claim-username").fill("eco");
    await page.getByTestId("claim-password").fill("fixture password 123"); await page.getByTestId("claim-confirm").fill("fixture password 123");
    await page.getByTestId("claim-next").click(); await page.getByTestId("claim-saved").click(); await page.getByTestId("claim-create").click();await dismissOnboarding(page);
    await page.getByTestId("shell").waitFor({ timeout: 30_000 });
    const token = await page.evaluate(() => { const saved = JSON.parse(localStorage.getItem("vyre.session.v1")!); const origin = (globalThis as unknown as { location: { origin: string } }).location.origin; return saved.sessions?.[origin]?.token ?? saved.token; });
    const api = createCapCaller({ baseUrl: web.origin, token: () => token, routes: async () => routes });
    const open = async (screen: string, marker: string): Promise<void> => {
      await page.goto(`${web.origin}/console#screen=${screen}`, { waitUntil: "load" });
      await page.getByTestId("console").waitFor({ timeout: 20_000 });
      await page.locator(marker).waitFor({ timeout: 20_000 });
    };

    // ---- Skills
    await open("console.skills", '[data-testid="console-skills"]');
    await page.getByText("working-in-vyre", { exact: true }).first().waitFor();
    await page.getByTestId("skill-text").fill(SKILL);
    await page.getByTestId("skill-add").click();
    await page.getByText("matter-intake added", { exact: true }).waitFor();
    const list = (await api("skills.list", { includeOff: true }) as { skills: Array<{ name: string; tier: string; source: string }> }).skills;
    assert.deepEqual(list.filter((s) => s.name === "matter-intake").map((s) => [s.tier, s.source]), [["space", "upload"]]);
    await shoot("skills");
    await page.getByLabel("matter-intake is on", { exact: true }).click();
    await page.getByText("Skill off", { exact: true }).waitFor();
    assert.equal(((await api("skills.list", {}) as { skills: Array<{ name: string }> }).skills).some((s) => s.name === "matter-intake"), false, "switched off, it leaves the index");
    t.diagnostic("PASS Skills add and switch off, read back");

    // ---- Plugins
    await open("console.plugins", '[data-testid="console-plugins"]');
    await page.getByTestId("mk-source").fill(MARKET);
    await page.getByTestId("mk-add").click();
    await page.getByText("vyre-test-market added and allowed", { exact: true }).waitFor();
    await page.getByTestId("install-greeter").click();
    await page.getByText("greeter installed", { exact: true }).waitFor();
    await page.getByTestId("opt-echo_token").fill("#Eco_Echo.token");
    await page.getByTestId("plugin-config").click();
    await page.getByText("Options saved", { exact: true }).waitFor();
    const plugins = (await api("plugins.list", {}) as { plugins: Array<{ name: string; config: Record<string, string>; parts: { skills: string[]; commands: string[]; mcpServers: string[] } }> }).plugins;
    assert.deepEqual(plugins.map((p) => [p.name, p.config, p.parts.skills, p.parts.commands, p.parts.mcpServers]), [["greeter", { echo_token: "#Eco_Echo.token" }, ["greeting"], ["hello"], ["echo"]]]);
    await page.getByTestId("conn-name").fill("crm");
    await page.getByTestId("conn-url").fill("https://crm.example.com/mcp");
    await page.getByTestId("conn-header").fill("#Crm_Key.token");
    await page.getByTestId("conn-add").click();
    await page.getByText("Connected", { exact: true }).waitFor();
    const conns = (await api("plugins.connections.list", {}) as { connections: Array<{ name: string; headers: Record<string, string> }> }).connections;
    assert.deepEqual(conns.map((c) => [c.name, c.headers]), [["crm", { Authorization: "#Crm_Key.token" }]]);
    await shoot("plugins");
    await page.getByTestId("plugin-remove").click();
    await page.getByText("Plugin removed", { exact: true }).waitFor();
    assert.equal(((await api("plugins.list", {}) as { plugins: unknown[] }).plugins).length, 0);
    t.diagnostic("PASS Plugins add marketplace, install, set option, connect server and remove, read back");

    // ---- Teammates on a project
    const project = await api("projects.create", { type: "project", title: "Probate GTM", idempotencyKey: "eco-project" }) as { projectId: string };
    await page.goto(`${web.origin}/records#subject=project:${project.projectId}`, { waitUntil: "load" });
    await page.getByTestId("project-page").waitFor({ timeout: 20_000 });
    await page.getByText("Teammates", { exact: true }).first().click();
    await page.getByTestId("project-teammates").waitFor({ timeout: 10_000 });
    await page.getByTestId("teammate-name").fill("Coordinator");
    await page.getByTestId("teammate-brief").fill("Keeps the plan moving and answers first in this project's chats.");
    await page.getByTestId("teammate-role").click();
    await page.getByRole("menuitem", { name: /^Lead/ }).click();
    await page.getByTestId("teammate-add").click();
    await page.getByText("Coordinator joined the project", { exact: true }).waitFor();
    await page.getByTestId("teammate-name").fill("Security reviewer");
    await page.getByTestId("teammate-brief").fill("Checks every draft for privilege and confidentiality.");
    await page.getByTestId("teammate-role").click();
    await page.getByRole("menuitem", { name: /^Reviewer/ }).click();
    await page.getByTestId("teammate-add").click();
    await page.getByText("Security reviewer joined the project", { exact: true }).waitFor();
    const mates = await api("projects.teammates.list", { projectId: project.projectId }) as { teammates: Array<{ name: string; role: string; madeForProject: boolean }>; leadAgentId?: string };
    assert.deepEqual(mates.teammates.map((m) => [m.name, m.role, m.madeForProject]), [["Coordinator", "lead", true], ["Security reviewer", "reviewer", true]]);
    assert.ok(mates.leadAgentId, "the lead is the default participant");
    const onAgentsPage = ((await api("agents.list", {}) as { agents: Array<{ name: string }> }).agents).map((a) => a.name);
    assert.ok(!onAgentsPage.includes("Coordinator") && !onAgentsPage.includes("Security reviewer"), "teammates are not on the Agents page");
    await shoot("teammates");
    t.diagnostic("PASS Teammates: a lead and a reviewer made for the project, off the Agents page, read back");
    assert.deepEqual(errors, [], `page errors: ${errors.join(" | ")}`);
    assert.deepEqual(refused.filter((r) => !/^404 /.test(r)), [], `refused calls: ${refused.join(" | ")}`);
  } catch (e) {
    console.error("FAILED:", e instanceof Error ? e.message.slice(0, 600) : e, "| on screen:", (await page.locator("body").innerText({ timeout: 2000 }).catch(() => "")).replace(/\s+/g, " ").slice(0, 700), "| refused:", refused.join(" | "), "| errors:", errors.join(" | "));
    throw e;
  } finally { await browser.close(); await space.stop?.(); }
});
