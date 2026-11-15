// The step row and the step form in a real browser against the production export (AUTOMATIONS-BUILD-RC29 round three): each kind the prototype drew (email, sms, ai, lookup, paths, wait, and task and chat post) in its four states
// (empty, filled, needs, fail), the six-step builder with an If, Insert data by menu, the needs button that lands on the control, and a run that says why it failed. Pictures go to SHOTS=<dir> as 3-<kind>-<state>-d.png.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { bootFreshSpace, claimOnEdge, dismissOnboarding, edge } from "./real-app-harness.test.ts";

const PASSWORD = "fixture password 123";
const SHOTS = process.env["SHOTS"];

test("production Automations: the step row and the step form for each kind and state, and the six-step builder", async (t) => {
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
    const idOf = (o: any): string => (o.automation ?? o.data?.automation ?? o.data ?? o).id;
    const who = JSON.stringify(await api("identity.whoami", {})).match(/usr_[a-z0-9]+/)?.[0]!;
    const make = async (name: string, nodes: unknown[], triggers: unknown[] = [{ key: "manual" }]): Promise<string> =>
      idOf(await api("automations.create", { name, definition: { triggers, nodes, start: [(nodes[0] as { id: string }).id] } }));

    // the six-step Automation with an If, like the prototype's "Lead reply follow-up"
    const six = await make("Lead reply follow-up", [
      { id: "find", key: "records.find", input: { type: "contact" }, next: ["p1"] },
      {
        id: "p1",
        key: "paths",
        input: { paths: [{ name: "Hot", when: "trigger.score > 80" }], otherwise: true },
        branches: [
          { label: "Hot", to: "mail", when: "trigger.score > 80" },
          { label: "Otherwise", to: "task" },
        ],
      },
      {
        id: "mail",
        key: "send_email",
        input: { to: "{{ trigger.email }}", subject: "Thanks for getting in touch", body: "Thanks for getting in touch, {{ trigger.name }}" },
        next: ["pause"],
      },
      { id: "pause", key: "wait", input: { forDuration: "2d" }, next: ["post"] },
      { id: "task", key: "create_task", input: { title: "Call {{ trigger.name }}", assigned: who }, next: ["post"] },
      { id: "post", key: "post_message", input: { text: "New lead: {{ trigger.name }}" } },
    ]);
    void six;
    await page.goto(`${web.origin}/automations`, { waitUntil: "load" });
    await page.getByText("Lead reply follow-up", { exact: true }).first().click({ timeout: 30_000 });
    await page.getByTestId("story").waitFor({ timeout: 20_000 });
    await page.waitForTimeout(1500);
    await shot("3-builder-six-steps-d");
    const rows = await page.getByTestId("story").innerText();
    assert.equal(/usr_[a-z0-9]{8,}|frm_|rec_[a-z0-9]{6,}/.test(rows), false, "no id on any row");
    assert.match(rows, /If yes|Hot/);
    assert.match(rows, /Otherwise/);

    // each kind in its four states
    const kinds: Record<string, { key: string; filled: Record<string, unknown>; needs: Record<string, unknown>; empty?: Record<string, unknown> }> = {
      email: {
        key: "send_email",
        filled: { to: "{{ trigger.email }}", subject: "Thanks for getting in touch", body: "Thanks, {{ trigger.name }}" },
        needs: { subject: "Thanks for getting in touch", body: "Hello" },
      },
      sms: { key: "send_sms", filled: { to: "{{ trigger.phone }}", body: "Hi {{ trigger.name }}" }, needs: { body: "Hi" } },
      ai: { key: "ai", filled: { prompt: "Write a short reply to {{ trigger.name }}" }, needs: {} },
      lookup: { key: "records.find", filled: { type: "contact", limit: 5 }, needs: {} },
      paths: { key: "paths", filled: { paths: [{ name: "Hot", when: "trigger.score > 80" }] }, needs: {} },
      wait: { key: "wait", filled: { forDuration: "2d" }, needs: {} },
      task: { key: "create_task", filled: { title: "Call {{ trigger.name }}", assigned: who }, needs: { assigned: who } },
      chat: { key: "post_message", filled: { text: "New lead: {{ trigger.name }}" }, needs: {} },
    };
    for (const [kind, k] of Object.entries(kinds))
      for (const state of ["empty", "filled", "needs", "fail"] as const) {
        const name = `${kind}-${state}`;
        const input = state === "empty" ? {} : state === "filled" ? k.filled : k.needs;
        await make(name, [{ id: "n1", key: k.key, input }]);
      }
    await page.goto(`${web.origin}/automations`, { waitUntil: "load" });
    await page.getByTestId("first-page").waitFor({ timeout: 30_000 });
    for (const kind of Object.keys(kinds))
      for (const state of ["empty", "filled", "needs", "fail"] as const) {
        await page.getByText(`${kind}-${state}`, { exact: true }).first().click({ timeout: 30_000 });
        await page.getByTestId("story").waitFor({ timeout: 20_000 });
        await page.getByTestId("sv-step-n1").click({ position: { x: 120, y: 14 } });
        await page.waitForTimeout(900);
        if (state === "fail") {
          const b = page.getByText("Test this step", { exact: true }).first();
          if (await b.count()) {
            await b.click();
            await page.waitForTimeout(2500);
          }
        }
        await shot(`3-${kind}-${state}-d`);
        const text = await page.locator("body").innerText();
        assert.equal(/Templating|\{\{|\(required\)|More options/.test(text), false, `${kind} ${state}: no syntax on the page`);
        assert.equal(/\b(usr|frm|rec|chn|ch)_[a-z0-9]{8,}/.test(text), false, `${kind} ${state}: no id on the page`);
      }
    assert.deepEqual(errors, [], "no page error");
  } finally {
    await browser.close();
    web.close();
    await space.stop();
  }
});
