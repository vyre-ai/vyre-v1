// SPEED on a big Space, measured in a real browser (r34-appspeed, 17 Nov 2026: a firm's onboarding call failed on a Space of ~9,400 matters of 100 fields, 27,900 contacts, 1,100 organizations, 13,000 link rows and
// ~7,000 more records: pages took ages and actions errored). The Space is built through records.bulk_upsert (test/support/bigspace-seed.ts), a fresh browser signs in, and each thing a person does first is timed
// from the press to the screen: first usable after sign-in, the big table's first rows, a scroll with no long task, one record, a search, Report a problem. VYRE_PERF_FULL=1 builds the firm's own size
// (the hourly perf run); the walk run builds a fifth of it so it ends well inside a minute. The budgets are the same at both sizes and are never raised.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { browserOrSkip } from "./support/mail-browser.ts";
import { apiFor, seedBigSpace, bigSizes, BIG } from "./support/bigspace-seed.ts";
import { bootFreshSpace, claimOnEdge, dismissOnboarding, edge } from "../apps/app/tests/real-app-harness.test.ts";

const FULL = process.env["VYRE_PERF_FULL"] === "1";
const BUDGET = { usableMs: 2000, tableMs: 800, recordMs: 300, searchMs: 300, reportMs: 5000, longTaskMs: 50 } as const;
const med = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;

