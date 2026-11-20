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
        input: {
          to: "{{ trigger.input.email }}",
          subject: "Thanks for getting in touch",
          body: "Thanks for getting in touch, {{ trigger.input.name }}",
        },
        next: ["pause"],
      },
      { id: "pause", key: "wait", input: { forDuration: "2d" }, next: ["post"] },
      {
        id: "task",
        key: "create_task",
        input: { title: "Call {{ trigger.input.name }}", assigned: { kind: "person", id: who } },
        next: ["post"],
      },
      { id: "post", key: "post_message", input: { text: "New lead: {{ trigger.input.name }}" } },
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
    const kinds: Record<
      string,
      { key: string; filled: Record<string, unknown>; needs: Record<string, unknown>; empty?: Record<string, unknown> }
    > = {
      email: {
        key: "send_email",
        filled: {
          to: "{{ trigger.input.email }}",
          subject: "Thanks for getting in touch",
          body: "Thanks, {{ trigger.input.name }}",
        },
        needs: { subject: "Thanks for getting in touch", body: "Hello" },
      },
      sms: {
        key: "send_sms",
        filled: { to: "{{ trigger.input.phone }}", body: "Hi {{ trigger.input.name }}" },
        needs: { body: "Hi" },
      },
      ai: { key: "ai", filled: { prompt: "Write a short reply to {{ trigger.input.name }}" }, needs: {} },
      lookup: { key: "records.find", filled: { type: "contact", limit: 5 }, needs: {} },
      paths: { key: "paths", filled: { paths: [{ name: "Hot", when: "trigger.score > 80" }] }, needs: {} },
      wait: { key: "wait", filled: { forDuration: "2d" }, needs: {} },
      task: {
        key: "create_task",
        filled: { title: "Call {{ trigger.input.name }}", assigned: { kind: "person", id: who } },
        needs: { assigned: { kind: "person", id: who } },
      },
      chat: { key: "post_message", filled: { text: "New lead: {{ trigger.input.name }}" }, needs: {} },
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
        await page
          .getByTestId("auto-list")
          .getByText(`${kind}-${state}`, { exact: true })
          .first()
          .click({ timeout: 30_000 })
          .catch(async (e) => {
            await shot(`3-debug-${kind}-${state}`);
            await page
              .getByText("Details", { exact: true })
              .first()
              .click()
              .catch(() => undefined);
            console.log("ERRS", logs.slice(-4).join(" ## "));
            throw e;
          });
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
        assert.equal(
          /Templating|\{\{|\(required\)|More options/.test(text),
          false,
          `${kind} ${state}: no syntax on the page`,
        );
        assert.equal(/\b(usr|frm|rec|chn|ch)_[a-z0-9]{8,}/.test(text), false, `${kind} ${state}: no id on the page`);
      }

    // Insert data by menu: the menu lists what the trigger and earlier steps give by name with samples, and choosing one puts a chip in the field
    await page.getByText("task-empty", { exact: true }).first().click();
    await page.getByTestId("story").waitFor({ timeout: 20_000 });
    await page.getByTestId("sv-step-n1").click({ position: { x: 120, y: 14 } });
    await page.getByTestId("field-title-insert").click();
    await page.waitForTimeout(700);
    await shot("3-insert-data-d");
    const menuText = await page.getByRole("menu").last().innerText();
    assert.equal(/\{\{|usr_|_id\b/.test(menuText), false, "no brace or id in the Insert data menu");
    await page.getByRole("menuitem").first().click();
    await page.waitForTimeout(900);
    await page
      .getByTestId("field-title-chip-1")
      .waitFor({ timeout: 8_000 })
      .catch(() => undefined);
    assert.ok(await page.getByTestId("field-title-chip-1").count(), "a chip is in the field");
    await shot("3-insert-data-chosen-d");

    // the row's orange button lands on the control that is needed
    await page.getByText("task-needs", { exact: true }).first().click();
    await page.getByTestId("story").waitFor({ timeout: 20_000 });
    await page.getByTestId("sv-need-n1").click();
    await page.waitForTimeout(900);
    const focused = await page.evaluate(() => document.activeElement?.getAttribute("data-testid") ?? "");
    assert.match(focused, /^field-/, "the needed control has the focus");
    await shot("3-needs-button-focus-d");

    // why a real run of an Automation can end as failed: its first failed step says it in a sentence
    const intake = await make("Intake check", [
      { id: "n1", key: "create_task", input: { title: "Call back", assigned: { kind: "person", id: who } } },
    ]);
    await api("automations.set_enabled", { automationId: intake, enabled: true });
    await api("automations.run", { automationId: intake, payload: { name: "Sam Reyes" } });
    await page.waitForTimeout(2500);
    const runs = await api("runs.list", { scope: "subject", subject: { type: "automation", id: intake } });
    const run = (runs.runs ?? runs.data?.runs ?? [])[0];
    const steps = run ? await api("runs.steps", { runId: run.id }) : null;
    const failed = (steps?.steps ?? steps?.data?.steps ?? []).find((x: { state: string }) => x.state === "failed");

    // round five (walker): a Test that stops on a missing input is a stopped run, never a success
    const lacking = await make("Lacking a person", [{ id: "n1", key: "create_task", input: { title: "Call back" } }]);
    const tried = await api("automations.test", { automationId: lacking });
    const runId = (tried.data ?? tried).runId as string;
    await page.waitForTimeout(2500);
    await page.getByText("Lacking a person", { exact: true }).first().click();
    await page.getByTestId("story").waitFor({ timeout: 20_000 });
    await page
      .getByTestId("sv-test")
      .click()
      .catch(() => undefined);
    await page.waitForTimeout(2500);
    await shot("5-stopped-test-d");
    const got = await api("runs.get", { runId });
    const status = (got.run ?? got.data?.run ?? got.data).status as string;
    assert.equal(status, "failed", "a test that stops on a missing input is not a success");
    const why = await api("runs.steps", { runId });
    assert.match(
      JSON.stringify([got, why]),
      /choose who it is for/i,
      `the run says why in words: ${JSON.stringify([got, why]).slice(0, 700)}`,
    );

    // round five (walker): the Channel field is a picker by name, never a box with an example id
    const post = await make("Post a note", [{ id: "n1", key: "post_message", input: {} }]);
    await page.getByText("Post a note", { exact: true }).first().click();
    await page.getByTestId("story").waitFor({ timeout: 20_000 });
    await page.getByTestId("sv-step-n1").click({ position: { x: 120, y: 14 } });
    await page.getByTestId("field-channelId").waitFor({ timeout: 20_000 });
    const channelText = await page.getByTestId("field-channelId").innerText();
    assert.match(channelText, /Choose a channel/, "the channel is chosen from a menu");
    await page.getByTestId("field-channelId").click();
    await page.waitForTimeout(500);
    await shot("5-channel-picker-d");
    await page.keyboard.press("Escape");
    assert.equal(/\b[a-z]{3}_[a-z0-9]{6,}/.test(await page.locator("body").innerText()), false, "no id on the form");
    void post;

    // round five: the three forms that were once bodies of their own, shown in the one form
    await make("http-form", [
      {
        id: "n1",
        key: "http_request",
        input: { method: "POST", url: "https://api.example.com/orders", json: { note: "hello" } },
      },
    ]);
    await make("code-form", [{ id: "n1", key: "code", input: { source: "return { total: 1 };" } }]);
    for (const kind of ["http", "code"]) {
      await page.getByText(`${kind}-form`, { exact: true }).first().click();
      await page.getByTestId("story").waitFor({ timeout: 20_000 });
      await page.getByTestId("sv-step-n1").click({ position: { x: 120, y: 14 } });
      await page.waitForTimeout(900);
      await shot(`6-${kind}-form-d`);
      assert.equal(
        /\b[a-z]{3}_[a-z0-9]{6,}|\{\{|Templating/.test(await page.locator("body").innerText()),
        false,
        `${kind}: no id or syntax`,
      );
    }

    console.log("RUN", run?.status, JSON.stringify(failed?.error ?? null));
    assert.deepEqual(errors, [], "no page error");
  } finally {
    await browser.close();
    web.close();
    await space.stop();
  }
});
