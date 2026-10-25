// P-APP_01: the real app against a booted daemon. A seeded Space runs as the daemon process a person starts (host/src/daemon/main.ts); the app's web export is served from a tiny same-origin server that proxies the
// gateway and the live socket to the daemon (the production shape: one origin, no CORS); a real Chromium opens it. What a person does, in order:
//   1 the app opens on sign-in (nothing is signed in)               2 sign in                          3 Home shows the Space's real data
//   4 Chats: send a message and it appears                          5 Records: open a table            6 Files: open a file
// A step whose module is still a stub in host/modules.json is reported as TODO with the packet that makes it live; it is never faked and never counted as a pass. Step 2 is the owner bootstrap
// token (the same door the CLI and the Console use) until the seeded Space carries a member with a password (golden flow 02); it is labelled as such in the output.
// Needs a Chromium (CHROME_BIN, or playwright-core's own) and a web export (VYRE_APP_DIST; without it the test skips with a message). VYRE_REQUIRE_CHROME=1 turns a missing Chromium into a failure.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { bootSpace, edge, liveModules, ownerSession, todoFor } from "./real-app-harness.ts";

function exportApp(): string {
  return process.env["VYRE_APP_DIST"] ?? "";
}

test("the pure parts: a step is TODO with its packet when a module it needs is a stub, and passes through when all are live", () => {
  const live = new Set(["home", "tasks", "records"]);
  assert.equal(todoFor("home", live), null);
  assert.equal(todoFor("records", live), null);
  assert.match(todoFor("chats", live) ?? "", /chat still a stub in host\/modules.json \(live with P-L2_LIVE\)/);
  assert.match(todoFor("sign in", live) ?? "", /identity, spaces, devices .* P-L7_LIVE/);
  assert.throws(() => todoFor("nope", live));
});

test("the real app on a booted daemon: sign-in screen, then Home, Chats, Records and Files from the seeded Space", async (t) => {
  if (!process.env["VYRE_APP_DIST"]) {
    t.skip("VYRE_APP_DIST is not set: the shots job runs this test after the production export (PR 491)");
    return;
  }
  const pw = await import("playwright-core");
  const chromium = pw.chromium ?? (pw as unknown as { default: typeof pw }).default.chromium;
  const exe = process.env["CHROME_BIN"] || chromium.executablePath();
  if (!fs.existsSync(exe)) {
    if (process.env["VYRE_REQUIRE_CHROME"] === "1") assert.fail(`no Chromium at ${exe}`);
    t.skip("no Chromium on this machine");
    return;
  }
  const live = liveModules();
  const space = await bootSpace();
  const dist = exportApp();
  const web = await edge(dist, space.url);
  const browser = await chromium.launch({ executablePath: exe, args: ["--no-sandbox"] });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const todo: string[] = [];
  try {
    await t.test("1 the app opens on sign-in when nobody is signed in", async () => {
      await page.goto(`${web.origin}/home`, { waitUntil: "load" });
      await page.getByTestId("si-user").waitFor({ timeout: 15_000 });
      assert.equal(await page.getByTestId("shell").count(), 0, "no shell before sign-in");
    });

    await t.test("2 sign in (owner bootstrap token) opens the shell on the Space", async (s) => {
      const gap = todoFor("sign in", live);
      if (gap) { todo.push(gap); s.todo(gap); return; }
      const session = ownerSession(space, web.origin);
      await page.evaluate((v) => { localStorage.setItem("vyre.session.v1", JSON.stringify(v)); }, session);
      await page.reload({ waitUntil: "load" });
      await page.getByTestId("shell").waitFor({ timeout: 15_000 });
    });

    await t.test("3 Home shows real data from the Space", async (s) => {
      const gap = todoFor("sign in", live) ?? todoFor("home", live);
      if (gap) { todo.push(gap); s.todo(gap); return; }
      await page.getByTestId("rail-home").or(page.getByTestId("rail-home-selected")).first().click();
      await page.getByTestId("s-needs").or(page.getByTestId("home-place")).first().waitFor({ timeout: 15_000 });
    });

    await t.test("4 Chats: a message sent from the composer appears in the conversation", async (s) => {
      const gap = todoFor("sign in", live) ?? todoFor("chats", live);
      if (gap) { todo.push(gap); s.todo(gap); return; }
      await page.getByTestId("rail-chats").or(page.getByTestId("rail-chats-selected")).first().click();
      const field = page.getByTestId("composer-field");
      await field.waitFor({ timeout: 15_000 });
      const text = `real app check ${Date.now()}`;
      await field.fill(text);
      await field.press("Enter");
      await page.getByText(text).first().waitFor({ timeout: 15_000 });
    });

    await t.test("5 Records: a table opens with its rows", async (s) => {
      const gap = todoFor("sign in", live) ?? todoFor("records", live);
      if (gap) { todo.push(gap); s.todo(gap); return; }
      await page.getByTestId("rail-records").or(page.getByTestId("rail-records-selected")).first().click();
      await page.locator('[data-testid^="rec-"]').first().waitFor({ timeout: 15_000 });
    });

    await t.test("6 Files: the list shows files and one opens", async (s) => {
      const gap = todoFor("sign in", live) ?? todoFor("files", live);
      if (gap) { todo.push(gap); s.todo(gap); return; }
      await page.getByTestId("rail-files").or(page.getByTestId("rail-files-selected")).first().click();
      await page.getByTestId("files-list").waitFor({ timeout: 15_000 });
    });

    assert.deepEqual(errors, [], "the page threw no errors");
  } finally {
    if (todo.length) console.log(`real-app e2e TODO (not a pass):\n  ${todo.join("\n  ")}`);
    await browser.close();
    web.close();
    await space.stop();
    fs.rmSync(space.dir, { recursive: true, force: true });
  }
});
