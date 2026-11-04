#!/usr/bin/env node
// Console > AI > Voice in the REAL app: the production export, a booted daemon, signed in as the owner (an admin). Shows what the page says with no key, what the real module says to a wrong key, and, when
// DEEPGRAM_API_KEY and ELEVENLABS_API_KEY are in the environment (never printed), turns Voice on with Deepgram, adds ElevenLabs, switches to it and presses Check now. Run on the build box from the worktree:
//   (cd apps/app && /root/wt/base/node_modules/.bin/expo export --platform web --output-dir dist)   # once
//   node scripts/shots/voice-real.mjs [--dist apps/app/dist] [--out /root/wt/tmp-l-calendar/voice-real]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "./lib.mjs";
import { bootFreshSpace, claimOnEdge, dismissOnboarding, edge, ownerSession } from "../../apps/app/tests/real-app-harness.test.ts";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const args = parseArgs(process.argv.slice(2));
const dist = path.resolve(REPO, args.dist || "apps/app/dist");
const out = path.resolve(REPO, args.out || "shots-out/voice-real");
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
const keys = { deepgram: process.env.DEEPGRAM_API_KEY?.trim(), elevenlabs: process.env.ELEVENLABS_API_KEY?.trim() };
const space = await bootFreshSpace();
const web = await edge(dist, space.url);
const { chromium } = await import("playwright-core");
const browser = await chromium.launch({ args: ["--no-sandbox"] });
let failed = 0;
// claim the Space as its owner once, the way a person does, to get a session the Space knows as an admin
let session = null;
if (space.claim) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  await page.goto(claimOnEdge(space.claim, web.origin), { waitUntil: "load", timeout: 60000 });
  try {
    await page.getByTestId("claim-name").fill("Olivia Owner");
    await page.getByTestId("claim-username").fill("olivia");
    await page.getByTestId("claim-password").fill("correct horse battery 9");
    await page.getByTestId("claim-confirm").fill("correct horse battery 9");
    await page.getByTestId("claim-next").click();
    await page.getByTestId("claim-saved").click();
    await page.getByTestId("claim-create").click();
    await page.getByTestId("shell").waitFor({ timeout: 30000 });
    session = await page.evaluate(() => localStorage.getItem("vyre.session.v1"));
  } catch (e) { console.log(`claim failed: ${e instanceof Error ? e.message : String(e)}`); }
  await ctx.close();
}
const say = (ok, line) => { console.log(`${ok ? "ok  " : "FAIL"} ${line}`); if (!ok) failed += 1; };
try {
  for (const skin of ["paper", "graphite"]) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, colorScheme: skin === "graphite" ? "dark" : "light", reducedMotion: "reduce" });
    const seed = await ctx.newPage();
    await seed.goto(`${web.origin}/home?skin=${skin}`, { waitUntil: "load", timeout: 60000 });
    await seed.evaluate((v) => localStorage.setItem("vyre.session.v1", v), session ?? JSON.stringify(ownerSession(space, web.origin)));
    await seed.close();
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(`${web.origin}/console?skin=${skin}#screen=console.ai-voice`, { waitUntil: "load", timeout: 60000 });
    await dismissOnboarding(page).catch(() => false);
    const there = await page.getByTestId("console-voice").waitFor({ timeout: 30000 }).then(() => true, () => false);
    if (!there) { console.log("testids: " + JSON.stringify((await page.$$eval("[data-testid]", (n) => n.map((x) => x.getAttribute("data-testid")))).slice(0, 60))); }
    say(there, `${skin}: the Voice page draws for the owner`);
    await page.waitForTimeout(800);
    await page.screenshot({ path: path.join(out, `${skin}-1-not-set-up.png`) });
    if (there) {
      say(/Not set up/.test(await page.getByTestId("console-voice").innerText()), `${skin}: says Not set up with no key`);
      say(await page.getByTestId("voice-key").count() > 0, `${skin}: shows the key form`);
      // a wrong key: the real module and host ask the real provider and say so in plain words, and nothing is stored
      await page.getByTestId("voice-key").fill("not-a-real-key");
      await page.getByTestId("voice-save").click();
      await page.waitForTimeout(4000);
      const body = await page.getByTestId("console-voice").innerText();
      say(/Not set up/.test(body) && !/not-a-real-key/.test(body), `${skin}: a wrong key is refused and not stored`);
      console.log(`     the page says: ${JSON.stringify((await page.getByTestId("voice-note").innerText().catch(() => "")).slice(0, 160))}`);
      await page.screenshot({ path: path.join(out, `${skin}-2-wrong-key.png`) });
      if (skin === "paper" && keys.deepgram) {
        await page.getByTestId("voice-key").fill(keys.deepgram);
        await page.getByTestId("voice-save").click();
        await page.getByTestId("voice-provider").waitFor({ timeout: 30000 }).catch(() => undefined);
        const t = await page.getByTestId("console-voice").innerText();
        say(/On for everyone/.test(t) && /Deepgram \(in use\)/.test(t) && /ElevenLabs \(no key yet\)/.test(t), "Deepgram key accepted: on for everyone, Deepgram in use, ElevenLabs has no key yet");
        await page.screenshot({ path: path.join(out, "paper-3-deepgram-on.png") });
        if (keys.elevenlabs) {
          await page.getByTestId("voice-use-elevenlabs").click();
          await page.getByTestId("voice-key").fill(keys.elevenlabs);
          await page.getByTestId("voice-save").click();
          await page.waitForTimeout(5000);
          const t2 = await page.getByTestId("console-voice").innerText();
          say(/ElevenLabs \(in use\)/.test(t2) && /Deepgram/.test(t2), "ElevenLabs key accepted and picked");
          await page.screenshot({ path: path.join(out, "paper-4-elevenlabs-in-use.png") });
          await page.getByTestId("voice-use-deepgram").click();
          await page.waitForTimeout(2500);
          say(/Deepgram \(in use\)/.test(await page.getByTestId("console-voice").innerText()), "Use Deepgram switches back");
          await page.getByTestId("voice-check").click();
          await page.waitForTimeout(4000);
          say(/checked (just now|0 minute)/.test(await page.getByTestId("console-voice").innerText()) || /Checked/.test(await page.getByTestId("voice-note").innerText().catch(() => "")), "Check now ran");
          await page.screenshot({ path: path.join(out, "paper-5-checked.png") });
        }
      }
    }
    if (errors.length) { console.log(`${skin}: page errors ${errors.join(" | ").slice(0, 300)}`); }
    await ctx.close();
  }
} finally { await browser.close(); web.close(); await space.stop(); }
console.log(failed === 0 ? "all good" : `${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
