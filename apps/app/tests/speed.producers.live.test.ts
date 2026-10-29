// Speed producers in Chromium against the production export and a fresh claimed daemon: every flow is driven through the real UI and read back from the server. Screenshots (desktop and phone,
// light "paper" and "graphite" skins) go to VYRE_CONSOLE_ACCESS_SHOTS for review.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import type { Page } from "playwright-core";
import { bootFreshSpace, claimOnEdge, edge } from "./real-app-harness.test.ts";

const KEYS = { personKeyByPassword: "cGVyc29uLWJ5LXBhc3N3b3Jk", publicKey: "cHVibGljLWtleQ==", privateKeyWrapped: "cHJpdmF0ZS13cmFwcGVk", spaceKeys: [{ epoch: 1, wrapped: "c3BhY2Uta2V5LTE=" }] };
const PASSWORD = "fixture password 123";
const MATRIX = [["paper", "desktop", 1280, 900], ["graphite", "desktop", 1280, 900], ["paper", "phone", 390, 844], ["graphite", "phone", 390, 844]] as const;

test("production app: the real startup and Cmd-K measurements reach Console, Speed", async (t) => {
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
  const shots = process.env["VYRE_SPEED_SHOTS"] ?? "/tmp/vyre-speed-producers-shots"; fs.mkdirSync(shots, { recursive: true });
  try {
    await page.goto(claimOnEdge(space.claim!, web.origin), { waitUntil: "load" });
    await page.getByTestId("claim-name").fill("Olivia Owner"); await page.getByTestId("claim-username").fill("olivia");
    await page.getByTestId("claim-password").fill(PASSWORD); await page.getByTestId("claim-confirm").fill(PASSWORD);
    await page.getByTestId("claim-next").click(); await page.getByTestId("claim-saved").click(); await page.getByTestId("claim-create").click();
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

    const goPeople = async (p: Page = page): Promise<void> => {
      await p.goto(`${web.origin}/console`, { waitUntil: "load" }); await p.getByTestId("console").waitFor({ timeout: 30_000 });
      const group = p.getByTestId("navgroup-Access"); if ((await group.getAttribute("aria-expanded")) !== "true") await group.click();
      await p.getByTestId("row-nav-people").click(); await p.getByTestId("console-people").waitFor();
    };
    const rowOf = (id: string) => page.getByTestId(`row-object-row-console-person-${id}`);
    const pickRow = async (id: string): Promise<void> => { await rowOf(id).click({ button: "right" }); await page.getByRole("menuitem", { name: /^Select$/ }).click(); };
    const matrix = async (name: string, navigate: (p: Page) => Promise<void>): Promise<void> => {
      for (const [skin, size, w, h] of MATRIX) {
        const view = await context.newPage(); await view.setViewportSize({ width: w, height: h });
        await view.goto(`${web.origin}/console?skin=${skin}`, { waitUntil: "load" }); await view.getByTestId("console").waitFor({ timeout: 30_000 });
        await navigate(view); await view.waitForTimeout(250);
        await view.screenshot({ path: path.join(shots, `${name}-${size}-${skin === "paper" ? "light" : "graphite"}.png`), animations: "disabled" }); await view.close();
      }
    };
    /** Phone width has no side navigation: the search button opens the "Go to" list. */
    /** Wait for the server to show what the UI just did (a note can come and go with the sheet). */
    const eventually = async (read: () => Promise<boolean>, what: string): Promise<void> => { for (let i = 0; i < 60; i++) { if (await read()) return; await new Promise((r) => setTimeout(r, 200)); } assert.fail(what); };
    const goTo = async (p: Page, testId: string, title: string, group: string): Promise<void> => {
      if (p.viewportSize()!.width < 720) { await p.getByTestId("console-search").click(); await p.getByRole("menuitem", { name: title, exact: true }).click(); }
      else { const g = p.getByTestId(`navgroup-${group}`); if ((await g.getAttribute("aria-expanded")) !== "true") await g.click(); await p.getByTestId(`row-nav-${testId}`).click(); }
    };
    const toPeople = async (p: Page): Promise<void> => { await goTo(p, "people", "People", "Access"); await p.getByTestId("console-people").waitFor(); };

    await t.test("the app's own start-to-usable time arrives as a startup span from this device", async () => {
      let found: { spans: { name: string; durUs: number; attrs?: { source?: string; device?: string; value?: number } }[] } = { spans: [] };
      for (let i = 0; i < 40 && found.spans.length === 0; i++) { found = await api("logs.spans", { name: "startup" }); if (!found.spans.length) await new Promise((r) => setTimeout(r, 500)); }
      assert.ok(found.spans.length >= 1, "a startup sample reached the Space");
      const s = found.spans[0]!;
      assert.equal(s.attrs?.source, "device");
      assert.ok(s.durUs > 0 && s.durUs < 120_000_000, `a believable startup time: ${s.durUs} us`);
    });
    await t.test("a real Cmd-K search is measured locally and uploaded as a search span", async () => {
      await page.goto(`${web.origin}/chats`, { waitUntil: "load" }); await page.getByTestId("shell").waitFor({ timeout: 30_000 });
      await page.keyboard.press("Control+K"); await page.getByTestId("cmdk-input").waitFor({ timeout: 10_000 });
      await page.getByTestId("cmdk-input").type("hello", { delay: 30 });
      let found: { spans: { name: string; durUs: number; attrs?: { source?: string } }[] } = { spans: [] };
      for (let i = 0; i < 40 && found.spans.length === 0; i++) { found = await api("logs.spans", { name: "search" }); if (!found.spans.length) await new Promise((r) => setTimeout(r, 500)); }
      assert.ok(found.spans.length >= 1, "a search sample reached the Space");
      assert.equal(found.spans[0]!.attrs?.source, "device");
      assert.ok(found.spans[0]!.durUs >= 0 && found.spans[0]!.durUs < 5_000_000);
    });
    await t.test("Console, Speed shows both budgets with real numbers", async () => {
      await page.goto(`${web.origin}/console`, { waitUntil: "load" }); await page.getByTestId("console").waitFor({ timeout: 30_000 });
      const g = page.getByTestId("navgroup-Infrastructure"); if ((await g.getAttribute("aria-expanded")) !== "true") await g.click();
      await page.getByTestId("row-nav-speed").click(); await page.getByTestId("console-speed-infra").waitFor();
      await page.getByTestId("row-speed-startup").waitFor({ timeout: 20_000 }); await page.getByTestId("row-speed-search").waitFor({ timeout: 20_000 });
      assert.match(await page.getByTestId("row-speed-startup").innerText(), /Median .* · p95 .* · Target at most/);
      for (const [skin, size, w, h] of [["paper", "desktop", 1280, 900], ["graphite", "phone", 390, 844]] as const) {
        const p = await context.newPage(); await p.setViewportSize({ width: w, height: h });
        await p.goto(`${web.origin}/console?skin=${skin}`, { waitUntil: "load" }); await p.getByTestId("console").waitFor({ timeout: 30_000 });
        if (w < 720) { await p.getByTestId("console-search").click(); await p.getByRole("menuitem", { name: "Speed", exact: true }).click(); }
        else { const gg = p.getByTestId("navgroup-Infrastructure"); if ((await gg.getAttribute("aria-expanded")) !== "true") await gg.click(); await p.getByTestId("row-nav-speed").click(); }
        await p.getByTestId("row-speed-startup").waitFor({ timeout: 20_000 }); await p.screenshot({ path: path.join(shots, `speed-${size}-${skin === "paper" ? "light" : "graphite"}.png`), animations: "disabled" }); await p.close();
      }
    });
    assert.deepEqual(errors, []);
  } catch (error) {
    await page.screenshot({ path: path.join(shots, "failure.png") }).catch(() => undefined);
    fs.writeFileSync(path.join(shots, "failure.txt"), `${String(error)}\n${await page.locator("body").innerText().catch(() => "")}`);
    throw error;
  } finally { await context.close(); await browser.close(); web.close(); await space.stop(); fs.rmSync(space.dir, { recursive: true, force: true }); }
});
