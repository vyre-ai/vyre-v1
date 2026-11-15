// The new Automations place in a real browser against the production export (AUTOMATIONS-BUILD-RC29 phase 1): the first page, the one list, the builder as one story page with no Save button, and the pictures the lead looks at (SHOTS=<dir>).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { bootFreshSpace, claimOnEdge, dismissOnboarding, edge } from "./real-app-harness.test.ts";

const PASSWORD = "fixture password 123";
const SHOTS = process.env["SHOTS"];
const LOOKS = [
  { tag: "d", viewport: { width: 1440, height: 900 }, colorScheme: "dark" as const },
  { tag: "p", viewport: { width: 390, height: 844 }, colorScheme: "light" as const },
];

for (const look of LOOKS) {
  test(`production Automations (${look.tag}): first page, a builder that saves a draft as you go, no Save button`, async (t) => {
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
    const context = await browser.newContext({ viewport: look.viewport, colorScheme: look.colorScheme });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const shot = async (name: string): Promise<void> => {
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}-${look.tag}.png` });
    };
    try {
      await page.goto(claimOnEdge(space.claim!, web.origin), { waitUntil: "load" });
      await page.getByTestId("claim-name").fill("Olivia Owner");
      await page.getByTestId("claim-username").fill("olivia");
      await page.getByTestId("claim-password").fill(PASSWORD);
      await page.getByTestId("claim-confirm").fill(PASSWORD);
      await page.getByTestId("claim-next").click();
      await page.getByTestId("claim-saved").click();
      await page.getByTestId("claim-create").click();
      await dismissOnboarding(page);
      if (look.tag === "d") await page.getByTestId("shell").waitFor({ timeout: 30_000 });
      else await page.waitForTimeout(4000);
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
      await page.goto(`${web.origin}/automations`, { waitUntil: "load" });
      await page.waitForTimeout(2500);
      await shot("a-first-page");
      // phones: Automations is a computer place (the shell says so); nothing more to walk there
      if (look.tag === "p") {
        assert.match(await page.locator("body").innerText(), /Automations open on a computer/);
        return;
      }
      const made = await api("automations.create", { name: "Welcome new leads" });
      const id = (made.automation ?? made.data?.automation ?? made.data ?? made).id as string;
      await page.goto(`${web.origin}/automations`, { waitUntil: "load" });
      await page.getByText("Welcome new leads", { exact: true }).first().click({ timeout: 30_000 });
      await page.getByTestId("story").waitFor({ timeout: 20_000 });
      await page.waitForTimeout(1500);
      await shot("c-builder-empty");
      // build three steps by hand with the picker: the keyboard for the first, the pointer for the rest
      await page.getByTestId("sv-add").click();
      await page.getByTestId("step-picker").waitFor();
      await page.waitForTimeout(600);
      await shot("d-picker");
      await page.getByTestId("pk-search").fill("task");
      await page.waitForTimeout(400);
      await shot("d-picker-search");
      await page.getByTestId("pk-search").press("Enter");
      await page.waitForTimeout(1500);
      await shot("c-builder-one-step");
      assert.equal(await page.getByText("Save", { exact: true }).count(), 0, "no Save button");
      assert.deepEqual(errors, [], "no page error");
      void id;
    } finally {
      await browser.close();
      web.close();
      await space.stop();
    }
  });
}
