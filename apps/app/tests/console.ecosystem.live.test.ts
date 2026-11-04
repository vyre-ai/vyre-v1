// Production web export against a fresh claimed Team Space: the Console pages for Skills and for Plugins and outside tools (CHAT-DESIGN rulings 4 and 6). An admin adds a skill by pasting it, adds a
// marketplace, installs a plugin, sets a secret option by Vault handle, connects an MCP server by address; every change is read back through the real gateway. Screenshots in light, dark and phone width
// go to VYRE_TEST_CAPTURE_DIR when it is set.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createCapCaller } from "../../../client/src/gateway/index.ts";
import { routes } from "../../../generated/routes.ts";
import { bootFreshSpace, claimOnEdge, edge, dismissOnboarding} from "./real-app-harness.test.ts";
import { openConsole, openConsolePage } from "./console-nav.ts";
import { guardCrashes } from "./crash-guard.ts";

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
  const guard = guardCrashes(page);
  const captureDir = process.env["VYRE_TEST_CAPTURE_DIR"];
  const shoot = async (name: string): Promise<void> => {
    await guard.check(`before screenshot ${name}`);
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
    /** A Console page the way a person reaches it: Agents, the Skills and plugins tab, then the Skills or Plugins view. */
    const open = async (pageId: string, marker: string): Promise<void> => {
      await openConsole(page, web.origin); await openConsolePage(page, pageId);
      await page.locator(marker).waitFor({ timeout: 20_000 }); await guard.check(`after opening ${pageId}`);
    };

    // ---- Skills
    await open("skills", '[data-testid="console-skills"]');
    await page.getByText("working-in-vyre", { exact: true }).first().waitFor();
    await page.getByTestId("skill-add").click();
    await page.getByTestId("skill-link").fill(SKILL);
    await page.getByTestId("skill-link-read").click();
    await page.getByTestId("skill-review-add").click();
    await page.getByTestId("row-skill-space-matter-intake").waitFor();
    const list = (await api("skills.list", { includeOff: true }) as { skills: Array<{ name: string; tier: string; source: string }> }).skills;
    assert.deepEqual(list.filter((s) => s.name === "matter-intake").map((s) => [s.tier, s.source]), [["space", "upload"]]);
    await shoot("skills");
    await page.getByLabel("matter-intake is on", { exact: true }).click();
    await page.locator('[data-testid="skill-space-on-matter-intake"][aria-checked="false"]').waitFor();
    assert.equal(((await api("skills.list", {}) as { skills: Array<{ name: string }> }).skills).some((s) => s.name === "matter-intake"), false, "switched off, it leaves the index");
    t.diagnostic("PASS Skills add and switch off, read back"); await guard.check("after Skills");

    // ---- Plugins
    await open("plugins", '[data-testid="console-plugins"]');
    await page.getByTestId("mk-new").click();
    await page.getByTestId("mk-source").fill(MARKET);
    await page.getByTestId("market-sheet").getByRole("button", { name: "Add marketplace", exact: true }).click();
    await page.getByText("vyre-test-market added and allowed", { exact: true }).waitFor();
    await page.getByTestId("install-greeter").click();
    await page.getByText("greeter installed", { exact: true }).waitFor();
    await page.getByTestId("opt-echo_token").fill("#Eco_Echo.token");
    await page.getByTestId("plugin-config").click();
    await page.getByText("Options saved", { exact: true }).waitFor();
    const plugins = (await api("plugins.list", {}) as { plugins: Array<{ name: string; config: Record<string, string>; parts: { skills: string[]; commands: string[]; mcpServers: string[] } }> }).plugins;
    assert.deepEqual(plugins.map((p) => [p.name, p.config, p.parts.skills, p.parts.commands, p.parts.mcpServers]), [["greeter", { echo_token: "#Eco_Echo.token" }, ["greeting"], ["hello"], ["echo"]]]);
    // outside tools live in Vault > Connections (owner ruling D28): the Console links there, and the server is added by its address for the whole Space
    await guard.check("after installing and configuring the plugin");
    await page.getByTestId("row-console-open-connections").click();
    await page.getByTestId("vault-connections").waitFor({ timeout: 20_000 });
    await page.getByTestId("connections-add").click();
    await page.getByTestId("connection-way-paste").click();
    await page.getByTestId("paste-input").fill("https://crm.example.com/mcp");
    await page.getByTestId("paste-continue").click();
    await page.getByTestId("setup-name").fill("crm");
    await page.getByTestId("scope-space").click();
    await page.getByTestId("setup-add").click();
    await page.getByTestId("connection-added").waitFor({ timeout: 20_000 });
    const conns = (await api("plugins.connections.list", {}) as { connections: Array<{ name: string; scope: string; source?: string }> }).connections;
    assert.deepEqual(conns.map((c) => [c.name, c.scope, c.source]), [["crm", "space", "paste"]]);
    await open("plugins", '[data-testid="console-plugins"]');
    await shoot("plugins");
    // Remove plugin sits on the plugin's own section: a person opens the installed plugin from the list first
    await page.getByTestId("row-plugin-greeter-space").click();
    await page.getByTestId("plugin-remove").click();
    await page.getByText("Plugin removed", { exact: true }).waitFor();
    assert.equal(((await api("plugins.list", {}) as { plugins: unknown[] }).plugins).length, 0);
    t.diagnostic("PASS Plugins add marketplace, install, set option, connect server and remove, read back"); await guard.check("after Plugins");

    // ---- Teammates on a project: opened from the project, then the project menu's Add people and agents (the one shared sheet): New agent for this project, then Add
    const project = await api("projects.create", { type: "project", title: "Probate GTM", idempotencyKey: "eco-project" }) as { projectId: string };
    await page.goto(`${web.origin}/records#subject=project:${project.projectId}`, { waitUntil: "load" });
    await page.getByTestId("project-page").waitFor({ timeout: 20_000 });
    for (const [name, brief, done] of [["Coordinator", "Keeps the plan moving and answers first in this project's chats.", "Coordinator was added"], ["Security reviewer", "Checks every draft for privilege and confidentiality.", "Security reviewer was added"]] as const) {
      await page.getByTestId("project-menu").click();
      await page.getByRole("menuitem", { name: /^Add People/ }).click();
      await page.getByTestId("as-new").click();
      await page.getByTestId("as-name").fill(name);
      await page.getByTestId("as-brief").fill(brief);
      await page.getByTestId("as-create").click();
      await page.getByTestId("as-add").click();
      await page.getByText(done, { exact: true }).waitFor();
      await guard.check(`after adding ${name}`);
    }
    // an agent made in the sheet from a project is one of the project's people: listed in projects.members.list, shown in the header's people popover, where a Lead gives it a role (Lead, Member, Reviewer, Guest)
    const members = (await api("projects.members.list", { projectId: project.projectId }) as { members: Array<{ principal: string; role: string; kind: string }> }).members.filter((m) => m.kind === "agent");
    assert.equal(members.length, 2, "both agents made for the project are members of it");
    const made = (await api("agents.list", { projectId: project.projectId }) as { agents: Array<{ agentId: string; name: string }> }).agents;
    assert.deepEqual(made.map((a) => a.name).sort(), ["Coordinator", "Security reviewer"], "both agents belong to the project");
    const setRole = async (name: string, role: string): Promise<void> => {
      await page.getByTestId("project-members").click();
      await page.getByTestId("people-popover").waitFor({ timeout: 15_000 });
      const row = page.locator('[data-testid^="people-row-"]').filter({ hasText: name });
      await row.click({ button: "right" }); await page.getByRole("menuitem", { name: "Change role", exact: true }).click();
      await page.getByRole("menuitem", { name: new RegExp(`^${role}`) }).click();
      const want = role.toLowerCase(), id = made.find((a) => a.name === name)!.agentId;
      for (let i = 0; i < 40; i++) { const got = ((await api("projects.members.list", { projectId: project.projectId }) as { members: Array<{ principal: string; role: string }> }).members).find((m) => m.principal === id)?.role; if (got === want) break; await new Promise((r) => setTimeout(r, 250)); }
      await guard.check(`after making ${name} ${role}`);
      await page.keyboard.press("Escape");
    };
    // the reviewer first: making another agent Lead hands the lead over, and only a Lead changes roles
    await setRole("Security reviewer", "Reviewer"); await setRole("Coordinator", "Lead");
    const roleOf = async (name: string): Promise<string | undefined> => ((await api("projects.members.list", { projectId: project.projectId }) as { members: Array<{ principal: string; role: string }> }).members).find((m) => m.principal === made.find((a) => a.name === name)!.agentId)?.role;
    assert.equal(await roleOf("Coordinator"), "lead", "the coordinator leads"); assert.equal(await roleOf("Security reviewer"), "reviewer", "the security reviewer reviews");
    const onAgentsPage = ((await api("agents.list", {}) as { agents: Array<{ name: string }> }).agents).map((a) => a.name);
    assert.ok(!onAgentsPage.includes("Coordinator") && !onAgentsPage.includes("Security reviewer"), "teammates are not on the Agents page");
    await shoot("teammates");
    t.diagnostic("PASS Teammates: two agents made for the project through its menu, a lead and a reviewer set on its people, off the Agents page, read back"); await guard.check("after Teammates");
    assert.deepEqual(errors, [], `page errors: ${errors.join(" | ")}`);
    assert.deepEqual(refused.filter((r) => !/^404 /.test(r)), [], `refused calls: ${refused.join(" | ")}`);
  } catch (e) {
    console.error("FAILED:", e instanceof Error ? e.message.slice(0, 600) : e, "| on screen:", (await page.locator("body").innerText({ timeout: 2000 }).catch(() => "")).replace(/\s+/g, " ").slice(0, 700), "| refused:", refused.join(" | "), "| errors:", errors.join(" | "));
    throw e;
  } finally { await browser.close(); await space.stop?.(); }
});
