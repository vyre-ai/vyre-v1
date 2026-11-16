// r32 list menu: right-click and the keyboard open the page's menu: Open, Rename, Duplicate, Turn on, Move to Trash (rc.32 lane r32-auto). Pictures go to SHOTS=<dir>.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { bootFreshSpace, claimOnEdge, dismissOnboarding, edge } from "./real-app-harness.test.ts";

const PASSWORD = "fixture password 123";
const SHOTS = process.env["SHOTS"];

test("r32 list menu: right-click and the keyboard open the page's menu: Open, Rename, Duplicate, Turn on, Move to Trash", async (t) => {
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

    const names = ["Lead follow-up", "Daily brief", "Invoice reminders"];
    for (const n of names) await make(n, [{ id: "n1", key: "post_message", input: { text: "hi" } }]);
    await page.goto(`${web.origin}/automations`, { waitUntil: "load" });
    await page.getByTestId("first-page").waitFor({ timeout: 30_000 });
    const rowOf = (n: string) => page.getByTestId("auto-list").getByText(n, { exact: true }).first();
    const menuLabels = async (): Promise<string[]> =>
      (await page.getByRole("menuitem").allInnerTexts()).map((x) => x.split("\n")[0]!.trim());

    // right-click
    await rowOf("Lead follow-up").click({ button: "right" });
    await page.getByRole("menuitem").first().waitFor({ timeout: 10_000 });
    const labels = await menuLabels();
    assert.deepEqual(labels.slice(0, 4), ["Open", "Open in New Tab", "Rename…", "Duplicate"], labels.join("|"));
    assert.ok(
      labels.some((l) => /^Turn (On|Off)$/.test(l)),
      "turn on or off",
    );
    assert.ok(labels.includes("Move to Trash…"), "Move to Trash");
    await shot("7-rightclick-d");
    await page.keyboard.press("Escape");

    // the keyboard: focus the row, press the menu key
    await page
      .getByTestId("row-auto-" + "x")
      .count()
      .catch(() => 0);
    const rows = page.getByTestId("auto-list").locator("[role=button]");
    await rows.first().focus();
    await page.keyboard.press("Shift+F10");
    await page.getByRole("menuitem").first().waitFor({ timeout: 10_000 });
    assert.equal((await menuLabels())[0], "Open", "the keyboard reaches the same menu");
    await shot("7-keyboard-d");
    await page.keyboard.press("Escape");

    // rename from the menu
    await rowOf("Lead follow-up").click({ button: "right" });
    await page.getByRole("menuitem", { name: "Rename…" }).click();
    await page.getByTestId("text-ask-field").waitFor({ timeout: 10_000 });
    await page.getByTestId("text-ask-field").fill("Lead reply");
    await shot("7-rename-d");
    await page.getByTestId("text-ask-go").click();
    await rowOf("Lead reply").waitFor({ timeout: 15_000 });

    // duplicate from the menu
    await rowOf("Lead reply").click({ button: "right" });
    await page.getByRole("menuitem", { name: "Duplicate" }).click();
    await rowOf("Lead reply (copy)").waitFor({ timeout: 15_000 });

    // the page's own menu has the same two, and Turn on
    await rowOf("Daily brief").click();
    await page.getByTestId("story").waitFor({ timeout: 20_000 });
    await page.getByTestId("page-menu").click();
    await page.getByRole("menuitem").first().waitFor({ timeout: 10_000 });
    const pageLabels = await menuLabels();
    assert.deepEqual(pageLabels.slice(0, 3), ["Rename…", "Duplicate", "Turn On"], pageLabels.join("|"));
    assert.ok(pageLabels.includes("Move to Trash"));
    await shot("7-page-menu-d");
    await page.keyboard.press("Escape");

    // move to Trash asks first, then the row goes
    await rowOf("Invoice reminders").click({ button: "right" });
    await page.getByRole("menuitem", { name: "Move to Trash…" }).click();
    await page.getByRole("menuitem", { name: "Move to Trash", exact: true }).click();
    await page
      .getByTestId("auto-list")
      .getByText("Invoice reminders", { exact: true })
      .waitFor({ state: "detached", timeout: 15_000 });

    // a phone, light
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ colorScheme: "light" });
    await page.waitForTimeout(1000);
    await shot("7-phone-light");
    assert.deepEqual(errors, [], "no page error");
  } finally {
    await browser.close();
    web.close();
    await space.stop();
  }
});
