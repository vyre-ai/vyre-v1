#!/usr/bin/env node
// Screenshots of the REAL app: the production web export, signed in as the owner of a booted daemon on the seeded Space (not the sample mounts of shots.mjs). Home, Chats, Records and Files,
// paper and graphite, desktop and phone. Nothing is staged: a place whose module is still a stub in host/modules.json shows what the real app shows for it (sign-in failure, a loading
// frame, an empty list), and index.md says so per place, with the packet that makes it live, so a reviewer never mistakes a frame for finished data.
//   node scripts/shots/real-app.mjs --dist apps/app/dist [--out shots-out/real-app] [--skins paper,graphite] [--sizes desktop,phone]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ensureChromium } from "./ensure-deps.mjs";
import { parseArgs, SKINS, SIZES } from "./lib.mjs";
import { bootFreshSpace, claimOnEdge, edge, liveModules, ownerSession, todoFor } from "../../apps/app/tests/real-app-harness.test.ts";

export const PLACES = [
  { id: "home", rail: "rail-home", drew: "[data-testid='s-needs'], [data-testid='home-place']", needs: ["sign in", "home"] },
  { id: "chats", rail: "rail-chats", drew: "[data-testid='chats-place']", needs: ["sign in", "chats"] },
  { id: "records", rail: "rail-records", drew: "[data-testid='records-place']", needs: ["sign in", "records"] },
  { id: "files", rail: "rail-files", drew: "[data-testid='files-place']", needs: ["sign in", "files"] },
  { id: "inbox", rail: "rail-inbox", drew: "[data-testid='inbox-place']", needs: ["sign in", "inbox"] },
  { id: "apps", rail: "rail-apps", drew: "[data-testid='place-sites']", needs: ["sign in", "apps"] },
  { id: "automations", rail: "rail-automations", drew: "[data-testid='automations-place']", needs: ["sign in", "automations"] },
  { id: "vault", rail: "rail-vault", drew: "[data-testid='vault-place']", needs: ["sign in", "vault"] },
  { id: "settings", rail: "rail-settings", drew: "[data-testid='settings-place']", needs: ["sign in", "settings"] },
];

/** The phone has five tabs: Chats, Inbox, Records, Files and You (Home is reached through You). Places without a tab are not shot at phone width. */
export const PHONE_TAB = { home: "you", chats: "chats", inbox: "inbox", records: "records", files: "files" };

/** One index.md row: what was shot, whether the place drew, and which stub modules it is still waiting on. */
export function rowFor({ place, skin, sizeName, vp, file, drew, gaps }) {
  return `| ${place} | ${skin} | ${sizeName} ${vp.width}x${vp.height} | P-APP_03-real-${place}/${file} | ${drew ? "place drew" : "place did not draw"} | ${gaps.length ? gaps.join("; ") : "all modules live"} |`;
}

