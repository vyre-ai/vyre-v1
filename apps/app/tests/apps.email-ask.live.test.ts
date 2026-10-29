// Ask Vyre in the Campaign email editor, in Chromium against the production export and a fresh claimed daemon. The Ask is a real agent turn (chat, agents, engine, the OpenAI driver, the Vault key);
// only the model vendor is a local stand-in that api.openai.com requests are sent to inside the daemon process. Per-change review, failure and Cancel are driven through the real screen.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { bootFreshSpace, claimOnEdge, edge } from "./real-app-harness.test.ts";
import { vendor } from "../../../host/tests/fixtures/model-vendor.ts";

const PRELOAD = fileURLToPath(new URL("../../../host/tests/fixtures/vendor-preload.mjs", import.meta.url));
const KEY = "sk-test-fixture-0123456789abcdef"; // secret-scan: fake

test("production Apps: Ask Vyre in the campaign email editor proposes per-change diffs, fails in words and cancels", async (t) => {
  const dist = process.env["VYRE_APP_DIST"];
  if (!dist) { if (process.env["VYRE_REQUIRE_CHROME"] === "1") assert.fail("VYRE_APP_DIST required"); t.skip("VYRE_APP_DIST required for production browser evidence"); return; }
  const { chromium } = await import("playwright-core");
  const exe = process.env["CHROME_BIN"] || chromium.executablePath();
  assert.ok(fs.existsSync(exe), `Chromium is required at ${exe}`);
  const v = await vendor();
  const priorOptions = process.env["NODE_OPTIONS"];
  process.env["NODE_OPTIONS"] = `${priorOptions ?? ""} --import ${PRELOAD}`.trim();
  process.env["VYRE_TEST_VENDOR"] = v.base;
  const space = await bootFreshSpace(undefined, true);
  if (priorOptions === undefined) delete process.env["NODE_OPTIONS"]; else process.env["NODE_OPTIONS"] = priorOptions;
  const web = await edge(dist, space.url);
  const browser = await chromium.launch({ executablePath: exe, args: ["--no-sandbox"] });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const shots = process.env["VYRE_EMAIL_ASK_SHOTS"] ?? "/tmp/vyre-email-ask-shots"; fs.mkdirSync(shots, { recursive: true });
  try {
    await page.goto(claimOnEdge(space.claim!, web.origin), { waitUntil: "load" });
    await page.getByTestId("claim-name").fill("Ask Owner"); await page.getByTestId("claim-username").fill("askowner");
    await page.getByTestId("claim-password").fill("fixture password 123"); await page.getByTestId("claim-confirm").fill("fixture password 123");
    await page.getByTestId("claim-next").click(); await page.getByTestId("claim-saved").click(); await page.getByTestId("claim-create").click();
    await page.getByTestId("shell").waitFor({ timeout: 30_000 });
    const token = await page.evaluate(() => JSON.parse(localStorage.getItem("vyre.session.v1")!).sessions[location.origin].token as string);
    const api = async (cap: string, data: unknown): Promise<any> => { // eslint-disable-line @typescript-eslint/no-explicit-any
      const r = await context.request.post(`${web.origin}/v1/${cap.replaceAll(".", "/")}`, { headers: { authorization: `Bearer ${token}` }, data });
      assert.equal(r.status(), 200, `${cap}: ${await r.text()}`); return (await r.json()).data;
    };
    // a model the way a person connects it, and an agent that uses it
    const provider = await api("providers.add", { idempotencyKey: "ask-provider", providerKey: "openai", connection: "api_key", apiKey: KEY, scope: "mine" });
    await api("providers.set_space_use", { idempotencyKey: "ask-spaceuse", providerId: provider.provider.id, allow: true });
    await api("agents.create", { name: "Designer", role: "You edit email designs.", model: "gpt-4o-mini", idempotencyKey: "ask-agent" });

    await page.goto(`${web.origin}/sites`, { waitUntil: "load" });
    await page.getByTestId("apps-head-campaigns").click();
    await page.getByTestId("apps-new-group").click();
    await page.getByRole("menuitem", { name: "New campaign", exact: true }).click();
    await page.getByLabel("Campaign name", { exact: true }).fill("Ask campaign"); await page.getByTestId("apps-save-campaign").click();
    await page.getByTestId("apps-campaign-detail").waitFor({ timeout: 20_000 });
    await page.getByRole("button", { name: "Add step", exact: true }).click();
    await page.getByTestId("menu-item-email").dispatchEvent("click");
    await page.getByTestId("email-builder").waitFor({ timeout: 20_000 });
    await page.getByTestId("em-subject").fill("Welcome aboard");
    await page.waitForTimeout(1500);   // a background refresh of the campaign must not take the editor away or empty the subject just typed
    assert.equal(await page.getByTestId("em-subject").inputValue(), "Welcome aboard", "typing survives a background refresh of the campaign");
    await page.getByTestId("em-pane").getByText("Ask", { exact: true }).first().click();
    await page.getByTestId("em-ask").waitFor();
    const ask = async (text: string): Promise<void> => { await page.getByTestId("composer-field").fill(text); await page.getByTestId("composer-field").press("Enter"); };

    // 1 an Ask is a real agent turn: the agent's proposal arrives as per-change diffs, nothing is applied until Accept
    v.script.push({ text: JSON.stringify({ subject: "Welcome!" }) });
    await ask("Shorten the subject");
    await page.getByTestId("em-asking").waitFor({ timeout: 10_000 }).catch(() => undefined);
    await page.locator('[data-testid^="em-diff-"]').first().waitFor({ timeout: 60_000 });
    assert.match(await page.locator('[data-testid^="em-diff-"]').first().innerText(), /subject: Welcome!/);
    assert.match(v.requests.at(-1)!, /Shorten the subject/, "the model received the instruction");
    assert.equal(await page.getByTestId("em-subject").inputValue(), "Welcome aboard", "an Ask alone changes nothing");
    await page.screenshot({ path: path.join(shots, "ask-proposal.png") });
    // 2 Reject keeps the subject; the change stays listed as Rejected
    await page.locator('[data-testid^="em-reject-"]').first().click();
    await page.locator('[data-testid^="em-rejected-"]').first().waitFor();
    assert.equal(await page.getByTestId("em-subject").inputValue(), "Welcome aboard", "Reject applies nothing");
    // 3 a second proposal is Accepted, and only then does the subject change
    v.script.push({ text: JSON.stringify({ subject: "Hello there" }) });
    await ask("Friendlier");
    await page.locator('[data-testid^="em-accept-"]').first().waitFor({ timeout: 60_000 });
    await page.locator('[data-testid^="em-accept-"]').first().click();
    await page.waitForFunction(() => (document.querySelector('[data-testid="em-subject"]') as HTMLInputElement | null)?.value === "Hello there");
    // 4 a vendor failure is told in words, not a blank pane
    v.script.push({ status: 401 });
    await ask("Rewrite the body");
    await page.getByTestId("em-ask-error").waitFor({ timeout: 60_000 });
    assert.match(await page.getByTestId("em-ask-error").innerText(), /key or sign-in|Settings/i);
    await page.screenshot({ path: path.join(shots, "ask-error.png") });
    // 5 Cancel while the model is still thinking: the pane says so at once and the server stops the turn
    v.script.push({ hold: true });
    const seen = v.requests.length;
    await ask("Rewrite everything");
    await page.getByTestId("em-ask-cancel").waitFor({ timeout: 20_000 });
    while (v.requests.length === seen) await new Promise((r) => setTimeout(r, 50));
    await page.getByTestId("em-ask-cancel").click();
    await page.getByTestId("em-ask-cancel").waitFor({ state: "detached" });
    assert.match(await page.getByTestId("em-ask-error").innerText(), /Cancelled/);
    assert.equal(await page.getByTestId("em-subject").inputValue(), "Hello there", "Cancel changes nothing");
    assert.deepEqual(errors, []);
  } catch (error) {
    await page.screenshot({ path: path.join(shots, "failure.png") }).catch(() => undefined);
    const log = (() => { try { return JSON.stringify(new DatabaseSync(path.join(space.dir, "logs.db"), { readOnly: true }).prepare("SELECT level, place, msg, attrs FROM logs WHERE place IN ('engine','email-builder') OR msg LIKE '%turn%' OR msg LIKE '%email ask%' ORDER BY id DESC LIMIT 10").all()); } catch { return "no log"; } })();
    fs.writeFileSync(path.join(shots, "failure.txt"), `${String(error)}\nhost log ${log}\nvendor requests ${v.requests.length}\n${await page.locator("body").innerText().catch(() => "")}`);
    throw error;
  } finally { await context.close(); await browser.close(); web.close(); await space.stop(); fs.rmSync(space.dir, { recursive: true, force: true }); v.close(); }
});
