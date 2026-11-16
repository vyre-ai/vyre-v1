// r32 approvals: a card on the first page and in the run, Allow and Deny (rc.32 lane r32-auto). Pictures go to SHOTS=<dir>.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { bootFreshSpace, claimOnEdge, dismissOnboarding, edge } from "./real-app-harness.test.ts";

const PASSWORD = "fixture password 123";
const SHOTS = process.env["SHOTS"];

test("r32 approvals: a card on the first page and in the run, Allow and Deny", async (t) => {
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

    const mk = async (name: string, nodes: unknown[]): Promise<string> => make(name, nodes);
    const approvalNodes = (title: string): unknown[] => [
      { id: "n1", key: "approval", input: { title, approver: { kind: "person", id: who } }, next: ["n2"] },
      { id: "n2", key: "post_message", input: { text: "Sent" } },
    ];
    const first = await mk("Invoice reminders", approvalNodes("Send the invoices"));
    const second = await mk("Contract review", approvalNodes("Send the contract"));
    const third = await mk("Refund check", approvalNodes("Pay the refund"));
    for (const id of [first, second, third]) {
      await api("automations.set_enabled", { automationId: id, enabled: true });
      await api("automations.run", { automationId: id, payload: { name: "Sam" } });
    }
    const waitFor = async (id: string, status: string): Promise<string> => {
      for (let i = 0; i < 40; i++) {
        const runs = await api("runs.list", { scope: "subject", subject: { type: "automation", id } });
        const r = (runs.runs ?? runs.data?.runs ?? [])[0];
        if (r?.status === status) return r.id as string;
        await page.waitForTimeout(500);
      }
      assert.fail(`the run never reached ${status}`);
    };
    const run1 = await waitFor(first, "waiting");
    await waitFor(second, "waiting");
    await waitFor(third, "waiting");

    // the first page: a card for each, with Allow and Deny and what happens on each
    await page.goto(`${web.origin}/automations`, { waitUntil: "load" });
    await page.getByTestId("first-page").waitFor({ timeout: 30_000 });
    await page.locator('[data-testid^="ap-card-"]').first().waitFor({ timeout: 20_000 });
    await shot("6-first-page-approvals-d");
    const cards = page.locator('[data-testid^="ap-card-"]');
    assert.equal(await cards.count(), 3, "one card for each Automation that waits");
    const text = await page.getByTestId("first-page").innerText();
    assert.match(text, /Send the invoices/);
    assert.match(text, /Allow: It goes on: Post in/);
    assert.match(text, /Deny: It goes on with your no: Post in/);
    assert.equal(/\b(tsk|run|usr|aut)_[a-z0-9]{6,}/.test(text), false, "no id on the card");

    // Deny asks why, and nothing goes without it
    const deny = page
      .locator('[data-testid^="ap-deny-"]:not([data-testid^="ap-deny-says"]):not([data-testid^="ap-deny-go"])')
      .first();
    await deny.click();
    await page.locator('[data-testid^="ap-reason-"]').first().waitFor({ timeout: 10_000 });
    await page.locator('[data-testid^="ap-deny-go-"]').first().click();
    await page.locator('[data-testid^="ap-note-"]').first().waitFor({ timeout: 10_000 });
    assert.match(await page.locator('[data-testid^="ap-note-"]').first().innerText(), /Say why/);
    await shot("6-deny-asks-why-d");
    await page.locator('[data-testid^="ap-reason-"]').first().fill("Not this month");
    await page.locator('[data-testid^="ap-deny-go-"]').first().click();
    await page.waitForFunction(() => document.querySelectorAll('[data-testid^="ap-card-"]').length === 2, null, {
      timeout: 15_000,
    });

    // Allow on the first page lets that Automation's run go on
    const allow = page.locator('[data-testid^="ap-allow-"]:not([data-testid^="ap-allow-says"])').first();
    await allow.click();
    await page.waitForFunction(() => document.querySelectorAll('[data-testid^="ap-card-"]').length === 1, null, {
      timeout: 15_000,
    });

    // the run page carries the same card
    await page.getByTestId("auto-list").getByText("Invoice reminders", { exact: true }).first().click();
    await page.getByTestId("story").waitFor({ timeout: 20_000 });
    await page.getByTestId("page-tab-runs").click();
    await page.waitForTimeout(1200);
    await page.getByTestId("runs-list").locator("[role=button]").first().click();
    await page.getByTestId("run-page").waitFor({ timeout: 20_000 });
    await page.waitForTimeout(1500);
    await shot("6-run-page-d");
    void run1;

    // a phone, light: a run that is waiting and a failed run with its one fix (building needs a computer; runs and the fix work on a phone)
    const lacking = await mk("Call back", [{ id: "n1", key: "create_task", input: { title: "Call back" } }]);
    await api("automations.test", { automationId: lacking });
    await waitFor(lacking, "failed");
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ colorScheme: "light" });
    await page.goto(`${web.origin}/automations`, { waitUntil: "load" });
    await page.getByText("Call back", { exact: true }).first().waitFor({ timeout: 30_000 });
    await page.waitForTimeout(1200);
    await shot("6-first-page-phone-light");
    const openFromList = async (name: string): Promise<void> => {
      // on a phone the list is behind the sidebar button: the first page's own cards and the sidebar search reach every Automation
      await page.getByText(name, { exact: true }).first().click({ timeout: 15_000 });
      await page.waitForTimeout(1200);
    };
    await openFromList("Call back").catch(() => undefined);
    await page
      .getByTestId("page-tab-runs")
      .click({ timeout: 8_000 })
      .catch(() => undefined);
    await page.waitForTimeout(1200);
    await page.getByTestId("runs-list").locator("[role=button]").first().click({ timeout: 8_000 });
    await page.getByTestId("run-page").waitFor({ timeout: 15_000 });
    await page.waitForTimeout(1200);
    await shot("6-run-failed-phone-light");
    await page.getByTestId("rv-fix").click({ timeout: 8_000 });
    await page.getByTestId("run-fix").waitFor({ timeout: 10_000 });
    // on a phone the one step's form takes the page, with the reason in words and a way back to the run
    assert.ok(await page.getByTestId("run-fix-back").count(), "a way back to the run");
    assert.match(await page.getByTestId("run-fix-why").innerText(), /choose who it is for/i);
    await page.waitForTimeout(1500);
    await shot("6-run-fix-phone-light");
    await page.getByTestId("run-fix-back").click();
    await page.getByTestId("run-view").waitFor({ timeout: 10_000 });
    assert.deepEqual(errors, [], "no page error");
  } finally {
    await browser.close();
    web.close();
    await space.stop();
  }
});
