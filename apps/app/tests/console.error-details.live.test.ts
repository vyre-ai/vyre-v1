// A failed Console action in the real app: one plain sentence in the Note, no error code and no trace id in the visible text, and a quiet Details that shows "Code <code>. Trace <id>" with Copy and Hide details.
// The failing action is real: Console > Teams > New team with a name that already exists. The server answers validation.duplicate with a trace id (modules/access/handlers/roles.ts groupsCreate).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { resolve, sectionOf, tabOf } from "../src/console/shell/sections.ts";
import { bootFreshSpace, claimOnEdge, edge, dismissOnboarding } from "./real-app-harness.test.ts";
import { guardCrashes } from "./crash-guard.ts";

const PASSWORD = "fixture password 123";

test("Console error note: a plain sentence, no code or trace in the text, Details shows both with Copy", async (t) => {
  const dist = process.env["VYRE_APP_DIST"];
  if (!dist) { if (process.env["VYRE_REQUIRE_CHROME"] === "1") assert.fail("VYRE_APP_DIST required"); t.skip("VYRE_APP_DIST required for production browser evidence"); return; }
  const { chromium } = await import("playwright-core");
  const exe = process.env["CHROME_BIN"] || chromium.executablePath();
  assert.ok(fs.existsSync(exe), `Chromium is required at ${exe}`);
  const space = await bootFreshSpace();
  const web = await edge(dist, space.url);
  const browser = await chromium.launch({ executablePath: exe, args: ["--no-sandbox"] });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: web.origin }).catch(() => undefined);
  const page = await context.newPage();
  const guard = guardCrashes(page);
  const named = (where: string) => async (e: unknown): Promise<never> => { await guard.check(where); throw e; };
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const shots = process.env["VYRE_ERROR_DETAILS_SHOTS"] ?? "/tmp/lc-shots/error-details"; fs.mkdirSync(shots, { recursive: true });
  const shoot = async (name: string): Promise<void> => { await guard.check(`before the ${name} shot`); await page.screenshot({ path: path.join(shots, `${name}.png`), animations: "disabled" }); };
  try {
    await page.goto(claimOnEdge(space.claim!, web.origin), { waitUntil: "load" });
    await page.getByTestId("claim-name").fill("Olivia Owner"); await page.getByTestId("claim-username").fill("olivia");
    await page.getByTestId("claim-password").fill(PASSWORD); await page.getByTestId("claim-confirm").fill(PASSWORD);
    await page.getByTestId("claim-next").click(); await page.getByTestId("claim-saved").click(); await page.getByTestId("claim-create").click(); await dismissOnboarding(page);
    await page.getByTestId("shell").waitFor({ timeout: 30_000 }).catch(named("after sign-in"));
    await guard.check("after sign-in");
    const token = await page.evaluate(() => JSON.parse(localStorage.getItem("vyre.session.v1")!).sessions[location.origin].token as string);
    const made = await context.request.post(`${web.origin}/v1/access/groups/create`, { headers: { authorization: `Bearer ${token}` }, data: { name: "Sales", idempotencyKey: "grp-sales" } });
    assert.equal(made.status(), 200, await made.text());

    await page.goto(`${web.origin}/console`, { waitUntil: "load" });
    await page.getByTestId("console").waitFor({ timeout: 30_000 }).catch(named("after opening the Console"));
    await guard.check("after opening the Console");
    const id = resolve("groups"), section = sectionOf(id), tab = tabOf(id);
    assert.ok(section && tab, "groups has a place in the Console");
    await page.getByTestId(`row-nav-${section.id}`).click({ timeout: 60_000 });
    if (section.tabs.length > 1) await page.getByTestId(`tab-${tab.views[0]!.page}`).click();
    if (tab.views[0]!.page !== id) await page.getByTestId(`view-${id}`).click();
    await page.getByTestId(`page-${id}`).waitFor().catch(named("after opening Teams"));
    await page.getByTestId("console-groups").waitFor().catch(named("after opening Teams"));
    await guard.check("after opening Teams");

    await page.getByTestId("group-create-open").click();
    await page.getByTestId("group-name").fill("Sales");
    await page.getByTestId("group-create").click();
    await page.getByTestId("note-details-toggle").waitFor({ timeout: 15_000 }).catch(named("after the failing Create"));
    await guard.check("after the failing Create");

    const body = await page.locator("body").innerText();
    assert.match(body, /a group with that name exists\./i, "the plain sentence is on the page");
    assert.ok(!/validation\./.test(body), "the error code is not in the visible text");
    assert.ok(!/Trace/.test(body), "no trace id in the visible text");
    assert.equal(await page.getByTestId("note-details-text").count(), 0, "details are closed at first");
    assert.equal((await page.getByTestId("note-details-toggle").innerText()).trim(), "Details");
    await shoot("closed");

    await page.getByTestId("note-details-toggle").click();
    await page.getByTestId("note-details-text").waitFor().catch(named("after Details"));
    await guard.check("after Details");
    const line = (await page.getByTestId("note-details-text").innerText()).trim();
    assert.match(line, /Code [a-z_.]+/); assert.match(line, /Code validation\.duplicate/); assert.match(line, /Trace \S+/);
    assert.equal((await page.getByTestId("note-details-toggle").innerText()).trim(), "Hide details");
    await shoot("open");

    await page.getByTestId("note-details-copy").click();
    await guard.check("after Copy");
    const clip = await page.evaluate(() => navigator.clipboard.readText());
    assert.equal(clip.trim(), line, "Copy puts the details line on the clipboard");

    await page.getByTestId("note-details-toggle").click();
    await page.getByTestId("note-details-text").waitFor({ state: "detached" }).catch(named("after Hide details"));
    await guard.check("after Hide details");
    assert.equal((await page.getByTestId("note-details-toggle").innerText()).trim(), "Details");
    assert.ok(!/Trace/.test(await page.locator("body").innerText()), "Hide details removes the trace from the page");
    assert.deepEqual(errors, []);
  } catch (error) {
    await page.screenshot({ path: path.join(shots, "failure.png") }).catch(() => undefined);
    fs.writeFileSync(path.join(shots, "failure.txt"), `${String(error)}\n${await page.locator("body").innerText().catch(() => "")}`);
    throw error;
  } finally { await context.close(); await browser.close(); web.close(); await space.stop(); fs.rmSync(space.dir, { recursive: true, force: true }); }
});
