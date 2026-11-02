// Console page parity in Chromium against the production export and a fresh claimed daemon: every flow is driven through the real UI and read back from the server. Screenshots (desktop and phone,
// light "paper" and "graphite" skins) go to VYRE_CONSOLE_ACCESS_SHOTS for review.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import type { Page } from "playwright-core";
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

    // every Console page, reached through the real navigation (the side list on desktop, the grouped Go to menu on a phone), at four renderings: it must draw (no crash card, no loading forever),
    // stay inside the screen (no sideways overflow of the page itself) and leave no page error
    const pages: [string, string, string][] = [["overview","Overview",""],["usage","Usage",""],["people","People","Access"],["groups","Groups","Access"],["roles","Roles","Access"],["grants","Grants","Access"],["policies","Policies","Access"],["checker","Access checker","Access"],["reviews","Access reviews","Access"],["sessions","Sessions and devices","Access"],["agents","Agents register","Agents and actors"],["actors","Outside actors","Agents and actors"],["computers","Agent computers","Agents and actors"],["template","Agent template","Agents and actors"],["schema","Schema","Data"],["labels","Sensitivity labels","Data"],["retention","Retention","Data"],["holds","Holds","Data"],["erase","Erase a person","Data"],["backups","Backups","Data"],["export","Export","Data"],["models","Models and providers","AI"],["gate","Gate rules","AI"],["spend","Spend and limits","AI"],["review","Review sampling","AI"],["incidents","Incidents","AI"],["aipolicy","AI use policy","AI"],["domains","Sending domains","Comms"],["numbers","Numbers","Comms"],["inboxes","Shared inboxes","Comms"],["texting","Texting registration","Comms"],["connectors","Connectors","Integrations"],["connections","Connections","Integrations"],["webhooks","Webhooks","Integrations"],["keys","API keys","Integrations"],["network","Network","Infrastructure"],["server","Server","Infrastructure"],["updates","Updates","Infrastructure"],["diagnostics","Diagnostics","Infrastructure"],["support","Support bundle","Infrastructure"],["speed","Speed","Infrastructure"],["audit","Audit log",""],["space","Space",""]];
    const only = process.env["VYRE_PARITY_AREA"];
    const problems: string[] = [];
    await t.test("every page, four renderings", async () => {
      for (const [skin, size, w, h] of [["paper", "desktop", 1280, 900], ["graphite", "desktop", 1280, 900], ["paper", "phone", 390, 844], ["graphite", "phone", 390, 844]] as const) {
        const p = await context.newPage(); await p.setViewportSize({ width: w, height: h });
        const pageErrors: string[] = []; p.on("pageerror", (e) => pageErrors.push(e.message));
        for (const [id, title, group] of pages) {
          if (only && group !== only && !(only === "Account" && group === "")) continue;
          const where = `${id} ${size} ${skin}`;
          try {
            await p.goto(`${web.origin}/console?skin=${skin}`, { waitUntil: "load" }); await p.getByTestId("console").waitFor({ timeout: 30_000 });
            if (w < 720) { await p.getByTestId("console-search").click(); await p.getByRole("menuitem", { name: title, exact: true }).click(); }
            else { if (group) { const g = p.getByTestId(`navgroup-${group}`); if ((await g.getAttribute("aria-expanded")) !== "true") await g.click(); } await p.getByTestId(`row-nav-${id}`).click(); }
            await p.waitForFunction(() => !document.body.innerText.split("\n").some((line) => line.trim() === "Loading…"), null, { timeout: 15_000 }).catch(() => problems.push(`${where}: still loading after 15 s`));
            await p.waitForTimeout(300);
            if (await p.getByText("Couldn’t draw this page").count()) problems.push(`${where}: the page crashed`);
            // the dot beside "Console" must tell the truth: it reads the server's own overall health (health.status), on every page and in every rendering
            let dot: string | null = null, overall: string | undefined;
            for (let i = 0; i < 30; i++) { overall = (await call("health.status", {})).data?.overall as string | undefined; dot = await p.getByTestId("console-health").getAttribute("aria-label").catch(() => null); if (dot === `Server ${overall}`) break; await p.waitForTimeout(500); }   // the dot catches up with a change within a few seconds
            if (dot !== `Server ${overall}`) problems.push(`${where}: the health dot reads ${JSON.stringify(dot)} but the server reports ${JSON.stringify(overall)}`);
            const overflow = await p.evaluate(() => ({ doc: document.documentElement.scrollWidth - window.innerWidth, body: document.body.scrollWidth - window.innerWidth }));
            if (overflow.doc > 2 || overflow.body > 2) problems.push(`${where}: the page is ${Math.max(overflow.doc, overflow.body)} px wider than the screen`);
            await p.screenshot({ path: path.join(shots, `${id}-${size}-${skin === "paper" ? "light" : "graphite"}.png`), animations: "disabled" });
          } catch (e) { problems.push(`${where}: ${String(e).split("\n")[0]!.slice(0, 140)}`); }
        }
        if (pageErrors.length) problems.push(`${size} ${skin}: page errors ${pageErrors.slice(0, 2).join(" | ")}`);
        await p.close();
      }
      fs.writeFileSync(path.join(shots, "problems.txt"), problems.join("\n"));
      assert.deepEqual(problems, []);
    });
    assert.deepEqual(errors, []);
  } catch (error) {
    await page.screenshot({ path: path.join(shots, "failure.png") }).catch(() => undefined);
    fs.writeFileSync(path.join(shots, "failure.txt"), `${String(error)}\n${await page.locator("body").innerText().catch(() => "")}`);
    throw error;
  } finally { await context.close(); await browser.close(); web.close(); await space.stop(); fs.rmSync(space.dir, { recursive: true, force: true }); }
});
