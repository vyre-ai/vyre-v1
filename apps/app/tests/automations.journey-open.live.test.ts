// An agent-made Journey opens (owner report on rc.39): the Journey is made through the API (eight stages, a start rule, records started in it), then in the real app the Automations list shows it,
// a click opens it as a pipeline of its stages with the records counted, and the same Journey opens from a deep link and from a tab (the subject link the Chats and Console doors use).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { bootFreshSpace, claimOnEdge, dismissOnboarding, edge } from "./real-app-harness.test.ts";

const PASSWORD = "fixture password 123";
const SHOTS = process.env["SHOTS"];
const KEYS = ["new", "contacted", "qualified", "proposal", "negotiation", "won", "onboarding", "done"];

test("production Automations: a Journey made through the API opens from the list and from its link, as a pipeline of its stages", async (t) => {
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
  const post = async (p: string, body: unknown): Promise<Record<string, unknown>> => {
    const r = await fetch(`${space.url}${p}`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${space.token}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
    const text = await r.text();
    assert.equal(r.status, 200, `${p}: ${text}`);
    return (JSON.parse(text) as { data: Record<string, unknown> }).data;
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

    // what an agent does: a Journey with eight stages and its start rule, a draft Flow beside it, two records started in it
    const j = (
      await post("/v1/journeys/create", {
        name: "Client pipeline",
        subjectType: "company",
        stages: KEYS.map((key, order) => ({
          key,
          title: key[0]!.toUpperCase() + key.slice(1),
          order,
          exit: { requireTasks: false },
          tasks: [],
          automations: [],
          ...(order === KEYS.length - 1 ? { final: true } : {}),
        })),
        startRule: { event: "record.created", enabled: true },
        idempotencyKey: "j-open-walk",
      })
    )["journey"] as { id: string };
    await post("/v1/automations/create", { name: "Draft follow up", idempotencyKey: "a-open-walk" });
    for (const name of ["Acme", "Birch"]) {
      const rec = (
        (await post("/v1/records/create", { type: "company", fields: { name }, idempotencyKey: `s-${name}` }))[
          "record"
        ] as { id: string }
      ).id;
      await post("/v1/journeys/start", { journeyId: j.id, subjectRecordId: rec, idempotencyKey: `st-${name}` });
    }

    await page.goto(`${web.origin}/automations`, { waitUntil: "load" });
    const row = page.getByTestId(`row-auto-${j.id}`).first();
    await row.waitFor({ timeout: 20_000 });
    await row.click();
    await page.getByTestId("journey-designer").waitFor({ timeout: 15_000 }).catch(async (e: Error) => {
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/journey-open-fail.png` });
      const ids = await page.locator("[data-testid]").evaluateAll((els) => els.map((x) => x.getAttribute("data-testid")).slice(0, 80));
      throw new Error(`the Journey did not open: ${e.message}; page errors ${JSON.stringify(errors)}; ids ${JSON.stringify(ids)}; text ${(await page.locator("body").innerText()).slice(0, 600)}`);
    });
    for (const k of KEYS) await page.getByTestId(`stage-${k}`).waitFor({ timeout: 10_000 });
    await page.getByTestId("funnel").waitFor({ timeout: 10_000 });
    assert.equal(await page.getByTestId("journey-gone").count(), 0, "the Journey is found");
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/journey-open-list.png` });

    // the same Journey from its link (what a task's "From a journey" chip and the Console open)
    await page.goto(`${web.origin}/automations`, { waitUntil: "load" });
    await page.getByTestId(`row-auto-${j.id}`).first().waitFor({ timeout: 20_000 });
    await page.evaluate((id) => {
      location.hash = `#subject=journey:${id}`;
    }, j.id);
    await page.waitForTimeout(500);
    const linked = await page
      .getByTestId("journey-designer")
      .waitFor({ timeout: 8_000 })
      .then(
        () => true,
        () => false,
      );
    assert.ok(linked, "a Journey link opens the Journey");
    assert.deepEqual(errors, [], "no page error");
  } finally {
    await browser.close();
    web.close();
    await space.stop();
  }
});