test("a big Space: first usable, the table, a record, search and Report a problem inside their budgets", async (t) => {
  const env = await browserOrSkip();
  if (typeof env === "string") return void t.skip(env);
  const space = await bootFreshSpace();
  const web = await edge(env.dist, space.url);
  const browser = await env.chromium.launch({ executablePath: env.exe });
  const seen: Record<string, number | string> = {};
  try {
    const sizes = FULL ? BIG : bigSizes(0.2);
    const built = Date.now();
    const seeded = await seedBigSpace(apiFor(space.url, space.token), sizes, "speed", space.space);
    seen["seedMs"] = Date.now() - built;
    const api = apiFor(web.origin, space.token);
    const first = (await api("records.query", { type: "matter", limit: 1 })) as {
      rows: { fields: { name: string } }[];
    };
    const person = (await api("records.query", { type: "big_contact", limit: 1 })) as {
      rows: { fields: { name: string } }[];
    };
    assert.ok(first.rows[0] && person.rows[0], "the seed made matters and people");
    assert.ok(seeded.contactIds.length >= sizes.contacts, "every contact exists");

    // sign in as the owner (the claim a person does), then keep the session for fresh browsers
    const signIn = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const p0 = await signIn.newPage();
    await p0.goto(claimOnEdge(space.claim!, web.origin));
    await p0.getByTestId("claim-name").fill("Owner One");
    await p0.getByTestId("claim-username").fill("ownerone");
    await p0.getByTestId("claim-password").fill("fixture bigspace password123");
    await p0.getByTestId("claim-confirm").fill("fixture bigspace password123");
    await p0.getByTestId("claim-next").click();
    await p0.getByTestId("claim-create").click();
    await dismissOnboarding(p0);
    await p0.getByTestId("shell").waitFor({ timeout: 60_000 });
    try {
      await p0.getByText("Not now", { exact: true }).click({ timeout: 4_000 });
    } catch {
      /* no connect-AI card this time */
    }
    const state = await signIn.storageState();
    await signIn.close();

    // let the server finish what the import left it (search indexing, consumers): a person opens the app after it, and the wait is reported
    const quiet = Date.now();
    for (let ok = 0; ok < 3 && Date.now() - quiet < 120_000; ) {
      const s = Date.now();
      await api("identity.whoami", {});
      ok = Date.now() - s < 100 ? ok + 1 : 0;
      await new Promise((r) => setTimeout(r, 250));
    }
    seen["settleMs"] = Date.now() - quiet;

    // 1. first usable: a fresh browser opens the Space already signed in
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, storageState: state });
    const page = await ctx.newPage();
    await page.addInitScript(() => {
      const w = window as unknown as { __lt: number[] };
      w.__lt = [];
      try {
        new PerformanceObserver((l) => {
          for (const e of l.getEntries()) w.__lt.push(Math.round(e.duration));
        }).observe({ entryTypes: ["longtask"] });
      } catch {
        /* no long task support */
      }
    });
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const t1 = Date.now();
    await page.goto(web.origin + "/", { waitUntil: "commit" });
    await page.getByTestId("shell").waitFor({ timeout: 60_000 });
    await page.getByTestId("rail-records").or(page.getByTestId("rail-records-selected")).first().waitFor();
    seen["usableMs"] = Date.now() - t1;
    assert.ok(
      Number(seen["usableMs"]) <= BUDGET.usableMs,
      `first usable ${seen["usableMs"]} ms over ${BUDGET.usableMs}`,
    );

    // 2. the big table: first rows after the press
    await page.goto(web.origin + "/records", { waitUntil: "commit" });
    await page.getByTestId("row-nav:type:matter").waitFor({ timeout: 60_000 });
    const firstName = first.rows[0]!.fields.name;
    // another table first, so the press below opens the big one from somewhere else
    await page.getByTestId("row-nav:type:big_org").click();
    await page.getByText("Holdings 0", { exact: false }).first().waitFor({ timeout: 30_000 });
    const t2 = Date.now();
    await page.getByTestId("row-nav:type:matter").click();
    await page.getByText(firstName, { exact: true }).locator("visible=true").first().waitFor({ timeout: 30_000 });
    seen["tableMs"] = Date.now() - t2;
    assert.ok(
      Number(seen["tableMs"]) <= BUDGET.tableMs,
      `the table's first rows ${seen["tableMs"]} ms over ${BUDGET.tableMs}`,
    );
    const count = await page.getByTestId("count-matter").innerText();
    assert.match(
      count.replace(/[^0-9]/g, ""),
      new RegExp(`^${sizes.matters}$`),
      `the sidebar counts every matter: ${count}`,
    );

    // 3. a scroll down the table: no long task
    await page.evaluate(() => ((window as unknown as { __lt: number[] }).__lt = []));
    const scroller = page.getByTestId("records-scroll");
    for (let i = 1; i <= 14; i++) {
      await scroller.evaluate((e, k) => ((e as HTMLElement).scrollTop = k * 700), i);
      await page.waitForTimeout(50);
    }
    await page.waitForTimeout(400);
    const tasks = await page.evaluate(() => (window as unknown as { __lt: number[] }).__lt);
    seen["scrollLongTasks"] = tasks.length;
    seen["scrollLongestMs"] = Math.max(0, ...tasks);
    assert.deepEqual(
      tasks,
      [],
      `scrolling the table ran long tasks: ${tasks.join(", ")} ms (over ${BUDGET.longTaskMs} ms)`,
    );
    await scroller.evaluate((e) => ((e as HTMLElement).scrollTop = 0));

    // 4. one record: from the press on its open button to the record's page
    const opens: number[] = [];
    for (let i = 0; i < 3; i++) {
      const rowName = page.getByText(firstName, { exact: true }).locator("visible=true").first();
      await rowName.waitFor({ timeout: 30_000 });
      // the open button shows while the pointer is over the row: hover again until the table has settled under it
      const openBtn = page.locator('[data-testid^="open-"]').first();
      for (let tries = 0; tries < 20; tries++) {
        await page.mouse.move(900, 700); // a pointer already over the row shows nothing new: come to it from outside
        await rowName.hover();
        if (
          await openBtn.waitFor({ state: "attached", timeout: 1_000 }).then(
            () => true,
            () => false,
          )
        )
          break;
      }
      if (process.env["VYRE_TEST_CAPTURE_DIR"] && i === 0)
        await page.screenshot({ path: path.join(process.env["VYRE_TEST_CAPTURE_DIR"], "bigspace-before-open.png") });
      const t3 = Date.now();
      await openBtn.click({ force: true });
      await page.getByTestId("record-page").or(page.getByTestId("pane-details")).first().waitFor({ timeout: 30_000 });
      opens.push(Date.now() - t3);
      await page.getByTestId("record-page").or(page.getByTestId("pane-details")).first().waitFor();
      if (process.env["VYRE_TEST_CAPTURE_DIR"] && i === 0)
        await page.screenshot({ path: path.join(process.env["VYRE_TEST_CAPTURE_DIR"], "bigspace-record.png") });
      await page.goto(web.origin + "/records", { waitUntil: "commit" });
      await page.getByTestId("row-nav:type:matter").click();
    }
    seen["recordMs"] = med(opens);
    assert.ok(
      Number(seen["recordMs"]) <= BUDGET.recordMs,
      `opening a record ${opens.join(", ")} ms over ${BUDGET.recordMs}`,
    );

    // 5. search: a matter and a person, from the last key to the answer
    const searches: number[] = [];
    for (const [name, label] of [
      [firstName, "matter"],
      [person.rows[0]!.fields.name, "person"],
    ] as const) {
      await page.keyboard.press("Control+k");
      await page.getByTestId("cmdk-input").waitFor();
      const t4 = Date.now();
      await page.getByTestId("cmdk-input").fill(name);
      await page.getByTestId("cmdk-list").getByText(name, { exact: true }).first().waitFor({ timeout: 10_000 });
      searches.push(Date.now() - t4);
      seen[`search_${label}_ms`] = searches[searches.length - 1]!;
      await page.keyboard.press("Escape");
    }
    assert.ok(Math.max(...searches) <= BUDGET.searchMs, `search ${searches.join(", ")} ms over ${BUDGET.searchMs}`);

    // 6. Report a problem sends (it errored for the firm)
    await page.keyboard.press("Control+Shift+/");
    await page.getByTestId("report-sheet").waitFor({ timeout: 10_000 });
    const t5 = Date.now();
    await page.getByTestId("report-send").click();
    await page.getByTestId("report-done").waitFor({ timeout: BUDGET.reportMs });
    seen["reportMs"] = Date.now() - t5;
    assert.equal(await page.getByTestId("report-error").count(), 0, "Report a problem showed an error");
    assert.deepEqual(errors, [], "the page threw");
    const out = process.env["VYRE_TEST_CAPTURE_DIR"];
    if (out) {
      fs.mkdirSync(out, { recursive: true });
      await page.screenshot({ path: path.join(out, "bigspace-report-sent.png") });
      fs.writeFileSync(path.join(out, "bigspace-speed.json"), JSON.stringify({ sizes, ...seen }, null, 1));
    }
    await ctx.close();
  } finally {
    console.log("BIGSPACE", JSON.stringify(seen));
    await browser.close();
    web.close();
    await space.stop();
    fs.rmSync(space.dir, { recursive: true, force: true });
  }
});
