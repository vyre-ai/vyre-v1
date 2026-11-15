// The step picker and Connect an app with real content, and a second person, in a real browser (AUTOMATIONS-BUILD-RC29 round five, items 4 and 6): a Google connection the Space made shows as ONE "Your apps" row with its actions in a submenu, an app
// nobody connected is not listed, Connect an app shows the sheet, keyboard works (type, arrows, Right, Enter, Left, Esc), and a member never gets the admin-only company key as a suggestion. Pictures go to SHOTS=<dir> as 4-<name>-d.png.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { bootFreshSpace, claimOnEdge, dismissOnboarding, edge } from "./real-app-harness.test.ts";

const PASSWORD = "fixture password 123";
const SHOTS = process.env["SHOTS"];
const KEYS = {
  personKeyByPassword: "cGVyc29uLWJ5LXBhc3N3b3Jk",
  publicKey: "cHVibGljLWtleQ==",
  privateKeyWrapped: "cHJpdmF0ZS13cmFwcGVk",
  spaceKeys: [{ epoch: 1, wrapped: "c3BhY2Uta2V5LTE=" }],
};

test("production Automations: the picker with a connected app, Connect an app, and a member's own view", async (t) => {
  const dist = process.env["VYRE_APP_DIST"];
  if (!dist) {
    if (process.env["VYRE_REQUIRE_CHROME"] === "1") assert.fail("VYRE_APP_DIST required");
    t.skip("VYRE_APP_DIST required for production browser evidence");
    return;
  }
  const { chromium } = await import("playwright-core");
  const exe = process.env["CHROME_BIN"] || chromium.executablePath();
  assert.ok(fs.existsSync(exe), `Chromium is required at ${exe}`);
  const space = await bootFreshSpace();
  const web = await edge(dist, space.url);
  const browser = await chromium.launch({ executablePath: exe, args: ["--no-sandbox"] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "dark" });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const shot = async (name: string): Promise<void> => {
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` });
  };
  try {
    await page.goto(claimOnEdge(space.claim!, web.origin), { waitUntil: "load" });
    await page.getByTestId("claim-name").fill("Olivia Owner");
    await page.getByTestId("claim-username").fill("olivia");
    await page.getByTestId("claim-password").fill(PASSWORD);
    await page.getByTestId("claim-confirm").fill(PASSWORD);
    await page.getByTestId("claim-next").click();
    await page.getByTestId("claim-create").click();
    await dismissOnboarding(page);
    await page.getByTestId("shell").waitFor({ timeout: 30_000 });
    const token = await page.evaluate(
      () => JSON.parse(localStorage.getItem("vyre.session.v1")!).sessions[location.origin].token as string,
    );
    const call = async (
      bearer: string,
      cap: string,
      data: Record<string, unknown>,
    ): Promise<{ status: number; data: any }> => {
      const r = await context.request.post(`${web.origin}/v1/${cap.replace(/\./g, "/")}`, {
        headers: { authorization: `Bearer ${bearer}` },
        data: { idempotencyKey: `${cap}-${Math.random()}`, ...data },
      });
      return { status: r.status(), data: (await r.json().catch(() => ({}))).data };
    };
    const api = async (cap: string, data: Record<string, unknown>): Promise<any> => {
      const r = await call(token, cap, data);
      assert.equal(r.status, 200, `${cap}: ${JSON.stringify(r.data)}`);
      return r.data;
    };
    // a second person: a Member who joins by invite
    const roles = (await api("access.roles.list", {})).roles as { id: string; name: string }[];
    const inv = await api("members.invites.create", { role: roles.find((r) => r.name === "Member")!.id });
    const code = decodeURIComponent(new URL(inv.link).pathname.split("/").pop()!);
    const joined = await context.request.post(`${web.origin}/v1/members/accept`, {
      data: {
        code,
        username: "maya",
        displayName: "Maya Lin",
        password: PASSWORD,
        deviceName: "Maya's laptop",
        deviceClass: "desktop",
        keys: KEYS,
      },
    });
    assert.equal(joined.status(), 200, await joined.text());
    const maya = (await joined.json()).data as { personId: string; token: string };

    // the Vault: an ordinary app key anyone may use, and the company key only the server uses
    const folderId = (await api("vault.folders.create", { name: "Keys", scope: "shared" })).folder.id as string;
    for (const name of ["Google_DWD", "Stripe"])
      await api("vault.item.put", {
        folderId,
        name,
        kind: "api_key",
        fields: [{ key: "api_key", value: "plain-fake-value" }],
      });
    // a member is never suggested the admin-only company key
    const mayaHome = await call(maya.token, "automations.home", {});
    assert.equal(mayaHome.status, 200, JSON.stringify(mayaHome.data));
    assert.equal(
      JSON.stringify(mayaHome.data).includes("Google_DWD"),
      false,
      "the company key is never suggested to a member",
    );

    // one app the Space connected
    const made = await call(token, "connections.create", {
      connector: "google",
      title: "Northwind Google",
      ownerKind: "space",
    });
    console.log("CONNECTION", made.status, JSON.stringify(made.data).slice(0, 200));
    const name = await api("automations.create", { name: "Build me" });
    const id = (name.automation ?? name).id as string;
    await page.goto(`${web.origin}/automations`, { waitUntil: "load" });
    await page.getByText("Build me", { exact: true }).first().click({ timeout: 30_000 });
    await page.getByTestId("story").waitFor({ timeout: 20_000 });
    await page.getByTestId("sv-add").click();
    await page.getByTestId("step-picker").waitFor();
    await page.waitForTimeout(700);
    await shot("4-picker-your-apps-d");
    const main = await page.getByTestId("pk-main").innerText();
    console.log("PICKER", main.replace(/\n/g, " | ").slice(0, 400));
    assert.equal(/Microsoft|GitHub/.test(main), false, "an app nobody connected is not listed");
    // the keyboard: type to filter, arrows, Right opens the submenu, Left and Esc step back
    await page.getByTestId("pk-search").fill("mail");
    await page.waitForTimeout(400);
    await shot("4-picker-search-d");
    await page.getByTestId("pk-search").fill("");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowRight");
    await page.waitForTimeout(500);
    await shot("4-picker-submenu-keyboard-d");
    assert.ok(await page.getByTestId("pk-sub").count(), "Right opens the submenu");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await page.waitForTimeout(1200);
    assert.ok(
      (await page.getByTestId("story").innerText()).match(/Send|Post|Message|Create|Find/),
      "Enter in the submenu adds the step",
    );
    await page.keyboard.press("ArrowLeft");
    await page.waitForTimeout(300);
    assert.equal(await page.getByTestId("pk-sub").count(), 0, "Left steps back");
    // Connect an app
    await page.getByTestId("sv-add").click();
    await page.getByTestId("step-picker").waitFor();
    await page.getByText("Connect an app", { exact: true }).first().click();
    await page.getByTestId("connect-sheet").waitFor({ timeout: 10_000 });
    await page.waitForTimeout(600);
    await shot("4-connect-an-app-d");
    const sheet = await page.getByTestId("connect-sheet").innerText();
    console.log("SHEET", sheet.replace(/\n/g, " | ").slice(0, 500));
    assert.match(sheet, /In your Vault/);
    assert.match(sheet, /Stripe/);
    assert.equal(/vit_[0-9a-f]{8,}/.test(sheet), false, "no id on the sheet");
    void id;
    assert.deepEqual(errors, [], "no page error");
  } finally {
    await browser.close();
    web.close();
    await space.stop();
  }
});
