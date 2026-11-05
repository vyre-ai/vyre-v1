// A new Space reads "Server healthy" in the Console with nothing set up, and a real failure (an agent computer with no container runtime) turns it to "Server down" with the failing check named.
// Real daemon, production export, Chromium. Shots (desktop and phone, light "paper" and "graphite") go to VYRE_CONSOLE_HEALTH_SHOTS.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { bootFreshSpace, claimOnEdge, edge, dismissOnboarding} from "./real-app-harness.test.ts";
import { guardCrashes } from "./crash-guard.ts";
import os from "node:os";
import { DatabaseSync } from "node:sqlite";

// the Console opens on a computer (owner ruling, 3 Nov 2026): a phone draws no Console page, so Home is read at desktop width, in light and graphite
const MATRIX = [["paper", "desktop", 1280, 900], ["graphite", "desktop", 1280, 900]] as const;

test("production Console: a fresh Space is Server healthy, a real failure is not", async (t) => {
  const dist = process.env["VYRE_APP_DIST"];
  if (!dist) { if (process.env["VYRE_REQUIRE_CHROME"] === "1") assert.fail("VYRE_APP_DIST required"); t.skip("VYRE_APP_DIST required for production browser evidence"); return; }
  const { chromium } = await import("playwright-core");
  const exe = process.env["CHROME_BIN"] || chromium.executablePath();
  assert.ok(fs.existsSync(exe), `Chromium is required at ${exe}`);
  // The disk check reads the machine it runs on (FileVault, or LUKS). So the proof does not depend on the author's laptop or the CI runner, stand in an encrypted volume: tiny fdesetup, findmnt and lsblk
  // that answer "encrypted". Docker is left alone: this proof is about a machine that has none running.
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-health-bin-"));
  for (const [name, body] of [["fdesetup", "echo FileVault is On."], ["findmnt", "echo /dev/mapper/vyre"], ["lsblk", "echo crypt"]] as const) fs.writeFileSync(path.join(bin, name), `#!/bin/sh\n${body}\n`, { mode: 0o755 });
  process.env["PATH"] = `${bin}${path.delimiter}${process.env["PATH"] ?? ""}`;
  const space = await bootFreshSpace();
  const web = await edge(dist, space.url);
  const browser = await chromium.launch({ executablePath: exe, args: ["--no-sandbox"] });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const guard = guardCrashes(page);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const shots = process.env["VYRE_CONSOLE_HEALTH_SHOTS"] ?? "/tmp/vyre-console-health-shots"; fs.mkdirSync(shots, { recursive: true });
  const call = async (cap: string) => {
    const r = await fetch(`${space.url}/v1/${cap.replaceAll(".", "/")}`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${space.token}` }, body: "{}" });
    return (await r.json()) as { data?: any };
  };
  const matrix = async (name: string, label: string, needsYou: boolean): Promise<void> => {
    for (const [skin, size, w, h] of MATRIX) {
      const view = await context.newPage(); await view.setViewportSize({ width: w, height: h });
      const viewGuard = guardCrashes(view);
      await view.goto(`${web.origin}/console?skin=${skin}`, { waitUntil: "load" }); await view.getByTestId("console").waitFor({ timeout: 30_000 });
      // inside the app there is no health dot by the title (owner ruling, 4 Nov 2026): Home's Health row says how the server is
      const word = label.replace(/^Server /, ""); const tile = view.getByTestId("tile-Space server"); await tile.waitFor();
      assert.equal(await tile.getAttribute("aria-label"), `Space server: ${word[0]!.toUpperCase()}${word.slice(1)}`, `${name} ${size} ${skin}`);
      assert.equal(await view.getByTestId("console-health").count(), 0, "no health dot by the title");
      await view.getByText("Recent admin activity", { exact: true }).waitFor();
      assert.equal((await view.getByText(/expires soon|is down|is degraded/).count()) > 0, needsYou, `${name} ${size} ${skin}: items under Needs you`);
      if (!needsYou) await view.getByText(/Olivia Owner added the AI providers/).first().waitFor({ timeout: 15_000 });   // the glance loads after the page
      const text = await view.locator("body").innerText();
      // the glance lists what people changed, never that someone looked (the audit log's own views are left out): the owner's connecting the AI account is the change on the list
      if (!needsYou) assert.match(text, /Olivia Owner added the AI providers/, `${name} ${size} ${skin}`); assert.doesNotMatch(text, /opened the audit log/, `${name} ${size} ${skin}`);
      if (name === "overview-fresh" && skin === "paper" && size === "desktop") assert.match(text, /claimed this Space/, "the claim is still among the last five acts on the first look");
      assert.doesNotMatch(text, /act_anon_|audit viewed/, `${name} ${size} ${skin}: no raw ids or event names`);
      await view.waitForTimeout(250); await viewGuard.check(`${name} ${size} ${skin}`);
      await view.screenshot({ path: path.join(shots, `${name}-${size}-${skin === "paper" ? "light" : "graphite"}.png`), animations: "disabled" }); await view.close();
    }
  };
  try {
    await page.goto(claimOnEdge(space.claim!, web.origin), { waitUntil: "load" });
    await page.getByTestId("claim-name").fill("Olivia Owner"); await page.getByTestId("claim-username").fill("olivia");
    await page.getByTestId("claim-password").fill("fixture password 123"); await page.getByTestId("claim-confirm").fill("fixture password 123");
    await page.getByTestId("claim-next").click(); await page.getByTestId("claim-saved").click(); await page.getByTestId("claim-create").click();await dismissOnboarding(page);
    await page.getByTestId("shell").waitFor({ timeout: 30_000 });
    await guard.check("after claiming the Space");

    // Onboarding connects an AI account before the owner reaches Home (a Team Space with none is a real blocker and says so under Needs you): the walk does the same, as the Space's own AI key.
    const post = async (cap: string, data: unknown) => { const r = await fetch(`${space.url}/v1/${cap.replaceAll(".", "/")}`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${space.token}` }, body: JSON.stringify(data) }); const body = (await r.json()) as { data: any }; assert.equal(r.status, 200, `${cap}: ${JSON.stringify(body)}`); return body.data; };
    await post("providers.add", { idempotencyKey: "fresh-provider", providerKey: "openai", connection: "api_key", apiKey: "sk-test-fixture-0123456789abcdef", scope: "shared" }); // secret-scan: fake: the Space AI key a Team Space needs so its members' chats get replies
    // Every check has run once, as the scheduler does within a minute; a new Space has nothing failing.
    await call("health.run");
    const fresh = (await call("health.status")).data;
    assert.deepEqual((fresh.checks as { key: string; state: string; detail?: string }[]).filter((c) => c.state !== "healthy").map((c) => `${c.key}: ${c.detail ?? c.state}`), [], "a new Space has nothing failing");
    assert.equal(fresh.overall, "healthy");
    assert.deepEqual((await call("console.overview")).data.attention, [], "nothing needs the owner on day one");
    await matrix("overview-fresh", "Server healthy", false); await guard.check("after the fresh Space");

    // A real failure: an agent computer exists and this host has no container runtime.
    const db = new DatabaseSync(path.join(space.dir, "modules.db"));
    db.exec("PRAGMA busy_timeout = 5000");
    db.prepare("INSERT INTO computers_computers (computer_id, agent_id, state, tabs, tab_limit, idle_sleep_minutes, host, created_at) VALUES ('cmp_shot1', 'agt_shot1', 'error', 0, 5, 30, 'server', ?)").run(Date.now());
    db.close();
    await call("health.run");
    const broken = (await call("health.status")).data;
    // Down with no container runtime on this machine, Degraded where one runs: either way a computer in an error state is a real failure and not a healthy Space.
    assert.notEqual(broken.overall, "healthy");
    assert.notEqual((broken.checks as { key: string; state: string }[]).find((c) => c.key === "computers")?.state, "healthy");
    await matrix("overview-failing", `Server ${broken.overall}`, true);
    assert.deepEqual(errors, []); await guard.check("after the failing Space");
  } finally { await browser.close(); await web.close?.(); await space.stop(); fs.rmSync(bin, { recursive: true, force: true }); }
});
