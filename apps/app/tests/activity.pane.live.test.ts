// A thing's side pane in the real app opens on Details, and Activity is the second tab that tells the story in words (owner, 13 Nov 2026). On a booted daemon: a goal with a start, three check-ins (one that
// failed for a usage limit and was held), a change of deadline and a finish; its pane opens on Details, Activity shows one line per thing in words with nothing a code or an id, the choice is kept for that goal and
// only that goal; the same rule on a task and a record. Photographed in both skins, on a desktop and on a phone, into VYRE_TEST_CAPTURE_DIR (default shots-evidence/activity-pane). Needs VYRE_APP_DIST and a Chromium.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createCapCaller } from "../../../client/src/gateway/index.ts";
import { routes } from "../../../generated/routes.ts";
import { FAILURE_WORDS, lower } from "../../../lib/words/failure.ts";
import { bootFreshSpace, claimOnEdge, edge, dismissOnboarding } from "./real-app-harness.test.ts";
import { guardCrashes } from "./crash-guard.ts";

const OUT = process.env["VYRE_TEST_CAPTURE_DIR"] ?? path.resolve("shots-evidence/activity-pane");
const DAY = 86_400_000;
const CODE = /\b(?:gol|agt|usr|tsk|msg|thr|rec)_[0-9a-f]{8,}|provider\.[a-z_]+|host_lost|turn_timeout/;

function modulesDb(dir: string): string {
  const hits: string[] = [];
  const walk = (d: string): void => {
    for (const n of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, n.name);
      if (n.isDirectory()) walk(p);
      else if (/\.(db|sqlite3?)$/.test(n.name)) hits.push(p);
    }
  };
  walk(dir);
  for (const f of hits) {
    try {
      const db = new DatabaseSync(f, { readOnly: true });
      const has = db.prepare("SELECT name FROM sqlite_master WHERE name = 'goals_activity'").get();
      db.close();
      if (has) return f;
    } catch {
      /* not this one */
    }
  }
  throw new Error(`no goals_activity table under ${dir}`);
}