export function indexMd(rows) {
  return `# The real app, signed in as the owner of the seeded Space\n\nProduction export, booted daemon, owner bootstrap session. A row that says a module is a stub is the real app waiting on that module, not a finished screen.\n\n| place | skin | size | image | result | modules |\n|---|---|---|---|---|---|\n${rows.join("\n")}\n`;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const HERE = path.dirname(fileURLToPath(import.meta.url)), REPO = path.resolve(HERE, "../..");
  const args = parseArgs(process.argv.slice(2));
  const dist = path.resolve(REPO, args.dist || "apps/app/dist");
  const out = path.resolve(REPO, args.out || "shots-out/real-app");
  const skins = (args.skins || SKINS.join(",")).split(",");
  const sizes = (args.sizes || Object.keys(SIZES).join(",")).split(",").map((n) => [n, SIZES[n]]);
  if (!fs.existsSync(path.join(dist, "index.html"))) { console.error(`no web export at ${dist}; run npx expo export --platform web --output-dir dist in apps/app`); process.exit(1); }


  ensureChromium(REPO);
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });
  const live = liveModules();
  const space = await bootFreshSpace();
  const web = await edge(dist, space.url);
  const { chromium } = await import("playwright-core");
  const browser = await chromium.launch({ args: ["--no-sandbox"] });
  const rows = [];
  let session = null;
  try {
    // The owner claim screens (ruling 71) before anything is signed in: the details and the recovery code, per skin and size. Reaching them does not spend the link.
    if (space.claim) {
      for (const skin of skins) for (const [sizeName, vp] of sizes) {
        const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 1, colorScheme: skin === "graphite" ? "dark" : "light", reducedMotion: "reduce" });
        const page = await ctx.newPage();
        const link = claimOnEdge(space.claim, web.origin);
        await page.goto(`${link.replace("#", `?skin=${skin}#`)}`, { waitUntil: "load", timeout: 60000 });
        const dir = path.join(out, "P-APP_03-real-claim");
        fs.mkdirSync(dir, { recursive: true });
        const details = await page.getByTestId("claim-name").waitFor({ timeout: 15000 }).then(() => true, () => false);
        await page.waitForTimeout(500);
        await page.screenshot({ path: path.join(dir, `${skin}-${sizeName}-details.png`) });
        rows.push(rowFor({ place: "claim details", skin, sizeName, vp, file: `${skin}-${sizeName}-details.png`, drew: details, gaps: [] }).replace("P-APP_03-real-claim details", "P-APP_03-real-claim"));
        if (details) {
          await page.getByTestId("claim-name").fill("Olivia Owner");
          await page.getByTestId("claim-username").fill("olivia");
          await page.getByTestId("claim-password").fill("correct horse battery 9");
          await page.getByTestId("claim-confirm").fill("correct horse battery 9");
          await page.getByTestId("claim-next").click();
          const rec = await page.getByTestId("claim-code").waitFor({ timeout: 15000 }).then(() => true, () => false);
          await page.waitForTimeout(500);
          await page.screenshot({ path: path.join(dir, `${skin}-${sizeName}-recovery.png`) });
          rows.push(rowFor({ place: "claim recovery", skin, sizeName, vp, file: `${skin}-${sizeName}-recovery.png`, drew: rec, gaps: [] }).replace("P-APP_03-real-claim recovery", "P-APP_03-real-claim"));
        }
        await ctx.close();
      }
      // Claim for real once, as the owner would, to get the signed-in session the place shots use.
      const ctx = await browser.newContext({ viewport: SIZES.desktop, deviceScaleFactor: 1 });
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
      } catch (e) { console.log(`claim for the place shots failed: ${e instanceof Error ? e.message : String(e)}`); }
      await ctx.close();
    }
    if (!session) console.log("no claimed session: the place shots use the owner bootstrap session, which the Space does not know as a person");
    for (const skin of skins) for (const [sizeName, vp] of sizes) {
      const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 1, colorScheme: skin === "graphite" ? "dark" : "light", reducedMotion: "reduce" });
      const page = await ctx.newPage();
      const errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.goto(`${web.origin}/home?skin=${skin}`, { waitUntil: "load", timeout: 60000 });
      await page.evaluate((v) => localStorage.setItem("vyre.session.v1", v), session ?? JSON.stringify(ownerSession(space, web.origin)));
      await page.goto(`${web.origin}/home?skin=${skin}`, { waitUntil: "load", timeout: 60000 });
      await page.getByTestId("shell").or(page.getByTestId("mobile-shell")).first().waitFor({ timeout: 30000 }).catch(() => {});
      for (const p of PLACES) {
        if (sizeName === "phone" && !PHONE_TAB[p.id]) continue;
        if (sizeName === "phone") {
          await page.getByTestId(`tab-${PHONE_TAB[p.id]}`).click({ timeout: 5000 }).catch(() => {});
        } else {
          await page.getByTestId(p.rail).or(page.getByTestId(`${p.rail}-selected`)).first().click({ timeout: 5000 }).catch(() => {});
        }
        const drew = await page.locator(p.drew).first().waitFor({ timeout: 8000 }).then(() => true, () => false);
        await page.waitForTimeout(800);
        const dir = path.join(out, `P-APP_03-real-${p.id}`);
        fs.mkdirSync(dir, { recursive: true });
        const file = `${skin}-${sizeName}.png`;
        await page.screenshot({ path: path.join(dir, file) });
        const gaps = p.needs.map((s) => todoFor(s, live)).filter(Boolean);
        rows.push(rowFor({ place: p.id, skin, sizeName, vp, file, drew, gaps }));
        console.log(`shot ${p.id} ${skin} ${sizeName} ${drew ? "drew" : "did not draw"}`);
      }
      if (errors.length) console.log(`page errors (${skin} ${sizeName}): ${errors.join(" | ")}`);
      await ctx.close();
    }
  } finally {
    await browser.close();
    web.close();
    await space.stop();
    fs.rmSync(space.dir, { recursive: true, force: true });
  }
  fs.writeFileSync(path.join(out, "index.md"), indexMd(rows));
  console.log(`wrote ${path.join(out, "index.md")}`);

}
