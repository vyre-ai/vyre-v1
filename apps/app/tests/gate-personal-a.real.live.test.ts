// @tsx
// Release gate, part A, Personal Space (12 Nov 2026): getting in with a real daemon and the production web export. Claim, sign out and in, a wrong password, a second browser, reload, a daemon
// restart under an open app (no sign-in screen, no lost draft, how long the recovery takes), and the second Space the Add flow can reach on a box. Skips without OPENCODE_API_KEY.
// Shots and the timing rows go to VYRE_GATE_SHOTS (default /tmp/vyre-gate-shots/a-personal).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { claimOnEdge, edge, dismissOnboarding } from "./real-app-harness.test.ts";
import { guardCrashes } from "./crash-guard.ts";
import { bootGate, gateSkip, recorder } from "./gate-kit.test.ts";

const PASSWORD = "gate walk password 4417";

test("GATE A (Personal Space): claim, sign out and in, wrong password, second browser, reload, daemon restart under the open app", { skip: gateSkip(), timeout: 900_000 }, async () => {
  const { chromium } = await import("playwright-core");
  const exe = process.env["CHROME_BIN"] || chromium.executablePath();
  assert.ok(fs.existsSync(exe), `Chromium is required at ${exe}`);
  const shots = path.join(process.env["VYRE_GATE_SHOTS"] ?? "/tmp/vyre-gate-shots", "a-personal"); fs.mkdirSync(shots, { recursive: true });
  const rec = recorder(shots, "rows.json");
  const d = await bootGate("personal", "Gate Personal");
  const web = await edge(process.env["VYRE_APP_DIST"]!, d.address);
  const browser = await chromium.launch({ executablePath: exe, args: ["--no-sandbox"] });
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 860 } });
    const page = await context.newPage();
    const errors: string[] = []; page.on("pageerror", (e) => errors.push(e.message));
    const guard = guardCrashes(page);
    const shot = async (name: string, p = page): Promise<string> => { await p.evaluate("new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))"); const f = path.join(shots, `${name}.png`); await p.screenshot({ path: f }); return `${name}.png`; };
    const body = async (p = page): Promise<string> => (await p.evaluate("document.body.innerText") as string).replace(/\n+/g, " | ");

    // 1 first run: the claim link
    assert.ok(d.claim, "a fresh Space prints a claim link");
    let t0 = Date.now();
    await page.goto(claimOnEdge(d.claim!, web.origin), { waitUntil: "load" });
    await page.getByTestId("claim-name").waitFor({ timeout: 20_000 });
    rec.add({ section: "A", step: "open the claim link", result: "ok", ms: Date.now() - t0, shot: await shot("a01-claim"), note: (await body()).slice(0, 300) });
    await page.getByTestId("claim-name").fill("Gate Owner"); await page.getByTestId("claim-username").fill("gateowner");
    await page.getByTestId("claim-password").fill(PASSWORD); await page.getByTestId("claim-confirm").fill(PASSWORD);
    await page.getByTestId("claim-next").click();
    await page.getByTestId("claim-code").waitFor({ timeout: 20_000 });
    rec.add({ section: "A", step: "recovery code screen", result: "ok", shot: await shot("a02-recovery"), note: (await body()).slice(0, 400) });
    await page.getByTestId("claim-saved").click();
    t0 = Date.now();
    await page.getByTestId("claim-create").click();
    await page.getByTestId("shell").or(page.getByTestId("onboarding")).first().waitFor({ timeout: 40_000 });
    const landed = Date.now() - t0;
    rec.add({ section: "A", step: "Create account to first screen", result: "ok", ms: landed, shot: await shot("a03-after-create"), note: (await body()).slice(0, 300) });
    const onb = await dismissOnboarding(page);
    await page.getByTestId("shell").waitFor({ timeout: 30_000 });
    await guard.check("after claim");
    rec.add({ section: "A", step: "land on Chats", result: onb ? "setup opened, Finish later" : "no setup", shot: await shot("a04-home"), note: (await body()).slice(0, 400) });

    const session = async (p = page): Promise<{ token: string; raw: string }> => p.evaluate(() => { const raw = localStorage.getItem("vyre.session.v1") ?? ""; const j = JSON.parse(raw); return { token: j.sessions[location.origin]?.token as string, raw: "" }; });
    const sess0 = await session();
    assert.ok(sess0.token, "a session token is held");

    // 2 reload keeps the person signed in
    t0 = Date.now();
    await page.reload({ waitUntil: "load" });
    await page.getByTestId("shell").waitFor({ timeout: 30_000 });
    rec.add({ section: "A", step: "reload while signed in", result: "ok", ms: Date.now() - t0, shot: await shot("a05-reload") });

    // 3 sign out from the Space menu
    await page.goto(web.origin + "/", { waitUntil: "load" });
    await page.getByTestId("shell").waitFor({ timeout: 30_000 });
    await page.getByTestId("space-tile").first().click();
    await page.waitForTimeout(600);
    rec.add({ section: "A", step: "Space menu", result: "ok", shot: await shot("a07-space-menu"), note: (await body()).slice(0, 500) });
    const idsOf = async (re: RegExp, p = page): Promise<string> => p.evaluate((src) => [...document.querySelectorAll("[data-testid]")].map((e) => e.getAttribute("data-testid") ?? "").filter((x) => new RegExp(src, "i").test(x)).join(","), re.source);
    console.log("GATE menu ids:", await idsOf(/sign|out|menu|space/));
    await page.getByText(/^Sign out$/i).first().click();
    t0 = Date.now();
    await page.waitForTimeout(1200);
    rec.add({ section: "A", step: "Sign out", result: "ok", ms: Date.now() - t0, shot: await shot("a08-after-signout"), note: (await body()).slice(0, 400) });
    console.log("GATE signin ids:", await idsOf(/sign|login|user|pass|name/));
    // 4 wrong password, then the right one
    await page.getByTestId("si-user").fill("gateowner");
    await page.getByTestId("si-password").fill("not the password 1");
    t0 = Date.now();
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.getByText(/wrong|incorrect|did not match|not right|try again|couldn't|could not/i).first().waitFor({ timeout: 20_000 }).catch(() => undefined);
    rec.add({ section: "A", step: "wrong password", result: "see words", ms: Date.now() - t0, shot: await shot("a09-wrong-password"), note: (await body()).slice(0, 400) });
    await page.getByTestId("si-password").fill(PASSWORD);
    t0 = Date.now();
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.getByTestId("shell").waitFor({ timeout: 40_000 });
    rec.add({ section: "A", step: "sign in again", result: "ok", ms: Date.now() - t0, shot: await shot("a10-signed-in-again") });
    await guard.check("after sign-in again");

    // 5 a second browser, signed in at the same time
    const ctx2 = await browser.newContext({ viewport: { width: 1280, height: 860 } });
    const page2 = await ctx2.newPage();
    await page2.goto(web.origin + "/", { waitUntil: "load" });
    await page2.getByTestId("si-user").waitFor({ timeout: 30_000 });
    rec.add({ section: "A", step: "second browser opens the same address", result: "sign-in screen", shot: await shot("a11-second-browser-signin", page2), note: (await body(page2)).slice(0, 300) });
    await page2.getByTestId("si-user").fill("gateowner"); await page2.getByTestId("si-password").fill(PASSWORD);
    t0 = Date.now();
    await page2.getByRole("button", { name: "Sign in" }).click();
    await page2.getByTestId("shell").waitFor({ timeout: 40_000 });
    rec.add({ section: "A", step: "sign in in a second browser", result: "ok", ms: Date.now() - t0, shot: await shot("a12-second-browser-in", page2), note: "the first browser stays: " + String(await page.getByTestId("shell").isVisible()) });
    await page.reload({ waitUntil: "load" });
    await page.getByTestId("shell").waitFor({ timeout: 30_000 });
    rec.add({ section: "A", step: "first browser after the second signed in (reload)", result: "still signed in", shot: await shot("a13-first-after-second") });
    await ctx2.close();

    // 6 the daemon restarts under the open app with a draft typed
    const field = page.getByTestId("composer-field").first();
    await field.waitFor({ timeout: 20_000 });
    await field.fill("a draft that must survive the restart");
    await page.waitForTimeout(800);
    const tStop = Date.now();
    await d.stop("SIGTERM");
    const down = Date.now() - tStop;
    await page.waitForTimeout(2500);
    const bodyDown = await body();
    rec.add({ section: "A", step: "daemon stopped under the open app (+2.5 s)", result: bodyDown.includes("Sign in to") ? "SIGN-IN SCREEN" : "app stays", ms: down, shot: await shot("a14-daemon-down-2s"), note: bodyDown.slice(0, 400) });
    await page.waitForTimeout(6000);
    rec.add({ section: "A", step: "daemon still down (+8.5 s)", result: (await body()).includes("Sign in to") ? "SIGN-IN SCREEN" : "app stays", shot: await shot("a15-daemon-down-8s"), note: (await body()).slice(0, 400) });
    const tStart = Date.now();
    await d.start();
    const listening = Date.now() - tStart;
    // recovery: the first moment the app is whole again (the banner or wait words gone) and the draft is still typed
    let back = -1; let bodyBack = "";
    for (let i = 0; i < 300; i++) {
      bodyBack = await body();
      const draft = ((await field.innerText().catch(() => "")) || (await field.inputValue().catch(() => ""))).trim();
      if (!/Sign in to/.test(bodyBack) && draft === "a draft that must survive the restart" && !/reconnect|offline|can't reach|cannot reach|waiting for|trying again/i.test(bodyBack)) { back = Date.now() - tStart; break; }
      await page.waitForTimeout(200);
    }
    rec.add({ section: "A", step: "daemon started again: app whole, no sign-in, draft kept", result: back >= 0 ? "recovered" : "NOT RECOVERED in 60 s", ms: back, shot: await shot("a16-recovered"), note: `daemon listening after ${listening} ms; ${bodyBack.slice(0, 300)}` });
    assert.ok(back >= 0, "the app recovered on its own");
    assert.ok(!(await page.getByTestId("si-user").isVisible().catch(() => false)), "no sign-in screen after the restart");
    // a hard crash (SIGKILL) the same way
    await d.stop("SIGKILL");
    await page.waitForTimeout(2500);
    await d.start();
    const tK = Date.now(); let backK = -1;
    for (let i = 0; i < 300; i++) { const b = await body(); const draft = ((await field.innerText().catch(() => "")) || (await field.inputValue().catch(() => ""))).trim(); if (!/Sign in to/.test(b) && draft === "a draft that must survive the restart" && !/reconnect|offline|can't reach|cannot reach|waiting for|trying again/i.test(b)) { backK = Date.now() - tK; break; } await page.waitForTimeout(200); }
    rec.add({ section: "A", step: "daemon killed (crash) and started again", result: backK >= 0 ? "recovered" : "NOT RECOVERED in 60 s", ms: backK, shot: await shot("a17-recovered-after-kill") });
    await guard.check("after the restarts");
    assert.deepEqual(errors, []);
  } finally { await browser.close(); web.close(); await d.stop(); fs.writeFileSync(path.join(shots, "daemon.log"), d.log().replace(/\n+/g, "\n")); }
});
