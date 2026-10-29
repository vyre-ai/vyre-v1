// Console computers (enrollment) in Chromium against the production export and a fresh claimed daemon: every flow is driven through the real UI and read back from the server. Screenshots (desktop and phone,
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

test("production Console Network: a computer joins with a code, waits, is approved once, and is removed", async (t) => {
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
  const shots = process.env["VYRE_CONSOLE_COMPUTE_SHOTS"] ?? "/tmp/vyre-console-compute-shots"; fs.mkdirSync(shots, { recursive: true });
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

    const b64 = (b: ArrayBuffer): string => Buffer.from(b).toString("base64");
    const fresh = async () => {
      const pair = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"])) as CryptoKeyPair;
      const publicKey = b64(await crypto.subtle.exportKey("raw", pair.publicKey));
      const sign = async (serverId: string): Promise<{ at: number; signature: string }> => { const at = Date.now(); return { at, signature: b64(await crypto.subtle.sign({ name: "Ed25519" }, pair.privateKey, new TextEncoder().encode(`vyre-enroll:${serverId}:${at}`))) }; };
      return { publicKey, sign };
    };
    const anon = async (cap: string, data: unknown): Promise<{ status: number; data: any }> => { const r = await fetch(`${web.origin}/v1/${cap.replaceAll(".", "/")}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(data) }); return { status: r.status, data: (await r.json() as { data?: unknown }).data }; }; // eslint-disable-line @typescript-eslint/no-explicit-any
    const goNetwork = async (p: Page): Promise<void> => {
      if (p.viewportSize()!.width < 720) { await p.getByTestId("console-search").click(); await p.getByRole("menuitem", { name: "Network", exact: true }).click(); }
      else { const g = p.getByTestId("navgroup-Infrastructure"); if ((await g.getAttribute("aria-expanded")) !== "true") await g.click(); await p.getByTestId("row-nav-network").click(); }
      await p.getByTestId("console-network-infra").waitFor();
    };
    await t.test("a computer asks to join with a code, waits, and a person approves it with one click", async () => {
      await page.goto(`${web.origin}/console`, { waitUntil: "load" }); await page.getByTestId("console").waitFor({ timeout: 30_000 });
      await goNetwork(page);
      await page.getByTestId("computer-add").click(); await page.getByTestId("computer-join-command").waitFor();
      const command = await page.getByTestId("computer-join-command").innerText();
      assert.match(command, /^vyred --role compute --space \S+ --join VYRE-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
      const code = command.split("--join ")[1]!.trim();
      const node = await fresh();
      const asked = await anon("network.enroll", { code, publicKey: node.publicKey, name: "Office Linux box", facts: { os: "linux", arch: "x64", docker: true, version: "1.0.0" } });
      assert.equal(asked.status, 200, JSON.stringify(asked.data)); assert.equal(asked.data.state, "pending");
      assert.equal((await anon("network.enroll", { code, publicKey: (await fresh()).publicKey, name: "Reuse", facts: {} })).status >= 400, true, "a code works once");
      await page.reload({ waitUntil: "load" }); await goNetwork(page);
      await page.getByTestId("computers-waiting").waitFor();
      const text = await page.getByTestId("computers-waiting").innerText();
      assert.match(text, /Office Linux box/); assert.match(text, /Linux x64 · Docker ready/); assert.ok(text.includes(`Fingerprint ${asked.data.fingerprint}`), "the fingerprint on screen is the one the computer prints");
      await matrix("computers-waiting", async (p) => { await goNetwork(p); await p.getByTestId("computers-waiting").waitFor(); });
      let poll = await anon("network.enroll_status", { serverId: asked.data.serverId, ...(await node.sign(asked.data.serverId)) });
      assert.deepEqual([poll.data.state, poll.data.credential], ["pending", undefined]);
      await page.getByTestId(`computer-approve-${asked.data.serverId}`).click();
      await page.getByTestId("computers-waiting").waitFor({ state: "detached" });
      poll = await anon("network.enroll_status", { serverId: asked.data.serverId, ...(await node.sign(asked.data.serverId)) });
      assert.equal(poll.data.state, "approved"); assert.match(poll.data.credential, /^vcc_/);
      assert.equal((await anon("network.enroll_status", { serverId: asked.data.serverId, ...(await node.sign(asked.data.serverId)) })).data.credential, undefined, "the credential is handed over once");
      assert.ok((await page.getByTestId("computers-list").innerText()).includes("Office Linux box"));
      await matrix("computers-admitted", async (p) => { await goNetwork(p); await p.getByTestId("computers-list").waitFor(); });
      // someone else's key cannot ask about this row
      assert.equal((await anon("network.enroll_status", { serverId: asked.data.serverId, ...(await (await fresh()).sign(asked.data.serverId)) })).status >= 400, true);
      await page.getByTestId(`computer-remove-${asked.data.serverId}`).click();
      assert.match(await page.getByText(/Remove Office Linux box\?/).first().innerText(), /access ends at once/);
      await page.getByTestId("computer-remove-confirm").click();
      await eventually(async () => !((await api("network.servers", {})).servers as { serverId: string }[]).some((s) => s.serverId === asked.data.serverId), "the computer is gone");
      poll = await anon("network.enroll_status", { serverId: asked.data.serverId, ...(await node.sign(asked.data.serverId)) });
      assert.equal(poll.data.state, "revoked");
    });
    await t.test("a computer that is declined never gets in", async () => {
      await page.goto(`${web.origin}/console`, { waitUntil: "load" }); await page.getByTestId("console").waitFor({ timeout: 30_000 }); await goNetwork(page);
      await page.getByTestId("computer-add").click(); await page.getByTestId("computer-join-command").waitFor();
      const code = (await page.getByTestId("computer-join-command").innerText()).split("--join ")[1]!.trim();
      const node = await fresh();
      const asked = await anon("network.enroll", { code, publicKey: node.publicKey, name: "Stranger", facts: { os: "win32", arch: "x64", docker: false, version: "1.0.0" } });
      await page.reload({ waitUntil: "load" }); await goNetwork(page);
      assert.match(await page.getByTestId("computers-waiting").innerText(), /Windows x64 · No Docker/);
      await page.getByTestId(`computer-decline-${asked.data.serverId}`).click();
      await eventually(async () => (await anon("network.enroll_status", { serverId: asked.data.serverId, ...(await node.sign(asked.data.serverId)) })).data.state === "declined", "the computer is told no");
    });
    assert.deepEqual(errors, []);
  } catch (error) {
    await page.screenshot({ path: path.join(shots, "failure.png") }).catch(() => undefined);
    fs.writeFileSync(path.join(shots, "failure.txt"), `${String(error)}\n${await page.locator("body").innerText().catch(() => "")}`);
    throw error;
  } finally { await context.close(); await browser.close(); web.close(); await space.stop(); fs.rmSync(space.dir, { recursive: true, force: true }); }
});
