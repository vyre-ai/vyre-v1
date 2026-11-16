// @tsx
// A Records board that draws only the stages it names (r32-board, 16 Nov 2026). A status field with 40 stages, a board saved through the API with 9 of them, opened in the real app: nine columns in
// the saved order, a count line, a key that is not a stage refused in plain words. Then the Columns choice: one stage taken out, one moved, saved with the view, and still so after a reload; the same
// type's board with nothing chosen draws all forty. Pictures (dark desktop 1440, light phone 390) go to VYRE_R32_SHOTS when it is set.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createCapCaller } from "../../../client/src/gateway/index.ts";
import { routes } from "../../../generated/routes.ts";
import { bootFreshSpace, claimOnEdge, edge, dismissOnboarding } from "./real-app-harness.test.ts";

const NINE = [
  ["new", "New"],
  ["in_review", "In review"],
  ["needs_info", "Needs info"],
  ["approved", "Approved"],
  ["scheduled", "Scheduled"],
  ["in_progress", "In progress"],
  ["blocked", "Blocked"],
  ["done", "Done"],
  ["closed", "Closed"],
] as const;
const stagesOf40 = (): { key: string; title: string }[] => {
  const out: { key: string; title: string }[] = NINE.map(([key, title]) => ({ key, title }));
  for (let i = 1; out.length < 40; i++) out.push({ key: `queue_${i}`, title: `Queue ${i}` });
  return out;
};
const PEOPLE = ["Imran Ibarra", "Andrea Lindahl", "Northwind intake", "Northwind portal", "Imran Ibarra Jr"];

