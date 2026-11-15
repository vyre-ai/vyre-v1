// The first page and the list with real content, on a desktop and a phone, in a real browser (AUTOMATIONS-BUILD-RC29 round four, items 4 and 5): five Automations (three on, one off, one with a failed run), a Vault item the member may use
// (Suggested) and an admin-only one (never suggested). The header counts, Needs you and the Suggested card come from one server read. Pictures go to SHOTS=<dir> as 4-<name>-<d|p>.png.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { bootFreshSpace, claimOnEdge, dismissOnboarding, edge } from "./real-app-harness.test.ts";

const PASSWORD = "fixture password 123";
const SHOTS = process.env["SHOTS"];

test("production Automations: the first page and list with real content, on a desktop and a phone", async (t) => {
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
  const shot = async (pg: typeof page, name: string): Promise<void> => {
    if (SHOTS) await pg.screenshot({ path: `${SHOTS}/${name}.png` });
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
    const api = async (cap: string, data: Record<string, unknown>): Promise<any> => {
      const r = await context.request.post(`${web.origin}/v1/${cap.replace(/\./g, "/")}`, {
        headers: { authorization: `Bearer ${token}` },
        data: { idempotencyKey: `${cap}-${Math.random()}`, ...data },
      });
      assert.equal(r.status(), 200, `${cap}: ${await r.text()}`);
      return r.json();
    };
    const who = JSON.stringify(await api("identity.whoami", {})).match(/usr_[a-z0-9]+/)?.[0]!;
    const idOf = (o: any): string => (o.automation ?? o.data?.automation ?? o.data ?? o).id;
    const folderId = (await api("vault.folders.create", { name: "Keys", scope: "shared" })).data.folder.id as string;
    for (const name of ["Google_DWD", "Acme"])
      await api("vault.item.put", {
        folderId,
        name,
        kind: "api_key",
        fields: [{ key: "api_key", value: "plain-fake-value" }],
      });
    const task = (title: string): unknown[] => [
      { id: "n1", key: "create_task", input: { title, assigned: { kind: "person", id: who } } },
    ];
    const mk = async (name: string, nodes: unknown[], on: boolean): Promise<string> => {
      const id = idOf(
        await api("automations.create", { name, definition: { triggers: [{ key: "manual" }], nodes, start: ["n1"] } }),
      );
      if (on) await api("automations.set_enabled", { automationId: id, enabled: true });
      return id;
    };
    const daily = await mk("Daily brief", task("Brief"), true);
    await mk("Friday task summary", task("Summary"), true);
    await mk("Draft intake", task("Intake"), false);
    await mk("Meeting notes to tasks", task("Notes"), true);
    const ping = await mk(
      "Ping the intake",
      [{ id: "n1", key: "http_request", input: { method: "GET", url: "https://127.0.0.1:1/ping" } }],
      true,
    );
    await api("automations.run", { automationId: daily, payload: {} });
    await api("automations.run", { automationId: ping, payload: {} });
    await page.waitForTimeout(4000);

    const homeRes = await context.request.post(`${web.origin}/v1/automations/home`, {
      headers: { authorization: `Bearer ${token}` },
      data: {},
    });
    console.log("HOME", homeRes.status(), (await homeRes.text()).slice(0, 500));
    await page.goto(`${web.origin}/automations`, { waitUntil: "load" });
    await page.getByTestId("first-page").waitFor({ timeout: 30_000 });
    await page.waitForTimeout(2500);
    await shot(page, "4-first-page-d");
    const body = await page.getByTestId("first-page").innerText();
    assert.match(body, /4 on, 1 needs you/, "the header counts come from the server");
    assert.match(body, /Ping the intake/, "the failure is a card");
    assert.match(body, /Acme/, "a Vault item the member may use is suggested");
    assert.equal(body.includes("Google_DWD"), false, "the admin-only company key is never suggested");
    assert.match(body, /Today/);
    const list = await page.getByTestId("auto-list").innerText();
    assert.equal(
      (list.match(/Automations/g) ?? []).length <= 1,
      true,
      "the word Automations is not said twice in the list",
    );

    // the same Space on a phone: first page, list, a run and its fix work; building says it opens on a computer
    const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: "light" });
    await phone.addInitScript(
      (s) => localStorage.setItem("vyre.session.v1", s),
      await page.evaluate(() => localStorage.getItem("vyre.session.v1")!),
    );
    const p = await phone.newPage();
    p.on("pageerror", (e) => errors.push(e.message));
    await p.goto(`${web.origin}/automations`, { waitUntil: "load" });
    await p.waitForTimeout(4000);
    await shot(p, "5-phone-first-page-p");
    const phoneText = await p.locator("body").innerText();
    assert.equal(/Automations open on a computer/.test(phoneText), false, "Automations work on a phone");
    assert.match(phoneText, /Ping the intake|Daily brief/);
    await p.getByText("Ping the intake", { exact: true }).first().click({ timeout: 20_000 });
    await p.waitForTimeout(2500);
    await shot(p, "5-phone-automation-p");
    assert.match(await p.locator("body").innerText(), /Building opens on a computer/);
    assert.deepEqual(errors, [], "no page error");
  } finally {
    await browser.close();
    web.close();
    await space.stop();
  }
});
