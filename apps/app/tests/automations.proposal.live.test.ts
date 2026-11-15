// The Assistant's draft on the page, in a real browser (AUTOMATIONS-BUILD-RC29 round four, item 6): a proposal of three steps shows the bar (Discard, Change, Accept) and three rows drawn as proposed; Accept makes them the Automation's;
// Discard on a second one removes the empty Automation and the page leaves it. The proposal is put through the same server call an Assistant's tool uses (automations.draft.propose); the agent-through-the-engine path is walked in test/automations-propose.live.test.ts.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { bootFreshSpace, claimOnEdge, dismissOnboarding, edge } from "./real-app-harness.test.ts";

const PASSWORD = "fixture password 123";
const SHOTS = process.env["SHOTS"];

test("production Automations: a proposed draft shows its bar, Accept keeps it, Discard removes the empty Automation", async (t) => {
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
    const task = (id: string, title: string, next?: string): Record<string, unknown> => ({
      id,
      key: "create_task",
      input: { title, assigned: { kind: "person", id: who } },
      ...(next ? { next: [next] } : {}),
    });
    const idOf = (o: any): string => (o.automation ?? o.data?.automation ?? o.data ?? o).id;

    const first = idOf(
      await api("automations.draft.propose", {
        name: "New lead follow-up",
        summary: "When you run it: call the lead, send the quote, thank them a week later.",
        definition: { triggers: [{ key: "manual" }], nodes: [task("call", "Call the new lead", "quote"), task("quote", "Send the quote", "thank"), task("thank", "Thank them a week later")], start: ["call"] },
      }),
    );
    await page.goto(`${web.origin}/automations`, { waitUntil: "load" });
    await page.getByText("New lead follow-up", { exact: true }).first().click({ timeout: 30_000 });
    await page.getByTestId("story").waitFor({ timeout: 20_000 });
    await page.waitForTimeout(1500);
    await shot("6-proposal-d");
    for (const b of ["Discard", "Change", "Accept"]) assert.ok(await page.getByTestId(`sv-bar-${b}`).count(), `the bar has ${b}`);
    assert.match(await page.getByTestId("story").innerText(), /Call the new lead|Create a task/);
    const before = await api("automations.get", { automationId: first });
    assert.equal((before.automation ?? before.data.automation).definition.nodes.length, 0, "nothing proposed is saved yet");
    await page.getByTestId("sv-bar-Accept").click();
    await page.waitForTimeout(2000);
    await shot("6-accepted-d");
    assert.equal(await page.getByTestId("sv-bar-Accept").count(), 0, "the bar is gone");
    const after = await api("automations.get", { automationId: first });
    assert.equal((after.automation ?? after.data.automation).definition.nodes.length, 3, "the three steps are the Automation's");
    assert.equal((after.automation ?? after.data.automation).status, "draft", "nothing was turned on");

    // a second proposal: Discard removes the empty Automation and the page leaves it
    await api("automations.draft.propose", {
      name: "Second idea",
      summary: "Post a note.",
      definition: { triggers: [{ key: "manual" }], nodes: [task("n1", "Post a note")], start: ["n1"] },
    });
    await page.goto(`${web.origin}/automations`, { waitUntil: "load" });
    await page.getByText("Second idea", { exact: true }).first().click({ timeout: 30_000 });
    await page.getByTestId("sv-bar-Discard").waitFor({ timeout: 20_000 });
    await page.getByTestId("sv-bar-Discard").click();
    await page.waitForTimeout(2500);
    await shot("6-discarded-d");
    await page.getByTestId("first-page").waitFor({ timeout: 10_000 });
    assert.equal(await page.getByTestId("auto-list").getByText("Second idea", { exact: true }).count(), 0, "the empty Automation is gone from the list");
    assert.equal(await page.getByTestId("story").count(), 0, "the page left it");
    assert.deepEqual(errors, [], "no page error");
  } finally {
    await browser.close();
    web.close();
    await space.stop();
  }
});
