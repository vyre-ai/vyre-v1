// A new Space reads "Server healthy" in the Console with nothing set up, and a real failure (an agent computer with no container runtime) turns it to "Server down" with the failing check named.
// Real daemon, production export, Chromium. Shots (desktop and phone, light "paper" and "graphite") go to VYRE_CONSOLE_HEALTH_SHOTS.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { bootFreshSpace, claimOnEdge, edge } from "./real-app-harness.test.ts";
import os from "node:os";
import { DatabaseSync } from "node:sqlite";

const MATRIX = [["paper", "desktop", 1280, 900], ["graphite", "desktop", 1280, 900], ["paper", "phone", 390, 844], ["graphite", "phone", 390, 844]] as const;

test("production Console: a fresh Space is Server healthy, a real failure is Server down", async (t) => {
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
      await view.goto(`${web.origin}/console?skin=${skin}`, { waitUntil: "load" }); await view.getByTestId("console").waitFor({ timeout: 30_000 });
      await view.getByTestId("console-health").waitFor();
      assert.equal(await view.getByTestId("console-health").getAttribute("aria-label"), label, `${name} ${size} ${skin}`);
      await view.getByText("Recent admin activity", { exact: true }).waitFor();
      assert.equal((await view.getByText(/expires soon|is down|is degraded/).count()) > 0, needsYou, `${name} ${size} ${skin}: items under Needs you`);
      await view.waitForTimeout(250);
      await view.screenshot({ path: path.join(shots, `${name}-${size}-${skin === "paper" ? "light" : "graphite"}.png`), animations: "disabled" }); await view.close();
    }
  };
  try {
    await page.goto(claimOnEdge(space.claim!, web.origin), { waitUntil: "load" });
    await page.getByTestId("claim-name").fill("Olivia Owner"); await page.getByTestId("claim-username").fill("olivia");
    await page.getByTestId("claim-password").fill("fixture password 123"); await page.getByTestId("claim-confirm").fill("fixture password 123");
    await page.getByTestId("claim-next").click(); await page.getByTestId("claim-saved").click(); await page.getByTestId("claim-create").click();
    await page.getByTestId("shell").waitFor({ timeout: 30_000 });

    // Every check has run once, as the scheduler does within a minute; a new Space has nothing failing.
    await call("health.run");
    const fresh = (await call("health.status")).data;
    assert.deepEqual((fresh.checks as { key: string; state: string; detail?: string }[]).filter((c) => c.state !== "healthy").map((c) => `${c.key}: ${c.detail ?? c.state}`), [], "a new Space has nothing failing");
    assert.equal(fresh.overall, "healthy");
    assert.deepEqual((await call("console.overview")).data.attention, [], "nothing needs the owner on day one");
    await matrix("overview-fresh", "Server healthy", false);

    // A real failure: an agent computer exists and this host has no container runtime.
    const db = new DatabaseSync(path.join(space.dir, "modules.db"));
    db.exec("PRAGMA busy_timeout = 5000");
    db.prepare("INSERT INTO computers_computers (computer_id, agent_id, state, tabs, tab_limit, idle_sleep_minutes, host, created_at) VALUES ('cmp_shot1', 'agt_shot1', 'asleep', 0, 5, 30, 'server', ?)").run(Date.now());
    db.close();
    await call("health.run");
    const broken = (await call("health.status")).data;
    assert.equal(broken.overall, "down");
    assert.equal((broken.checks as { key: string; state: string }[]).find((c) => c.key === "computers")?.state, "down");
    await matrix("overview-failing", "Server down", true);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); await web.close?.(); await space.stop(); fs.rmSync(bin, { recursive: true, force: true }); }
});
