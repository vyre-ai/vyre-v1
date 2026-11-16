// r32 wait: a Wait picks its event from the Space's events by typing and narrows it with that event's own fields (rc.32 lane r32-auto). Pictures go to SHOTS=<dir>.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { bootFreshSpace, claimOnEdge, dismissOnboarding, edge } from "./real-app-harness.test.ts";

const PASSWORD = "fixture password 123";
const SHOTS = process.env["SHOTS"];

test("r32 wait: a Wait picks its event from the Space's events by typing and narrows it with that event's own fields", async (t) => {
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

    const waitId = await make("Wait for a task", [
      { id: "n1", key: "wait", input: { event: { event: "task.completed" } }, next: ["n2"] },
      { id: "n2", key: "post_message", input: { text: "Done" } },
    ]);
    void waitId;
    await page.goto(`${web.origin}/automations`, { waitUntil: "load" });
    await page.getByTestId("first-page").waitFor({ timeout: 30_000 });

    // the Wait: its event from the Space's own catalogue, searched by typing; its row says what it waits for
    await page.getByTestId("auto-list").getByText("Wait for a task", { exact: true }).first().click();
    await page.getByTestId("story").waitFor({ timeout: 20_000 });
    await page.getByTestId("sv-step-n1").click({ position: { x: 120, y: 14 } });
    await page.getByTestId("field-event-event").waitFor({ timeout: 20_000 });
    assert.match(await page.getByTestId("story").innerText(), /Wait for task completed/);
    await shot("2-wait-event-d");
    await page.getByTestId("field-event-event").click();
    const search = page.getByRole("menu").last().locator("input");
    await search.waitFor({ timeout: 10_000 });
    // the catalogue is read when the menu opens: wait for it to arrive, then count (on a busy runner the count was read while the first rows were still alone)
    await page
      .waitForFunction(`document.querySelectorAll('[role="menuitem"]').length > 20`, undefined, { timeout: 15_000 })
      .catch(() => undefined);
    const before = await page.getByRole("menuitem").count();
    assert.ok(before > 20, `the whole catalogue is offered (${before})`);
    await search.fill("reached Done");
    await page.waitForFunction((n) => document.querySelectorAll('[role="menuitem"]').length < n, before, {
      timeout: 10_000,
    });
    const hits = await page.getByRole("menuitem").allInnerTexts();
    assert.ok(hits.length >= 1 && hits.length < before, `typing narrows the events (${hits.length} of ${before})`);
    await shot("2-wait-event-search-d");
    await page.getByRole("menuitem").first().click();
    await page.getByTestId("field-event-event").filter({ hasText: "A task reached Done" }).waitFor({ timeout: 15_000 });
    // "only when": the field is one of the fields that event carries, chosen from a list
    await page
      .getByTestId("field-event-when-add")
      .click()
      .catch(() => undefined);
    await page.getByTestId("field-event-when-field-0").click();
    const fieldItems = await page.getByRole("menuitem").allInnerTexts();
    assert.ok(fieldItems.length >= 1, "the event's own fields are offered");
    assert.equal(/\{\{|_id\b/.test(fieldItems.join(" ")), false, "in words");
    await shot("2-wait-fields-d");
    await page.keyboard.press("Escape");

    assert.deepEqual(errors, [], "no page error");
  } finally {
    await browser.close();
    web.close();
    await space.stop();
  }
});