test("a goal's, a task's and a record's pane opens on Details; Activity is the second tab, in words", async (t) => {
  const dist = process.env["VYRE_APP_DIST"];
  if (!dist) {
    t.skip("VYRE_APP_DIST is required for the pane walk");
    return;
  }
  fs.mkdirSync(OUT, { recursive: true });
  const { chromium } = await import("playwright-core");
  const space = await bootFreshSpace(),
    web = await edge(dist, space.url);
  const browser = await chromium.launch({
    executablePath: process.env["CHROME_BIN"] || chromium.executablePath(),
    args: ["--no-sandbox"],
  });
  const errors: string[] = [];
  const open = async (skin: "dark" | "light", phone: boolean): Promise<any> => {
    // eslint-disable-line @typescript-eslint/no-explicit-any
    const ctx = await browser.newContext({
      viewport: phone ? { width: 390, height: 780 } : { width: 1440, height: 900 },
      colorScheme: skin,
      ...(phone ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : {}),
    });
    const page = await ctx.newPage();
    guardCrashes(page);
    page.on("pageerror", (e: Error) => errors.push(e.message));
    return page;
  };
  try {
    const page = await open("dark", false);
    await page.goto(claimOnEdge(space.claim!, web.origin), { waitUntil: "load" });
    await page.getByTestId("claim-name").fill("Pane Owner");
    await page.getByTestId("claim-username").fill("paneowner");
    await page.getByTestId("claim-password").fill("fixture password 123");
    await page.getByTestId("claim-confirm").fill("fixture password 123");
    await page.getByTestId("claim-next").click();
    await page.getByTestId("claim-create").click();
    await dismissOnboarding(page);
    await page.getByTestId("shell").waitFor({ timeout: 30_000 });
    const session = await page.evaluate(() => localStorage.getItem("vyre.session.v1")!);
    const token = await page.evaluate(() => {
      const saved = JSON.parse(localStorage.getItem("vyre.session.v1")!);
      return saved.sessions?.[location.origin]?.token ?? saved.token;
    });
    const api = createCapCaller({ baseUrl: web.origin, token: () => token, routes: async () => routes });
    const call = (cap: string, input: Record<string, unknown>): Promise<any> => api(cap as never, input as never); // eslint-disable-line @typescript-eslint/no-explicit-any
    const owner = ((await call("spaces.get", {})) as any).space.owner as string; // eslint-disable-line @typescript-eslint/no-explicit-any
    const lead = ((await call("agents.list", {})) as any).agents[0].agentId as string; // eslint-disable-line @typescript-eslint/no-explicit-any

    // ---- a goal with a start, three check-ins (one held for a usage limit), a change of deadline and a finish
    const made = (await call("goals.create", {
      title: "Fill the autumn open day",
      finish: { kind: "owner", line: "Done when the owner says so" },
      deadline: Date.now() + 10 * DAY,
      leadAgentId: lead,
      start: true,
    })) as any; // eslint-disable-line @typescript-eslint/no-explicit-any
    const goalId = made.goal.id as string;
    await call("goals.extend", { goalId, deadline: Date.now() + 14 * DAY });
    const db = new DatabaseSync(modulesDb(space.dir));
    db.exec("PRAGMA busy_timeout = 5000");
    const put = (kind: string, text: string, by: string | null): void => {
      const seq =
        ((db.prepare("SELECT MAX(seq) AS s FROM goals_activity WHERE goal_id = ?").get(goalId) as any).s ?? 0) + 1; // eslint-disable-line @typescript-eslint/no-explicit-any
      db.prepare(
        "INSERT INTO goals_activity (goal_id, seq, at, kind, text, by, ref) VALUES (?, ?, ?, ?, ?, ?, NULL)",
      ).run(goalId, seq, Date.now() + seq, kind, text, by);
    };
    const why = FAILURE_WORDS["provider.rate_limited"]!;
    put(
      "report",
      "Checked the sign-ups: 40 of 150 are in, up 12 since yesterday. The reminder email goes out tomorrow.",
      lead,
    );
    put("wake", `Your assistant could not check in: ${lower(why.what)} ${why.fix}`, null);
    put("report", "Back on it: 52 of 150 are in. Nothing is waiting on you.", lead);
    db.close();
    await call("goals.finish", { goalId, note: "Full house." });

    // a second goal nobody has opened, to prove the kept tab belongs to one goal
    const other = (await call("goals.create", {
      title: "Print the sign-in sheets",
      finish: { kind: "owner", line: "Done when the owner says so" },
      deadline: Date.now() + 5 * DAY,
      leadAgentId: lead,
      start: true,
    })) as any; // eslint-disable-line @typescript-eslint/no-explicit-any

    const selected = async (p: any, tab: string, scope = "pane-header"): Promise<boolean> =>
      (await p.locator(`[data-testid="${scope}"] [data-testid="tab-${tab}-selected"]`).count()) > 0; // eslint-disable-line @typescript-eslint/no-explicit-any
    const goal = async (p: any, id: string): Promise<void> => {
      // eslint-disable-line @typescript-eslint/no-explicit-any
      await p.goto(`${web.origin}/chat#subject=goal:${id}`, { waitUntil: "load" });
      await p.waitForTimeout(1500); // a hash change inside the page does not reload it: let the pane switch to this goal
      await p
        .locator('[data-testid="pane-header"] [data-testid$="-selected"]')
        .first()
        .waitFor({ timeout: 30_000 })
        .catch(async (e: Error) => {
          await p.screenshot({ path: path.join(OUT, "goal-not-open.png") });
          throw new Error(
            `${e.message}; the page says: ${String(await p.locator("body").innerText()).slice(0, 400)}; at ${p.url()}`,
          );
        });
    };

    // desktop, dark then light: Details first, then Activity as a timeline
    for (const skin of ["dark", "light"] as const) {
      const p = skin === "dark" ? page : await open(skin, false);
      if (skin === "light") {
        await p.goto(web.origin, { waitUntil: "load" });
        await p.evaluate((s: string) => localStorage.setItem("vyre.session.v1", s), session);
      }
      await goal(p, goalId);
      assert.ok(await selected(p, "details"), "a goal's pane opens on Details");
      await p.screenshot({ path: path.join(OUT, `goal-1-details-${skin}-desktop.png`) });
      await p.locator('[data-testid="pane-header"] [data-testid="tab-activity"]').click();
      await p.getByTestId("goal-timeline").waitFor({ timeout: 15_000 });
      const text = (await p.getByTestId("goal-timeline").innerText()) as string;
      assert.match(text, /started the goal/, "the start is a line");
      assert.match(text, /usage limit|limit/i, "the held check-in says why in words");
      assert.match(text, /52 of 150/, "a check-in reads in full");
      assert.doesNotMatch(text, CODE, "no code and no id in the timeline");
      assert.doesNotMatch(text, /Moved from|was woken|\(\+0/, "no bookkeeping line");
      await p.screenshot({ path: path.join(OUT, `goal-2-activity-${skin}-desktop.png`) });
    }

    // the choice is kept for this goal and for no other
    await goal(page, goalId);
    assert.ok(await selected(page, "activity"), "the tab chosen last is kept for this goal");
    await goal(page, other.goal.id);
    assert.ok(await selected(page, "details"), "another goal opens on Details");

    // a phone, light then dark
    for (const skin of ["light", "dark"] as const) {
      const p = await open(skin, true);
      await p.goto(web.origin, { waitUntil: "load" });
      await p.evaluate((s: string) => localStorage.setItem("vyre.session.v1", s), session);
      await p.goto(`${web.origin}/chat#subject=goal:${goalId}`, { waitUntil: "load" });
      await p.waitForTimeout(2500);
      await p.screenshot({ path: path.join(OUT, `goal-3-page-${skin}-phone.png`) });
      await p.getByRole("button", { name: "More" }).first().click();
      await p.getByText("Show details").first().click();
      await p.getByTestId("goal-pane-phone").waitFor({ timeout: 10_000 });
      assert.ok(await selected(p, "details", "goal-pane-phone"), "on a phone the pane opens on Details too");
      await p.screenshot({ path: path.join(OUT, `goal-4-details-${skin}-phone.png`) });
      await p.locator('[data-testid="goal-pane-phone"] [data-testid="tab-activity"]').click();
      await p.getByTestId("goal-timeline").waitFor({ timeout: 15_000 });
      assert.doesNotMatch((await p.getByTestId("goal-timeline").innerText()) as string, CODE);
      await p.screenshot({ path: path.join(OUT, `goal-5-activity-${skin}-phone.png`) });
      await p.context().close();
    }

    // a task: Details first, Activity second, in words
    const task = (await call("tasks.create", {
      title: "Order the name badges",
      assigned: { kind: "person", id: owner },
      why: "They are needed on the day",
      idempotencyKey: "pane-task-fixture",
    })) as any; // eslint-disable-line @typescript-eslint/no-explicit-any
    const taskId = (task.task?.id ?? task.taskId ?? task.id) as string;
    await page.goto(`${web.origin}/chats#screen=tasks.page&taskId=${taskId}`, { waitUntil: "load" });
    await page.getByTestId("task-detail").waitFor({ timeout: 30_000 });
    assert.ok(await selected(page, "details"), "a task's pane opens on Details");
    await page.screenshot({ path: path.join(OUT, "task-1-details-dark-desktop.png") });
    await page.locator('[data-testid="pane-header"] [data-testid="tab-activity"]').click();
    await page.getByTestId("task-timeline").waitFor({ timeout: 15_000 });
    const tt = (await page.getByTestId("task-timeline").innerText()) as string;
    assert.match(tt, /created this/, "a task's activity says who made it");
    assert.doesNotMatch(tt, CODE);
    await page.screenshot({ path: path.join(OUT, "task-2-activity-dark-desktop.png") });

    // a record: Details first, Activity second
    await call("schema.apply", {
      ops: [
        {
          op: "type.create",
          type: "rt_guest",
          def: {
            title: "Guest",
            plural: "Guests",
            icon: "invoice",
            titleField: "name",
            fields: [
              { key: "name", type: "text", title: "Name", required: true },
              { key: "seat", type: "text", title: "Seat" },
            ],
          },
        },
      ],
    });
    const rec = (await call("records.create", {
      type: "rt_guest",
      fields: { name: "Sam Okoye", seat: "Table 4" },
    })) as any; // eslint-disable-line @typescript-eslint/no-explicit-any
    await call("records.update", { type: "rt_guest", recordId: rec.record.id, fields: { seat: "Table 6" } }).catch(
      () => undefined,
    );
    await page.goto(`${web.origin}/records#subject=record:${rec.record.id}&type=rt_guest`, { waitUntil: "load" });
    await page.getByTestId("record-pane").waitFor({ timeout: 30_000 });
    assert.ok(await selected(page, "details", "record-pane"), "a record's pane opens on Details");
    await page.screenshot({ path: path.join(OUT, "record-1-details-dark-desktop.png") });
    await page.locator('[data-testid="record-pane"] [data-testid="tab-activity"]').click();
    await page.getByTestId("record-timeline").waitFor({ timeout: 15_000 });
    const rt = (await page.getByTestId("record-timeline").innerText()) as string;
    assert.match(rt, /created it/);
    assert.doesNotMatch(rt, CODE);
    await page.screenshot({ path: path.join(OUT, "record-2-activity-dark-desktop.png") });

    assert.deepEqual(errors, [], "no page error");
  } finally {
    await browser.close();
    web.close();
    await space.stop();
    fs.rmSync(space.dir, { recursive: true, force: true });
  }
});
