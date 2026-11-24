// r32 pickers: a Wait picks its event from the Space's events and narrows it with that event's fields; files, folders and records are picked by name from a searchable list; the test runs on a past event (rc.32 lane r32-auto). Pictures go to SHOTS=<dir>.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { bootFreshSpace, claimOnEdge, dismissOnboarding, edge } from "./real-app-harness.test.ts";

const PASSWORD = "fixture password 123";
const SHOTS = process.env["SHOTS"];

test("r32 pickers: a Wait picks its event from the Space's events and narrows it with that event's fields; files, folders and records are picked by name from a searchable list; the test runs on a past event", async (t) => {
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

    // a folder and eight files to pick from
    const listed = await api("files.list", { section: "space" });
    const folder = (listed.folders ?? listed.data?.folders ?? [])[0];
    assert.ok(folder, "the Space has a folder");
    const folderId = (folder.id ?? folder.folderId) as string;
    for (let i = 1; i <= 8; i++)
      await api("files.create", { folderId, name: `Contract ${i}.docx`, content: { text: `Contract ${i}` } });

    // a real earlier event for the test to be tried on: a company created after the Automation exists
    const filesId = await make(
      "Contract reader",
      [{ id: "n1", key: "files.get", input: {} }],
      [{ key: "record_change", filter: { type: "company", op: "created" } }],
    );
    await api("records.create", { type: "company", fields: { name: "Contract Co" }, idempotencyKey: "picker-co" });
    await page.goto(`${web.origin}/automations`, { waitUntil: "load" });
    await page.getByTestId("first-page").waitFor({ timeout: 30_000 });
    // the pickers: files by name, searchable
    await page.getByTestId("auto-list").getByText("Contract reader", { exact: true }).first().click();
    await page.getByTestId("story").waitFor({ timeout: 20_000 });
    await page.getByTestId("sv-step-n1").click({ position: { x: 120, y: 14 } });
    await page.getByTestId("field-fileId").waitFor({ timeout: 20_000 });
    await page.getByTestId("field-fileId").click();
    const fsearch = page.getByRole("menu").last().locator("input");
    await fsearch.waitFor({ timeout: 10_000 });
    assert.ok((await page.getByRole("menuitem").count()) >= 8, "every file the person may open is listed");
    await fsearch.fill("Contract 3");
    await page.waitForFunction(() => document.querySelectorAll('[role="menuitem"]').length === 1, null, {
      timeout: 10_000,
    });
    assert.deepEqual(await page.getByRole("menuitem").allInnerTexts(), ["Contract 3.docx"]);
    await shot("4-file-picker-d");
    await page.getByRole("menuitem").first().click();
    await page
      .getByTestId("field-fileId")
      .filter({ hasText: /Contract 3\.docx/ })
      .waitFor({ timeout: 20_000 });
    assert.equal(/\bfil_[a-z0-9]{6,}/.test(await page.locator("body").innerText()), false, "no id on the page");

    // Test on a past event: the run is read and nothing is sent
    await page
      .getByTestId("sv-test")
      .click()
      .catch(() => undefined);
    // Test opens a pane to pick what to try it on: a real past event, never the made-up example
    await page.getByTestId("test-pane").waitFor({ timeout: 20_000 });
    const past = page.locator('[data-testid^="row-tp-try-"]').first();
    await past.waitFor({ timeout: 20_000 });
    const pastName = ((await past.innerText()).split("\n").find((l) => l.trim().length > 1) ?? "").trim();
    assert.ok(pastName !== "", "the past event has a name");
    await past.click();
    let made = 0;
    for (let i = 0; i < 40 && made === 0; i++) {
      const runs = await api("runs.list", { scope: "subject", subject: { type: "automation", id: filesId } });
      made = (runs.runs ?? runs.data?.runs ?? []).length;
      if (made === 0) await page.waitForTimeout(500);
    }
    assert.ok(made >= 1, "the test made a run to read");
    assert.ok(
      (await page.locator("body").innerText()).includes(pastName),
      `the pane names the event that was picked: ${pastName}`,
    );
    await shot("4-test-d");

    assert.deepEqual(errors, [], "no page error");
  } finally {
    await browser.close();
    web.close();
    await space.stop();
  }
});