test("a board draws only its chosen stages, in order, and keeps a changed choice across a reload", async (t) => {
  const dist = process.env["VYRE_APP_DIST"];
  if (!dist) {
    if (process.env["VYRE_REQUIRE_CHROME"] === "1") assert.fail("VYRE_APP_DIST required");
    t.skip("VYRE_APP_DIST required for production browser evidence");
    return;
  }
  const { chromium } = await import("playwright-core");
  const shots = process.env["VYRE_R32_SHOTS"];
  if (shots) fs.mkdirSync(shots, { recursive: true });
  const space = await bootFreshSpace();
  const web = await edge(dist, space.url);
  const browser = await chromium.launch({
    executablePath: process.env["CHROME_BIN"] || chromium.executablePath(),
    args: ["--no-sandbox"],
  });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "dark" });
  const page = await context.newPage();
  try {
    await page.goto(claimOnEdge(space.claim!, web.origin), { waitUntil: "load" });
    await page.getByTestId("claim-name").fill("Pat Owner");
    await page.getByTestId("claim-username").fill("patowner");
    await page.getByTestId("claim-password").fill("fixture password 123");
    await page.getByTestId("claim-confirm").fill("fixture password 123");
    await page.getByTestId("claim-next").click();
    await page.getByTestId("claim-create").click();
    await dismissOnboarding(page, { wait: 60_000 });
    await page.getByTestId("shell").waitFor({ timeout: 30_000 });
    const stored = await page.evaluate(
      () => JSON.parse(localStorage.getItem("vyre.session.v1")!).sessions[location.origin],
    );
    const api = createCapCaller({ baseUrl: web.origin, token: () => stored.token, routes: async () => routes });
    await api("schema.apply", {
      idempotencyKey: "board-stages-type",
      ops: [
        {
          op: "type.create",
          type: "intake_request",
          def: {
            title: "Request",
            plural: "Requests",
            icon: "user",
            titleField: "name",
            statusField: "stage",
            fields: [
              { key: "name", type: "text", title: "Name", required: true },
              { key: "stage", type: "status", title: "Stage", options: { stages: stagesOf40() } },
            ],
          },
        },
      ],
    });
    for (let i = 0; i < 24; i++)
      await api("records.create", {
        type: "intake_request",
        fields: { name: `${PEOPLE[i % PEOPLE.length]} ${i + 1}`, stage: stagesOf40()[(i * 5) % 40]!.key },
        idempotencyKey: `board-stages-rec-${i}`,
      });
    const nine = NINE.map(([key]) => key);
    // a key that is not a stage is refused in plain words, and so is a duplicate
    await assert.rejects(
      api("views.save", {
        type: "intake_request",
        kind: "board",
        title: "Bad",
        config: { group: "stage", stages: ["new", "approvedd"] },
        idempotencyKey: "board-stages-bad",
      }),
      /approvedd is not a stage of Stage\./,
    );
    const saved = (await api("views.save", {
      type: "intake_request",
      kind: "board",
      title: "Intake board",
      config: { group: "stage", stages: nine },
      idempotencyKey: "board-stages-view",
    })) as { view: { viewId: string } };
    const whole = (await api("views.save", {
      type: "intake_request",
      kind: "board",
      title: "Every stage board",
      config: { group: "stage" },
      idempotencyKey: "board-stages-whole",
    })) as { view: { viewId: string } };

    const lanes = (): Promise<string[]> =>
      page
        .locator('[data-testid^="lane-"]:not([data-testid^="lane-count-"])')
        .evaluateAll((els) => els.map((e) => (e.getAttribute("data-testid") ?? "").replace("lane-", "")));
    const openView = async (viewId: string): Promise<void> => {
      await page.goto(web.origin + "/records", { waitUntil: "load" });
      await page.getByTestId("shell").waitFor({ timeout: 30_000 });
      await page.getByTestId("row-nav:type:intake_request").click({ timeout: 30_000 });
      await page.getByTestId(`row-nav:view:${viewId}`).click({ timeout: 30_000 });
      await page.getByTestId("records-board").waitFor({ timeout: 30_000 });
    };

    await t.test("the saved board shows nine columns, in the saved order, with a count line", async () => {
      await openView(saved.view.viewId);
      await page.waitForFunction(() => document.querySelectorAll('[data-testid^="lane-"]').length > 0);
      assert.deepEqual(await lanes(), nine);
      const line = await page.getByTestId("board-count").innerText();
      assert.match(line, /^\d+ of 24 requests are in these 9 stages$/, line);
      if (shots) await page.screenshot({ path: path.join(shots, "board-nine-dark-1440.png") });
    });

    await t.test("the Columns choice: take one out and move one, save, and it is the same after a reload", async () => {
      await page.getByTestId("records-columns").click();
      await page.getByTestId("board-columns").waitFor({ timeout: 10_000 });
      if (shots) {
        await page.waitForTimeout(600);
        await page.screenshot({ path: path.join(shots, "board-columns-open-dark-1440.png") });
      }
      await page.getByTestId("row-col:blocked").click();
      await page.getByTestId("col-up-closed").click();
      await page.getByTestId("board-columns-done").click();
      await page.getByTestId("board-columns").waitFor({ state: "detached" });
      const want = nine.filter((k) => k !== "blocked");
      const at = want.indexOf("closed");
      [want[at], want[at - 1]] = [want[at - 1]!, want[at]!];
      await page.waitForFunction(
        (n) => document.querySelectorAll('[data-testid^="lane-"]:not([data-testid^="lane-count-"])').length === n,
        want.length,
      );
      assert.deepEqual(await lanes(), want);
      await page.getByTestId("records-save").click();
      await page.getByTestId("records-edited").waitFor({ state: "detached", timeout: 15_000 });
      await openView(saved.view.viewId);
      await page.waitForFunction(() => document.querySelectorAll('[data-testid^="lane-"]').length > 0);
      assert.deepEqual(await lanes(), want);
      const stored = (await api("views.get", { viewId: saved.view.viewId })) as {
        view: { config: { stages: string[] } };
      };
      assert.deepEqual(stored.view.config.stages, want);
    });

    await t.test("the board still honours the view's own filter: chosen stages narrow it further", async () => {
      const narrowed = (await api("views.save", {
        type: "intake_request",
        kind: "board",
        title: "Andrea board",
        filter: { field: "name", op: "contains", value: "Andrea" },
        config: { group: "stage", stages: nine },
        idempotencyKey: "board-stages-filter",
      })) as { view: { viewId: string } };
      await openView(narrowed.view.viewId);
      await page.getByTestId("board-count").waitFor({ timeout: 30_000 });
      await page.waitForFunction(() =>
        /^\d+ of 5 requests/.test(document.querySelector('[data-testid="board-count"]')?.textContent ?? ""),
      );
      assert.equal(await page.getByTestId("board-count").innerText(), "2 of 5 requests are in these 9 stages");
      assert.equal(await page.locator('[data-testid^="card-"]').count(), 2);
    });

    if (shots) {
      await t.test(
        "pictures on a phone, light: the chosen stages, the choice, and the board with nothing chosen",
        async () => {
          const ph = page;
          await ph.emulateMedia({ colorScheme: "light" });
          await ph.setViewportSize({ width: 390, height: 780 });
          try {
            // a phone-width page is built again as the table's list: the saved views menu brings the board back
            await ph.getByTestId("records-views").click({ timeout: 30_000 });
            await ph.getByText("Intake board", { exact: true }).last().click();
            await ph.getByTestId("records-board").waitFor({ timeout: 30_000 });
            await ph.getByTestId("board-count").waitFor({ timeout: 30_000 });
            await ph.waitForTimeout(800);
            await ph.screenshot({ path: path.join(shots, "board-chosen-light-390.png") });
            await ph.getByTestId("records-more").click();
            await ph.getByText("Columns,", { exact: false }).first().click();
            await ph.getByTestId("board-columns").waitFor({ timeout: 10_000 });
            await ph.waitForTimeout(800);
            await ph.screenshot({ path: path.join(shots, "board-columns-open-light-390.png") });
            await ph.getByTestId("board-columns-all").click();
            await ph.getByTestId("board-columns-done").click();
            await ph.getByTestId("board-columns").waitFor({ state: "detached" });
            await ph.waitForTimeout(800);
            await ph.screenshot({ path: path.join(shots, "board-none-light-390.png") });
          } finally {
            await ph.setViewportSize({ width: 1440, height: 900 });
            await ph.emulateMedia({ colorScheme: "dark" });
          }
        },
      );
    }

    await t.test("a board with nothing chosen draws all forty stages, as before", async () => {
      await openView(whole.view.viewId);
      await page.waitForFunction(() => document.querySelectorAll('[data-testid^="lane-"]').length >= 40);
      assert.equal((await lanes()).filter((k) => k !== "none").length, 40);
      assert.equal(await page.getByTestId("board-count").count(), 0, "no count line without a choice");
      if (shots) await page.screenshot({ path: path.join(shots, "board-none-dark-1440.png") });
    });
  } finally {
    await browser.close();
    await web.close();
    await space.stop();
  }
});
