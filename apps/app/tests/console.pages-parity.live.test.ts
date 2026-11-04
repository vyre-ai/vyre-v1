// Console page parity in Chromium against the production export and a fresh claimed daemon: every flow is driven through the real UI and read back from the server. Screenshots (desktop and phone,
// light "paper" and "graphite" skins) go to VYRE_CONSOLE_ACCESS_SHOTS for review.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import type { Page } from "playwright-core";
import { SECTIONS, resolve, sectionOf, tabOf } from "../src/console/shell/sections.ts";
import { bootFreshSpace, claimOnEdge, edge, dismissOnboarding} from "./real-app-harness.test.ts";

const KEYS = { personKeyByPassword: "cGVyc29uLWJ5LXBhc3N3b3Jk", publicKey: "cHVibGljLWtleQ==", privateKeyWrapped: "cHJpdmF0ZS13cmFwcGVk", spaceKeys: [{ epoch: 1, wrapped: "c3BhY2Uta2V5LTE=" }] };
const PASSWORD = "fixture password 123";
const MATRIX = [["paper", "desktop", 1280, 900], ["graphite", "desktop", 1280, 900], ["paper", "phone", 390, 844], ["graphite", "phone", 390, 844]] as const;

test("production Console: every page draws at desktop and phone, light and graphite, without overflow or a crash", async (t) => {
  const dist = process.env["VYRE_APP_DIST"];
  if (!dist) { if (process.env["VYRE_REQUIRE_CHROME"] === "1") assert.fail("VYRE_APP_DIST required"); t.skip("VYRE_APP_DIST required for production browser evidence"); return; }
  const { chromium } = await import("playwright-core");
  const exe = process.env["CHROME_BIN"] || chromium.executablePath();
  assert.ok(fs.existsSync(exe), `Chromium is required at ${exe}`);
  const space = await bootFreshSpace();
  const web = await edge(dist, space.url);
  const browser = await chromium.launch({ executablePath: exe, args: ["--no-sandbox"] });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const shots = process.env["VYRE_CONSOLE_PAGES_SHOTS"] ?? "/tmp/vyre-console-parity-shots"; fs.mkdirSync(shots, { recursive: true });
  try {
    await page.goto(claimOnEdge(space.claim!, web.origin), { waitUntil: "load" });
    await page.getByTestId("claim-name").fill("Olivia Owner"); await page.getByTestId("claim-username").fill("olivia");
    await page.getByTestId("claim-password").fill(PASSWORD); await page.getByTestId("claim-confirm").fill(PASSWORD);
    await page.getByTestId("claim-next").click(); await page.getByTestId("claim-saved").click(); await page.getByTestId("claim-create").click();await dismissOnboarding(page);
    await page.getByTestId("shell").waitFor({ timeout: 30_000 });
    const token = await page.evaluate(() => JSON.parse(localStorage.getItem("vyre.session.v1")!).sessions[location.origin].token as string);
    const call = async (cap: string, data: unknown, bearer = token): Promise<{ status: number; data: any }> => { // eslint-disable-line @typescript-eslint/no-explicit-any
      const r = await context.request.post(`${web.origin}/v1/${cap.replaceAll(".", "/")}`, { headers: { authorization: `Bearer ${bearer}` }, data });
      return { status: r.status(), data: (await r.json()).data };
    };
    const api = async (cap: string, data: unknown): Promise<any> => { const r = await call(cap, data); assert.equal(r.status, 200, `${cap}: ${JSON.stringify(r.data)}`); return r.data; }; // eslint-disable-line @typescript-eslint/no-explicit-any
    const roles = (await api("access.roles.list", {})).roles as { id: string; name: string }[];
    const roleId = (name: string): string => roles.find((r) => r.name === name)!.id;
    const join = async (username: string, displayName: string, role = "Member"): Promise<{ personId: string; token: string }> => {
      const inv = await api("members.invites.create", { role: roleId(role), idempotencyKey: `inv-${username}` });
      const code = decodeURIComponent(new URL(inv.link).pathname.split("/").pop()!);
      const r = await context.request.post(`${web.origin}/v1/members/accept`, { data: { code, username, displayName, password: PASSWORD, deviceName: `${displayName.split(" ")[0]}'s laptop`, deviceClass: "desktop", keys: KEYS } });
      assert.equal(r.status(), 200, await r.text()); return (await r.json()).data;
    };
    const maya = await join("maya", "Maya Lin"), noah = await join("noah", "Noah Park", "Developer"), priya = await join("priya", "Priya Rao");
    const sales = (await api("access.groups.create", { name: "Sales", idempotencyKey: "grp-sales" })).group.id as string;
    const support = (await api("access.groups.create", { name: "Support", idempotencyKey: "grp-support" })).group.id as string;
    await api("access.groups.add_member", { groupId: sales, member: { kind: "person", id: maya.personId } });
    const groupOf = async (id: string): Promise<string[]> => ((await api("access.groups.get", { groupId: id })).group.members as { id: string }[]).map((m) => m.id);
    const rolesOf = async (personId: string): Promise<string[]> => (await api("access.principals.get", { principal: { kind: "person", id: personId } })).principal.roles as string[];

    const matrix = async (name: string, navigate: (p: Page) => Promise<void>): Promise<void> => {
      for (const [skin, size, w, h] of MATRIX) {
        const view = await context.newPage(); await view.setViewportSize({ width: w, height: h });
        await view.goto(`${web.origin}/console?skin=${skin}`, { waitUntil: "load" }); await view.getByTestId("console").waitFor({ timeout: 30_000 });
        await navigate(view); await view.waitForTimeout(250);
        await view.screenshot({ path: path.join(shots, `${name}-${size}-${skin === "paper" ? "light" : "graphite"}.png`), animations: "disabled" }); await view.close();
      }
    };

    // the Console is ten places, each with a quiet tab strip (the plan in SETTINGS-CONSOLE-IA.md): the places, their order and their tabs are pinned here, so a place or tab that goes missing fails loudly
    const PLACES: [string, string[]][] = [["Home", ["Home"]], ["People", ["Members", "Teams", "Roles", "Requests"]], ["Agents", ["Space agents", "Outside agents", "Skills and plugins", "Activity", "Defaults for new agents"]],
      ["AI", ["AI accounts", "What each provider may see", "Spend and limits", "Approvals", "Review", "Voice", "AI use policy"]], ["Data", ["Record types", "Labels", "Keep and delete", "Backups", "Export"]],
      ["Messaging", ["Email", "Phone and texting", "Rules"]], ["Apps", ["Connected apps", "GitHub", "Developers"]], ["Computers", ["Overview", "Servers", "Agent computers", "CI runners", "Diagnostics"]],
      ["Security", ["Sign-in", "Access reviews", "Audit log"]], ["Space", ["General", "Billing", "Transfer or delete"]]];
    assert.deepEqual(SECTIONS.map((x) => [x.title, x.tabs.map((tab) => tab.label)]), PLACES, "the ten places and their tabs");
    // every page of every tab, reached through the real navigation (the side list, tab and view), at two renderings: it must draw (no crash card, no loading forever),
    // stay inside the screen (no sideways overflow of the page itself) and leave no page error. Old page ids still land on their place, so the old names are checked once on desktop below.
    const pages: [string, string][] = SECTIONS.flatMap((x) => x.tabs.flatMap((tab) => tab.views.map((view): [string, string] => [view.page, x.title])));
    const only = process.env["VYRE_PARITY_AREA"];
    const problems: string[] = [];
    /** One page through the navigation: the place row, the tab, then the view under the tab's text switch. */
    const open = async (p: Page, id: string): Promise<void> => {
      const section = sectionOf(id)!, tab = tabOf(id)!;
      await p.getByTestId(`row-nav-${section.id}`).click({ timeout: 60_000 }); if (section.tabs.length > 1) await p.getByTestId(`tab-${tab.views[0]!.page}`).click(); if (tab.views[0]!.page !== id) await p.getByTestId(`view-${id}`).click();
      await p.getByTestId(`page-${id}`).waitFor({ timeout: 15_000 });
    };
    await t.test("every page, desktop, light and graphite", async () => {
      for (const [skin, size, w, h] of [["paper", "desktop", 1280, 900], ["graphite", "desktop", 1280, 900]] as const) {
        const pageErrors: string[] = [];
        for (const [id, place] of pages) {
          if (only && place !== only) continue;
          const where = `${id} ${size} ${skin}`;
          // a fresh tab per page: a renderer crash on one page is that page's problem, not every page after it
          const p = await context.newPage(); await p.setViewportSize({ width: w, height: h });
          p.on("pageerror", (e) => pageErrors.push(e.message)); const logged: string[] = []; p.on("console", (m) => { if (m.type() === "error") logged.push(m.text().slice(0, 500)); });
          try {
            await p.goto(`${web.origin}/console?skin=${skin}`, { waitUntil: "load" }); await p.getByTestId("console").waitFor({ timeout: 30_000 });
            await open(p, id);
            await p.waitForFunction(() => !document.body.innerText.split("\n").some((line) => line.trim() === "Loading…"), null, { timeout: 15_000 }).catch(() => problems.push(`${where}: still loading after 15 s`));
            await p.waitForTimeout(300);
            if (await p.getByText("Couldn’t draw this page").count()) { await p.getByText("Details", { exact: true }).click({ timeout: 2000 }).catch(() => undefined); problems.push(`${where}: the page crashed: ${(await p.getByText("Couldn’t draw this page").locator("xpath=../..").innerText().catch(() => "")).replace(/\s+/g, " ").slice(0, 400)}`); }
            if (await p.getByText("is not implemented in this candidate yet").count()) problems.push(`${where}: the page is not implemented`);
            // the place's title and one-sentence subtitle sit under the page, and the tab strip shows the place's tabs (the Home place has a single tab and no strip)
            const section = sectionOf(id)!;
            if ((await p.getByTestId("page-subtitle").innerText().catch(() => null)) !== section.subtitle) problems.push(`${where}: the subtitle is not ${JSON.stringify(section.subtitle)}`);
            if (section.tabs.length > 1 && !(await p.getByTestId(`tab-${tabOf(id)!.views[0]!.page}`).count())) problems.push(`${where}: the tab strip does not show its tab`);
            // inside the app there is no stray health dot beside the title (owner ruling, 4 Nov 2026): Home's Health row says how the server is
            if (await p.getByTestId("console-health").count()) problems.push(`${where}: a health dot sits beside the title`);
            const overflow = await p.evaluate(() => ({ doc: document.documentElement.scrollWidth - window.innerWidth, body: document.body.scrollWidth - window.innerWidth }));
            if (overflow.doc > 2 || overflow.body > 2) problems.push(`${where}: the page is ${Math.max(overflow.doc, overflow.body)} px wider than the screen`);
            await p.screenshot({ path: path.join(shots, `${id}-${size}-${skin === "paper" ? "light" : "graphite"}.png`), animations: "disabled" });
          } catch (e) { problems.push(`${where}: ${String(e).split("\n")[0]!.slice(0, 140)}`); await p.getByText("Details", { exact: true }).click({ timeout: 2000 }).catch(() => undefined); fs.writeFileSync(path.join(shots, `fail-${where.replaceAll(" ", "-")}.txt`), `${pageErrors.join("\n")}\n${logged.join("\n")}\n${await p.locator("body").innerText().catch(() => "")}`); await p.screenshot({ path: path.join(shots, `fail-${where.replaceAll(" ", "-")}.png`) }).catch(() => undefined); }
          await p.close().catch(() => undefined);
        }
        if (pageErrors.length) problems.push(`${size} ${skin}: page errors ${pageErrors.slice(0, 2).join(" | ")}`);
      }
      fs.writeFileSync(path.join(shots, "problems.txt"), problems.join("\n"));
      assert.deepEqual(problems, []);
    });
    // the phone: the Console opens on a computer (owner ruling, 3 Nov 2026), so a phone never draws a Console page; it offers to chat about it, and the screen stays inside the width
    await t.test("on a phone the Console offers a chat instead of a page, light and graphite", async () => {
      for (const skin of ["paper", "graphite"]) {
        const p = await context.newPage(); await p.setViewportSize({ width: 1280, height: 900 });
        await p.goto(`${web.origin}/console?skin=${skin}`, { waitUntil: "load" }); await p.getByTestId("console").waitFor({ timeout: 30_000 });
        await p.setViewportSize({ width: 390, height: 844 });
        await p.getByText("The Console opens on a computer. You can chat about it here.").waitFor({ timeout: 10_000 });
        assert.equal(await p.getByTestId("console").count(), 0, `no Console page on a phone (${skin})`);
        const overflow = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        assert.ok(overflow <= 2, `the phone screen is ${overflow} px wider than the screen (${skin})`);
        await p.screenshot({ path: path.join(shots, `console-phone-${skin === "paper" ? "light" : "graphite"}.png`), animations: "disabled" }); await p.close();
      }
    });
    // the page ids of the old Console still land on their place: the old Computers register opens Computers, an old invites address opens Requests
    await t.test("an old page id lands on its new place", async () => {
      for (const [old, now] of [["computers", "machines"], ["checker", "people"], ["invites", "requests"], ["connectors", "apps"], ["runs", "activity"]] as const) {
        assert.equal(resolve(old), now, `${old} redirects to ${now}`);
        assert.ok(sectionOf(old), `${old} has a place`);
      }
    });
    assert.deepEqual(errors, []);
  } catch (error) {
    await page.screenshot({ path: path.join(shots, "failure.png") }).catch(() => undefined);
    fs.writeFileSync(path.join(shots, "failure.txt"), `${String(error)}\n${await page.locator("body").innerText().catch(() => "")}`);
    throw error;
  } finally { await context.close(); await browser.close(); web.close(); await space.stop(); fs.rmSync(space.dir, { recursive: true, force: true }); }
});
