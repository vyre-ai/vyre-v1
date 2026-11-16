// r32 connect: with no app connected the step picker offers only Connect an app, and Add an app starts the real connect flow for a known app (rc.32 lane r32-auto). Pictures go to SHOTS=<dir>.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { bootFreshSpace, claimOnEdge, dismissOnboarding, edge } from "./real-app-harness.test.ts";

const PASSWORD = "fixture password 123";
const SHOTS = process.env["SHOTS"];

test("r32 connect: with no app connected the step picker offers only Connect an app, and Add an app starts the real connect flow for a known app", async (t) => {
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
  const logs: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") logs.push(m.text().slice(0, 300));
  });
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
    const api = async (cap: string, data: Record<string, unknown>): Promise<any> => {
      const r = await context.request.post(`${web.origin}/v1/${cap.replace(/\./g, "/")}`, {
        headers: { authorization: `Bearer ${token}` },
        data: { idempotencyKey: `${cap}-${Math.random()}`, ...data },
      });
      assert.equal(r.status(), 200, `${cap}: ${await r.text()}`);
      return r.json();
    };
    const idOf = (o: any): string => (o.automation ?? o.data?.automation ?? o.data ?? o).id;
    const who = JSON.stringify(await api("identity.whoami", {})).match(/usr_[a-z0-9]+/)?.[0]!;
    const make = async (name: string, nodes: unknown[], triggers: unknown[] = [{ key: "manual" }]): Promise<string> =>
      idOf(
        await api("automations.create", {
          name,
          definition: { triggers, nodes, start: [(nodes[0] as { id: string }).id] },
        }),
      );

    await make("Empty", [{ id: "n1", key: "post_message", input: { text: "hi" } }]);
    await page.goto(`${web.origin}/automations`, { waitUntil: "load" });
    await page.getByTestId("first-page").waitFor({ timeout: 30_000 });
    await page.getByTestId("auto-list").getByText("Empty", { exact: true }).first().click();
    await page.getByTestId("story").waitFor({ timeout: 20_000 });
    await page.getByTestId("sv-add").click();
    await page.getByTestId("step-picker").waitFor({ timeout: 10_000 });
    const picker = await page.getByTestId("step-picker").innerText();
    assert.equal(/Your apps/.test(picker), false, "no app is connected, so no app is listed");
    assert.match(picker, /Connect an app/);
    await shot("5-picker-none-connected-d");
    await page.getByText("Connect an app", { exact: true }).first().click();
    await page.getByTestId("connect-sheet").waitFor({ timeout: 10_000 });
    await page.getByTestId("cs-add-search").fill("Goo");
    await page.getByTestId("row-cs-add-google").waitFor({ timeout: 10_000 });
    await shot("5-add-an-app-d");
    assert.equal(
      /\bvit_[0-9a-f]{8,}/.test(await page.getByTestId("connect-sheet").innerText()),
      false,
      "no id on the sheet",
    );
    await page.getByTestId("row-cs-add-google").click();
    await page.getByTestId("connect-connector").waitFor({ timeout: 15_000 });
    await shot("5-connect-google-d");
    assert.match(await page.getByTestId("connect-connector").innerText(), /Connect Google/);
    assert.deepEqual(errors, [], "no page error");
  } finally {
    await browser.close();
    web.close();
    await space.stop();
  }
});
