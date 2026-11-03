// Console > Permissions in Chromium against the production export and a fresh claimed daemon (owner approved, 3 Nov 2026): the matrix with a cell's people who differ, Add an exception with
// its Who picker drawn above the sheet, People > a person > Access with their exceptions, the Access checker's In the app, the Audit log's rows, and the phone's read-only grid.
// Screenshots at 1280 in Vyre Light and Vyre Black (and the phone) go to VYRE_PERMS_SHOTS for review.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import type { Page } from "playwright-core";
import { bootFreshSpace, claimOnEdge, edge, dismissOnboarding } from "./real-app-harness.test.ts";

const KEYS = { personKeyByPassword: "cGVyc29uLWJ5LXBhc3N3b3Jk", publicKey: "cHVibGljLWtleQ==", privateKeyWrapped: "cHJpdmF0ZS13cmFwcGVk", spaceKeys: [{ epoch: 1, wrapped: "c3BhY2Uta2V5LTE=" }] };
const PASSWORD = "fixture password 123";

test("production Console Permissions: matrix, exceptions, the person page, the checker, the audit log and the phone", async (t) => {
  const dist = process.env["VYRE_APP_DIST"];
  if (!dist) { t.skip("VYRE_APP_DIST required for production browser evidence"); return; }
  const { chromium } = await import("playwright-core");
  const exe = process.env["CHROME_BIN"] || chromium.executablePath();
  const space = await bootFreshSpace();
  const web = await edge(dist, space.url);
  const browser = await chromium.launch({ executablePath: exe, args: ["--no-sandbox"] });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const shots = process.env["VYRE_PERMS_SHOTS"] ?? "/tmp/vyre-perms-shots"; fs.mkdirSync(shots, { recursive: true });
  try {
    await page.goto(claimOnEdge(space.claim!, web.origin), { waitUntil: "load" });
    await page.getByTestId("claim-name").fill("Irfad Imtiaz"); await page.getByTestId("claim-username").fill("irfad");
    await page.getByTestId("claim-password").fill(PASSWORD); await page.getByTestId("claim-confirm").fill(PASSWORD);
    await page.getByTestId("claim-next").click(); await page.getByTestId("claim-saved").click(); await page.getByTestId("claim-create").click(); await dismissOnboarding(page);
    await page.getByTestId("shell").waitFor({ timeout: 30_000 });
    const token = await page.evaluate(() => JSON.parse(localStorage.getItem("vyre.session.v1")!).sessions[location.origin].token as string);
    const api = async (cap: string, data: unknown): Promise<any> => { // eslint-disable-line @typescript-eslint/no-explicit-any
      const r = await context.request.post(`${web.origin}/v1/${cap.replaceAll(".", "/")}`, { headers: { authorization: `Bearer ${token}` }, data });
      const body = await r.json(); assert.equal(r.status(), 200, `${cap}: ${JSON.stringify(body)}`); return body.data;
    };
    const roles = (await api("access.roles.list", {})).roles as { id: string; name: string }[];
    const join = async (username: string, displayName: string, role: string): Promise<string> => {
      const inv = await api("members.invites.create", { role: roles.find((r) => r.name === role)!.id, idempotencyKey: `inv-${username}` });
      const code = decodeURIComponent(new URL(inv.link).pathname.split("/").pop()!);
      const r = await context.request.post(`${web.origin}/v1/members/accept`, { data: { code, username, displayName, password: PASSWORD, deviceName: "Laptop", deviceClass: "desktop", keys: KEYS } });
      assert.equal(r.status(), 200, await r.text()); return (await r.json()).data.personId as string;
    };
    const omar = await join("omar", "Omar Haddad", "Member"), lena = await join("lena", "Lena Ortiz", "Member"), dana = await join("dana", "Dana Whitfield", "Member"), elena = await join("elena", "Elena Rivera", "Guest");
    await join("maya", "Maya Chen", "Admin");
    const delivery = (await api("access.groups.create", { name: "Delivery", members: [{ kind: "person", id: omar }, { kind: "person", id: lena }], idempotencyKey: "grp-d" })).group.id as string;
    await api("access.exceptions.set", { subject: { kind: "person", id: omar }, perms: ["automations.space"], effect: "allow", why: "Runs the team's intake automations", idempotencyKey: "x1" });
    await api("access.exceptions.set", { subject: { kind: "group", id: delivery }, perms: ["sites.domains"], effect: "allow", why: "Delivery ships the client sites", idempotencyKey: "x2" });
    await api("access.exceptions.set", { subject: { kind: "person", id: dana }, area: "agents", effect: "deny", until: Date.now() + 7 * 86_400_000, why: "First week: the Space's agents only", idempotencyKey: "x3" });
    await api("access.exceptions.set", { subject: { kind: "person", id: elena }, perms: ["files.write"], effect: "allow", why: "Uploads signed documents", idempotencyKey: "x4" });
    const maya = (await api("access.principals.list", { kind: "person" })).principals.find((p: { name: string }) => p.name === "Maya Chen").id as string;
    await api("access.exceptions.set", { subject: { kind: "person", id: maya }, area: "sites", effect: "own", why: "Staging only this month", idempotencyKey: "x5" });

    const open = async (p: Page, nav: string, testId: string, skin = "vyre-light"): Promise<void> => {
      await p.goto(`${web.origin}/console?skin=${skin}`, { waitUntil: "load" }); await p.getByTestId("console").waitFor({ timeout: 30_000 });
      const group = p.getByTestId("navgroup-Access"); if ((await group.count()) && (await group.getAttribute("aria-expanded")) !== "true") await group.click();
      await p.getByTestId(`row-nav-${nav}`).click(); await p.getByTestId(testId).waitFor({ timeout: 20_000 });
    };
    const shot = async (p: Page, name: string): Promise<void> => { await p.waitForTimeout(300); await p.screenshot({ path: path.join(shots, name), animations: "disabled" }); };

    for (const skin of ["vyre-light", "vyre-black"]) {
      const view = await context.newPage(); await view.setViewportSize({ width: 1280, height: 900 });
      await view.goto(`${web.origin}/console?skin=${skin}`, { waitUntil: "load" });
      await open(view, "permissions", "console-permissions", skin);
      await view.getByTestId("perm-area-automations").waitFor();
      await shot(view, `perms-matrix-${skin}.png`);
      // the cell with a person who differs: its menu lists them
      await view.getByTestId("perm-cell-rol_member-automations.space").click();
      await view.getByRole("menuitem", { name: /Omar Haddad/ }).waitFor();
      await shot(view, `perms-cell-${skin}.png`);
      await view.keyboard.press("Escape");
      // Preview as a role, then as a person
      await view.getByTestId("perms-preview-as").click(); await view.getByRole("menuitem", { name: /^Member/ }).click();
      await view.getByTestId("perms-preview").waitFor(); await view.getByText("Member sees", { exact: true }).waitFor();
      await shot(view, `perms-preview-role-${skin}.png`);
      await view.getByTestId("perms-preview-as").click(); await view.getByRole("menuitem", { name: /^Dana Whitfield/ }).click();
      await view.getByText("Dana Whitfield sees", { exact: true }).waitFor();
      await shot(view, `perms-preview-person-${skin}.png`);
      await view.getByTestId("perms-preview-as").click(); await view.getByRole("menuitem", { name: /Stop previewing/ }).click();
      // Add an exception from a cell; Own only is offered on an area with an own and a Space part
      await view.getByTestId("perm-cell-rol_member-automations.space").click();
      await view.getByRole("menuitem", { name: /Add an exception/ }).click();
      await view.getByTestId("exception-sheet").waitFor();
      await view.getByTestId("exception-sheet").getByRole("button", { name: "What", exact: true }).click(); await view.getByRole("menuitem", { name: "All of Automations", exact: true }).click();
      await view.getByTestId("exception-sheet").getByText("Own only", { exact: true }).click();
      await view.getByText(/^Own only: Automations/).waitFor();
      await shot(view, `perms-add-own-${skin}.png`);
      await view.getByRole("button", { name: "Who", exact: true }).click();
      const item = view.getByRole("menuitem", { name: /Lena Ortiz/ });
      await item.waitFor();
      // the Who menu is drawn above the sheet: the topmost element at its row is the menu's row
      const box = (await item.boundingBox())!;
      const top = await view.evaluate(([x, y]) => { const el = document.elementFromPoint(x!, y!); return el ? (el.closest("[role=menuitem]") ? "menu" : el.closest("[role=dialog]") ? "sheet" : "other") : "none"; }, [box.x + 10, box.y + box.height / 2]);
      assert.equal(top, "menu", "the Who menu sits above the sheet");
      assert.ok(box.x >= 0 && box.x + box.width <= 1280, "and inside the window");
      await shot(view, `perms-who-${skin}.png`);
      await view.keyboard.press("Escape"); await view.keyboard.press("Escape");
      // People > Dana > Access
      await open(view, "people", "console-people", skin);
      await view.getByText("Dana Whitfield", { exact: true }).first().click();
      await view.getByRole("tab", { name: /Access/ }).click().catch(async () => { await view.getByText("Access", { exact: true }).first().click(); });
      await view.getByTestId("person-exceptions").waitFor(); await view.getByTestId("person-can-do").waitFor();
      assert.equal(await view.getByText("automations personal").count(), 0, "no permission keys on the person's page");
      await shot(view, `perms-person-${skin}.png`);
      await view.getByTestId("person-what").scrollIntoViewIfNeeded(); await view.mouse.wheel(0, 500);
      await shot(view, `perms-person-more-${skin}.png`);
      await open(view, "checker", "console-checker", skin);
      await view.getByTestId("checker-in-app").waitFor();
      await shot(view, `perms-checker-${skin}.png`);
      await view.close();
    }
    // the checker answers in plain words, the Audit log has the rows
    const why = await api("access.exceptions.explain", { principal: dana, perm: "agents.create" });
    assert.equal(why.allowed, false); assert.match(why.words, /^Exception set by Irfad on .*, overrides Member: Allowed\. Reason: First week/);
    const audit = (await api("audit.list", { limit: 50 })).rows as Array<{ action: string }>;
    assert.ok(audit.filter((r) => r.action === "access.exceptions.set").length >= 4, "every exception added is in the Audit log");
    // the phone: one role at a time, read only
    // the phone: the Console opens on a computer (owner ruling, 3 Nov 2026), so a phone never shows a grid to press; it offers to chat about it
    for (const skin of ["vyre-light", "vyre-black"]) {
      const phone = await context.newPage(); await phone.setViewportSize({ width: 1280, height: 900 });
      await open(phone, "permissions", "console-permissions", skin);
      await phone.setViewportSize({ width: 390, height: 844 });
      await phone.getByText("The Console opens on a computer. You can chat about it here.").waitFor({ timeout: 10_000 });
      assert.equal(await phone.getByTestId("perm-cell-rol_member-automations.space").count(), 0, "no cell to press on a phone");
      await shot(phone, `perms-phone-${skin}.png`);
      await phone.close();
    }
    assert.deepEqual(errors, []);
  } catch (error) { console.error(`Permissions browser failure: ${await page.locator("body").innerText().catch(() => "No page")}`.slice(0, 2000)); throw error; }
  finally { await context.close(); await browser.close(); web.close(); await space.stop(); fs.rmSync(space.dir, { recursive: true, force: true }); }
});
