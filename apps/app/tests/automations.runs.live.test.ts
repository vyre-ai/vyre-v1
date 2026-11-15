// A failed run opened as a page and fixed in place, and two sessions editing one Automation, in a real browser (AUTOMATIONS-BUILD-RC29 round four, item 7). The second editor is the same account in a second browser context: the refusal rests on the
// version each write carries, not on who writes. Pictures go to SHOTS=<dir> as 7-<name>-d.png.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { bootFreshSpace, claimOnEdge, dismissOnboarding, edge } from "./real-app-harness.test.ts";

const PASSWORD = "fixture password 123";
const SHOTS = process.env["SHOTS"];

test("production Automations: a failed run is fixed in place, and a second session's change is told, never lost", async (t) => {
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
    const au = (o: any): any => o.automation ?? o.data?.automation;

    // a run that fails: a request to an address nothing answers at
    const bad = idOf(
      await api("automations.create", {
        name: "Ping the intake",
        definition: { triggers: [{ key: "manual" }], nodes: [{ id: "n1", key: "http_request", input: { method: "GET", url: "https://127.0.0.1:1/ping" } }], start: ["n1"] },
      }),
    );
    await api("automations.set_enabled", { automationId: bad, enabled: true });
    await api("automations.run", { automationId: bad, payload: {} });
    await page.waitForTimeout(4000);
    await page.goto(`${web.origin}/automations`, { waitUntil: "load" });
    await page.getByTestId("first-page").waitFor({ timeout: 30_000 });
    await page.waitForTimeout(1500);
    await shot("7-needs-you-failed-d");
    assert.match(await page.getByTestId("first-page").innerText(), /Ping the intake/, "the failure is a card on the first page");
    await page.getByText("Ping the intake", { exact: true }).first().click();
    await page.getByTestId("story").waitFor({ timeout: 20_000 });
    await page.getByTestId("page-tab-runs").click();
    await page.waitForTimeout(1200);
    await page.getByTestId("runs-list").locator("[role=button]").first().click();
    await page.getByTestId("run-page").waitFor({ timeout: 20_000 });
    await page.waitForTimeout(1200);
    await shot("7-run-failed-d");
    assert.ok(await page.getByTestId("rv-fix").count(), "a failure has its one button");
    await page.getByTestId("rv-fix").click();
    await page.getByTestId("run-fix").waitFor({ timeout: 10_000 });
    await page.waitForTimeout(1200);
    await shot("7-run-fix-in-place-d");
    assert.ok(await page.getByTestId("run-fix").getByTestId("inspector").count(), "the step's form is open in place on the run's page");
    await page.getByTestId("run-again").click();
    await page.waitForTimeout(3500);
    const runs = await api("runs.list", { scope: "subject", subject: { type: "automation", id: bad } });
    assert.ok(((runs.runs ?? runs.data?.runs) as unknown[]).length >= 2, "it ran again");

    // two sessions: the second's save lands first, the first is told in one sentence and nothing of theirs is overwritten
    const two = idOf(
      await api("automations.create", {
        name: "Shared plan",
        definition: { triggers: [{ key: "manual" }], nodes: [{ id: "a", key: "create_task", input: { title: "First", assigned: { kind: "person", id: who } } }], start: ["a"] },
      }),
    );
    await page.goto(`${web.origin}/automations`, { waitUntil: "load" });
    await page.getByText("Shared plan", { exact: true }).first().click();
    await page.getByTestId("story").waitFor({ timeout: 20_000 });
    await page.waitForTimeout(1500);
    const g = await api("automations.get", { automationId: two });
    const theirs = { ...au(g).definition, nodes: [...au(g).definition.nodes, { id: "b", key: "create_task", input: { title: "Theirs", assigned: { kind: "person", id: who } } }] };
    const other = await browser.newContext();
    const r2 = await other.request.post(`${web.origin}/v1/automations/draft/save`, {
      headers: { authorization: `Bearer ${token}` },
      data: { idempotencyKey: `b-${Math.random()}`, automationId: two, definition: theirs, expectedVersion: au(g).version },
    });
    assert.equal(r2.status(), 200, await r2.text());
    await other.close();
    await page.getByTestId("sv-add").click();
    await page.getByTestId("pk-search").fill("task");
    await page.getByTestId("pk-search").press("Enter");
    await page.getByTestId("save-conflict").waitFor({ timeout: 10_000 });
    await shot("7-two-sessions-d");
    assert.match(await page.getByTestId("save-conflict").innerText(), /Someone else changed this/);
    const kept = await api("automations.get", { automationId: two });
    assert.equal(au(kept).definition.nodes.length, 2, "their change is there and mine did not overwrite it");
    assert.deepEqual(errors, [], "no page error");
  } finally {
    await browser.close();
    web.close();
    await space.stop();
  }
});
