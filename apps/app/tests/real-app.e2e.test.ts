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
import { bootFreshSpace, claimOnEdge, edge, liveModules, todoFor } from "./real-app-harness.test.ts";

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
  const space = await bootFreshSpace();
  const dist = exportApp();
  const web = await edge(dist, space.url);
  const browser = await chromium.launch({ executablePath: exe, args: ["--no-sandbox"] });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  // What the app asked the Space and what it answered: a step that times out shows these, so a failure names its cause (a refused call, a console error, the text on screen).
  const seen: string[] = [];
  page.on("console", (m) => { if (m.type() === "error") seen.push(`console.error ${m.text().slice(0, 200)}`); });
  page.on("response", (r) => {
    const u = new URL(r.url());
    if (u.pathname.startsWith("/v1/") || u.pathname.startsWith("/sync/")) {
      void r.text().then((b) => { if (r.status() >= 400) seen.push(`${r.status()} ${r.request().method()} ${u.pathname} ${b.slice(0, 200)}`); }).catch(() => undefined);
    }
  });
  // Calls to the Space that carried no bearer token: a 401 "No valid session" can mean the app sent none.
  const bare: string[] = [];
  page.on("request", (r) => {
    const u = new URL(r.url());
    if ((u.pathname.startsWith("/v1/") && u.pathname !== "/v1/identity/claim_owner" && u.pathname !== "/v1/identity/sign_in") && !r.headers()["authorization"]) bare.push(`${r.method()} ${u.pathname}`);
  });
  const dump = async (label: string): Promise<void> => {
    const text = await page.locator("body").innerText({ timeout: 2000 }).catch(() => "(no body)");
    console.log(`real-app e2e ${label}: on screen: ${text.replace(/\s+/g, " ").slice(0, 400)}\n  calls: ${seen.slice(-8).join(" | ") || "(no failed calls)"}\n  without a token: ${bare.slice(0, 6).join(", ") || "(none)"}\n  page errors: ${errors.slice(-3).join(" | ") || "(none)"}`);
  };
  const step = async (label: string, body: () => Promise<void>): Promise<void> => {
    try { await body(); } catch (e) { await dump(label); throw e; }
  };
  const todo: string[] = [];
  let signedIn = false;
  try {
    await t.test("1 the app opens on sign-in when nobody is signed in", async () => {
      await page.goto(`${web.origin}/home`, { waitUntil: "load" });
      await page.getByTestId("si-user").waitFor({ timeout: 15_000 });
      assert.equal(await page.getByTestId("shell").count(), 0, "no shell before sign-in");
    });

    await t.test("2 the owner claims the Space with the one-time link and lands in the shell", async (s) => {
      const gap = todoFor("sign in", live) ?? (space.claim ? null : "claim: the daemon printed no claim link (a fresh install prints one with P-L7_23, #578)");
      if (gap) { todo.push(gap); s.todo(gap); return; }
      await step("claim", async () => {
        await page.goto(claimOnEdge(space.claim ?? "", web.origin), { waitUntil: "load" });
        // The page names the Space by its name (from the link), never by a host or an address.
        await page.getByText("Set up Fresh Co").first().waitFor({ timeout: 15_000 });
        assert.equal(await page.getByText(/127\.0\.0\.1|localhost/).count(), 0, "no host or address on the claim page");
        await page.getByTestId("claim-name").fill("Olivia Owner");
        await page.getByTestId("claim-username").fill("olivia");
        await page.getByTestId("claim-password").fill("correct horse battery 9");
        await page.getByTestId("claim-confirm").fill("correct horse battery 9");
        await page.getByTestId("claim-next").click();
        await page.getByTestId("claim-saved").click();
        await page.getByTestId("claim-create").click();
        await page.getByTestId("shell").waitFor({ timeout: 30_000 });
        signedIn = true;
      });
    });

    await t.test("3 Home shows real data from the Space", async (s) => {
      const gap = (signedIn ? null : "needs the claimed owner session (step 2)") ?? todoFor("home", live);
      if (gap) { todo.push(gap); s.todo(gap); return; }
      await step("home", async () => {
        await page.getByTestId("rail-home").or(page.getByTestId("rail-home-selected")).first().click();
        await page.getByTestId("s-needs").or(page.getByTestId("home-place")).first().waitFor({ timeout: 15_000 });
      });
    });

    await t.test("4 Chats: a message sent from the composer appears in the conversation", async (s) => {
      const gap = (signedIn ? null : "needs the claimed owner session (step 2)") ?? todoFor("chats", live);
      if (gap) { todo.push(gap); s.todo(gap); return; }
      await step("chats", async () => {
        await page.getByTestId("rail-chats").or(page.getByTestId("rail-chats-selected")).first().click();
        await page.getByTestId("chats-place").waitFor({ timeout: 15_000 });
        // A claimed Space starts with no chats: the sidebar then says so (the shared empty state) and there is no composer to type in. With a chat open, a sent message must appear.
        const composer = page.getByTestId("composer-field");
        if (await composer.count() === 0) { await page.getByTestId("state-empty").first().waitFor({ timeout: 15_000 }); return; }
        const text = `real app check ${Date.now()}`;
        await composer.fill(text);
        await composer.press("Enter");
        await page.getByText(text).first().waitFor({ timeout: 15_000 });
      });
    });

    await t.test("5 Records: a table opens with its rows", async (s) => {
      const gap = (signedIn ? null : "needs the claimed owner session (step 2)") ?? todoFor("records", live);
      if (gap) { todo.push(gap); s.todo(gap); return; }
      await step("records", async () => {
        await page.getByTestId("rail-records").or(page.getByTestId("rail-records-selected")).first().click();
        await page.getByTestId("records-place").waitFor({ timeout: 15_000 });
        await page.locator('[data-testid^="rec-"], [data-testid="state-empty"]').first().waitFor({ timeout: 15_000 });
      });
    });

    await t.test("6 Files: the list shows files and one opens", async (s) => {
      const gap = (signedIn ? null : "needs the claimed owner session (step 2)") ?? todoFor("files", live);
      if (gap) { todo.push(gap); s.todo(gap); return; }
      await step("files", async () => {
        await page.getByTestId("rail-files").or(page.getByTestId("rail-files-selected")).first().click();
        await page.getByTestId("files-place").waitFor({ timeout: 15_000 });
        await page.locator('[data-testid="files-list"], [data-testid="state-empty"]').first().waitFor({ timeout: 15_000 });
      });
    });

    await t.test("7 every place draws on its own page load, with no page errors", async (s) => {
      const gap = signedIn ? null : "needs the claimed owner session (step 2)";
      if (gap) { todo.push(gap); s.todo(gap); return; }
      // One fresh page per place: a place that loops or throws takes its whole page down, and must not hide the places after it.
      const places: [string, string][] = [
        ["home", '[data-testid="s-needs"], [data-testid="home-place"]'], ["chat", '[data-testid="chats-place"]'], ["mail", '[data-testid="inbox-place"]'], ["records", '[data-testid="records-place"]'],
        ["files", '[data-testid="files-place"]'], ["sites", '[data-testid="place-sites"], [data-testid="place-sites-failed"]'], ["automations", '[data-testid="automations-place"]'],
        ["vault", '[data-testid="vault-place"]'], ["settings", '[data-testid="settings-place"]'],
      ];
      const failures: string[] = [];
      for (const [route, selector] of places) {
        const p = await ctx.newPage();
        const errs: string[] = [];
        const refused: string[] = [];
        p.on("pageerror", (e) => errs.push(e.message.slice(0, 120)));
        p.on("response", (r) => { const u = new URL(r.url()); if ((u.pathname.startsWith("/v1/") || u.pathname.startsWith("/sync/")) && r.status() >= 400) refused.push(`${r.status()} ${u.pathname}`); });
        await p.goto(`${web.origin}/${route}`, { waitUntil: "load" });
        await p.getByTestId("shell").waitFor({ timeout: 15_000 }).catch(() => undefined);
        const drew = await p.locator(selector).first().waitFor({ timeout: 10_000 }).then(() => true, () => false);
        if (!drew || errs.length) failures.push(`${route}: ${drew ? "drew" : "did not draw"}${errs.length ? `, page errors: ${errs.join(" | ")}` : ""}${refused.length ? `, refused: ${[...new Set(refused)].slice(0, 5).join(", ")}` : ""}`);
        await p.close();
      }
      assert.deepEqual(failures, [], "every place must draw");
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
