// Living tasks, the Still need these card (lane r42-alive): the card at the top of Tasks lists what the Space cannot tell about with why, Keep and Archive answer one or all and each sends the right call. The Space is seeded the way other walks seed state: the ask rows go into the module's own table (the real clock needs two weeks to pass); every answer then goes through the real server and is read back.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createCapCaller } from "../../../client/src/gateway/index.ts";
import { routes } from "../../../generated/routes.ts";
import { bootFreshSpace, claimOnEdge, edge, dismissOnboarding } from "./real-app-harness.test.ts";
import type { CapMap } from "../../../generated/types.ts";
import { guardCrashes } from "./crash-guard.ts";

test("the card shows what is asked with why, in light and dark and on a phone; Keep and Archive send the right calls and the rows go", async (t) => {
  const dist = process.env["VYRE_APP_DIST"];
  if (!dist) {
    t.skip("VYRE_APP_DIST is required for the living tasks walk");
    return;
  }
  const { chromium } = await import("playwright-core");
  const space = await bootFreshSpace(),
    web = await edge(dist, space.url);
  const browser = await chromium.launch({
    executablePath: process.env["CHROME_BIN"] || chromium.executablePath(),
    args: ["--no-sandbox"],
  });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "dark" }),
    page = await context.newPage();
  const guard = guardCrashes(page);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const captureDir = process.env["VYRE_TEST_CAPTURE_DIR"];
  const shot = async (name: string): Promise<void> => {
    if (!captureDir) return;
    fs.mkdirSync(captureDir, { recursive: true });
    await page.screenshot({ path: `${captureDir}/${name}.png` });
  };
  try {
    await page.goto(claimOnEdge(space.claim!, web.origin), { waitUntil: "load" });
    await page.getByTestId("claim-name").fill("Task Owner");
    await page.getByTestId("claim-username").fill("taskowner");
    await page.getByTestId("claim-password").fill("fixture password 123");
    await page.getByTestId("claim-confirm").fill("fixture password 123");
    await page.getByTestId("claim-next").click();
    await page.getByTestId("claim-create").click();
    await dismissOnboarding(page);
    await page.getByTestId("shell").waitFor({ timeout: 30_000 });
    const token = await page.evaluate(() => {
      const saved = JSON.parse(localStorage.getItem("vyre.session.v1")!);
      return saved.sessions?.[location.origin]?.token ?? saved.token;
    });
    const api = createCapCaller({ baseUrl: web.origin, token: () => token, routes: async () => routes });
    const owner = ((await api("spaces.get", {})) as CapMap["spaces.get"]["out"]).space.owner;
    const me = { kind: "person" as const, id: owner };
    const day = 86_400_000;
    const make = async (title: string, over: Record<string, unknown> = {}): Promise<string> =>
      (
        (await api("tasks.create", {
          title,
          assigned: me,
          idempotencyKey: `alive-${title}`,
          ...over,
        })) as CapMap["tasks.create"]["out"]
      ).task.id;
    const read = async (id: string): Promise<CapMap["tasks.get"]["out"]["task"]> =>
      ((await api("tasks.get", { taskId: id })) as CapMap["tasks.get"]["out"]).task;
    const titles = ["Check the quarterly report", "Reply to the vendor", "Book the venue", "Update the handbook"];
    const ids: string[] = [];
    for (const [n, title] of titles.entries()) ids.push(await make(title));
    // a request whose chat is gone: the card can say it looks done but no one can read the words (a request lives in the chat that asked it)
    const goneId = await make("Which budget?", { kind: "answer", source: { kind: "chat", id: "thr_gone" } });
    const open = await make("A task that stays on the list");
    const why = [
      "Nothing has happened for 14 days.",
      "Its expected date has passed.",
      "Nothing has happened for 14 days.",
      "Nothing has happened for 14 days.",
    ];
    const withDb = <T>(f: (db: DatabaseSync) => T): T => {
      const db = new DatabaseSync(path.join(space.dir, "modules.db"));
      try {
        db.exec("PRAGMA busy_timeout=5000");
        return f(db);
      } finally {
        db.close();
      }
    };
    withDb((db) => {
      for (const [n, id] of ids.entries())
        db.prepare(
          "INSERT INTO tasks_ask (task_id, at, why, kept_until, look, quote, quote_by, quote_at) VALUES (?, ?, ?, NULL, ?, ?, ?, ?)",
        ).run(
          id,
          Date.now() - 86_400_000 + n,
          n === 2 ? "Looks done" : why[n],
          n === 2 ? "done" : null,
          n === 2 ? "Payment received, $171.56" : null,
          n === 2 ? owner : null,
          n === 2 ? Date.now() - 2 * 86_400_000 : null,
        );
    });
    withDb((db) =>
      db
        .prepare(
          "INSERT INTO tasks_ask (task_id, at, why, kept_until, look, quote, quote_by, quote_at) VALUES (?, ?, 'Looks done', NULL, 'done', 'Budget approved by finance', ?, ?)",
        )
        .run(goneId, Date.now(), owner, Date.now() - 86_400_000),
    );
    const kept = (id: string): number | null =>
      withDb(
        (db) =>
          (
            db.prepare("SELECT kept_until FROM tasks_ask WHERE task_id = ?").get(id) as
              | { kept_until: number | null }
              | undefined
          )?.kept_until ?? null,
      );
    void open;
    const seenAt = (id: string): number | null =>
      withDb(
        (db) =>
          (
            db.prepare("SELECT seen_at FROM tasks_ask WHERE task_id = ?").get(id) as
              | { seen_at: number | null }
              | undefined
          )?.seen_at ?? null,
      );
    let seenCalls = 0;
    await page.route("**/v1/tasks/still_answer", (route) => {
      if ((route.request().postDataJSON() as { answer?: string }).answer === "seen") seenCalls += 1;
      return route.continue();
    });
    // a hidden tab never counts as seeing the card: the page says it is hidden for a while, nothing is stamped, then it shows and it is
    await page.addInitScript(() => {
      (window as unknown as { __vis: string }).__vis = "hidden";
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        get: () => (window as unknown as { __vis: string }).__vis,
      });
    });
    await page.goto(`${web.origin}/chats#screen=tasks.my-work`, { waitUntil: "load" });
    await page.getByTestId("tasks-still").waitFor({ timeout: 30_000 });
    await page.waitForTimeout(4000);
    assert.equal(seenAt(ids[0]!), null, "a hidden page does not stamp the card as seen");
    await page.evaluate(() => {
      (window as unknown as { __vis: string }).__vis = "visible";
      document.dispatchEvent(new Event("visibilitychange"));
    });
    for (let i = 0; i < 40 && seenAt(ids[0]!) === null; i++) await page.waitForTimeout(250);
    assert.ok(seenAt(ids[0]!) !== null, "showing the card stamps that someone saw it");
    await page.waitForTimeout(6000);
    assert.equal(seenCalls, 1, "the seen call stops once it was sent");
    assert.match(await page.getByTestId("tasks-still").innerText(), /5 tasks may be finished/);
    await shot("card-closed-dark-desktop");
    await page.getByTestId("still-open").click();
    await page.getByTestId("tasks-still").getByText("Reply to the vendor", { exact: true }).waitFor();
    await page.getByText(/Its expected date has passed/).waitFor();
    await shot("card-open-dark-desktop");
    // the task's own chat has its owner in it, so this reader may read the quote: the words, who wrote them and when, and Done. (A reader who is not in the chat gets no quote: look.test.ts)
    await page
      .getByTestId("tasks-still")
      .getByText(/Payment received, \$171\.56/)
      .waitFor();
    await page.getByTestId("still-done").waitFor();
    // the request whose chat is gone: it says it looks done and where to look, never the words, and has no Done
    await page.getByTestId("tasks-still").getByText("Open the chat to see why").waitFor();
    assert.equal(
      await page
        .getByTestId("tasks-still")
        .getByText(/Budget approved by finance/)
        .count(),
      0,
      "no quote for a reader who cannot read the chat",
    );
    assert.equal(
      await page.getByTestId("still-done").count(),
      1,
      "Done only on the row whose words this reader can read",
    );
    await shot("card-look-dark-desktop");
    await page.emulateMedia({ colorScheme: "light" });
    await page.waitForTimeout(400);
    await shot("card-open-light-desktop");
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(400);
    assert.ok(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      "the card fits a phone",
    );
    // the page redraws at phone width: open the card there
    await page.getByTestId("tasks-still").waitFor({ timeout: 10_000 });
    assert.ok((await page.getByTestId("still-keep").count()) > 0, "the card stayed open across the width change");
    await page.waitForTimeout(300);
    await shot("card-open-light-phone");
    await page.emulateMedia({ colorScheme: "dark" });
    await page.waitForTimeout(400);
    await shot("card-open-dark-phone");
    await page.setViewportSize({ width: 1440, height: 900 });

    await page.waitForTimeout(800);
    // a resize may redraw the page: open the card again if it closed
    await page.getByTestId("tasks-still").waitFor({ timeout: 10_000 });
    assert.ok((await page.getByTestId("still-keep").count()) > 0, "the card stayed open across the width change");

    // Keep the first: the server remembers it for 90 days and the row goes
    await page.getByTestId("still-keep").first().click();
    for (let i = 0; i < 40 && kept(ids[0]!) === null; i++) await page.waitForTimeout(250);
    assert.ok((kept(ids[0]!) ?? 0) > Date.now() + 80 * 86_400_000, "kept for about 90 days");
    await page
      .getByTestId("tasks-still")
      .getByText(titles[0]!, { exact: true })
      .waitFor({ state: "detached", timeout: 10_000 });
    assert.equal((await read(ids[0]!)).archived, undefined, "kept is not archived");
    // Archive the next: it is put away with the card's code and Put back is possible
    await page.getByTestId("still-archive").first().click();
    for (let i = 0; i < 40 && (await read(ids[1]!)).archived === undefined; i++) await page.waitForTimeout(250);
    assert.equal((await read(ids[1]!)).archived?.code, "asked");
    await page
      .getByTestId("tasks-still")
      .getByText(titles[1]!, { exact: true })
      .waitFor({ state: "detached", timeout: 10_000 });
    await shot("card-two-left-dark-desktop");
    // Keep all: the rest are kept and the card goes
    await page.getByTestId("still-keep-all").click();
    for (let i = 0; i < 40 && (kept(ids[2]!) === null || kept(ids[3]!) === null); i++) await page.waitForTimeout(250);
    assert.ok(kept(ids[2]!) !== null && kept(ids[3]!) !== null);
    await page.getByTestId("tasks-still").waitFor({ state: "detached", timeout: 10_000 });
    assert.equal((await read(ids[2]!)).archived, undefined);
    await guard.check("at the end");
    assert.deepEqual(errors, []);
  } catch (failure) {
    const dir = process.env["VYRE_TEST_CAPTURE_DIR"] ?? "/tmp/vyre-alive-card-failure";
    fs.mkdirSync(dir, { recursive: true });
    await page.screenshot({ path: `${dir}/failure.png`, fullPage: true }).catch(() => undefined);
    console.error(
      "alive failure",
      page.url(),
      await page
        .locator("body")
        .innerText()
        .catch(() => "no body"),
      errors,
    );
    throw failure;
  } finally {
    await context.close();
    await browser.close();
    web.close();
    await space.stop();
    fs.rmSync(space.dir, { recursive: true, force: true });
  }
});
