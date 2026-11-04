#!/usr/bin/env node
// The Space time zone in the REAL app: production export, a booted daemon, the owner (an admin) claimed through the claim link. The walk:
//   1. the admin opens Console, Space, General, picks Los Angeles, reads the one confirm line and saves it (spaces.timezone.set is checked on the server after);
//   2. the same person sets their own zone to Asia/Karachi in Settings, Profile (profile.timezone is checked after);
//   3. a goal is made through the API (started, 9:00 check-ins in the Space zone) and its page is opened: the check-in must read "9:00 AM (10:00 PM your time)", and hover must name both zones;
//   4. the crash guard: any page error or a refused call fails the run.
// Shots in Paper and Graphite at 1440 and 390 wide. Run on the build box from the worktree, after an export of apps/app:
//   (cd apps/app && /root/export-slot.sh /root/wt/<lane>/node_modules/.bin/expo export --platform web --output-dir dist)
//   /root/export-slot.sh node --import tsx scripts/shots/zones-real.mjs [--dist apps/app/dist] [--out shots-out/zones-real]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "./lib.mjs";
import { bootFreshSpace, claimOnEdge, dismissOnboarding, edge, ownerSession } from "../../apps/app/tests/real-app-harness.test.ts";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const args = parseArgs(process.argv.slice(2));
const dist = path.resolve(REPO, args.dist || "apps/app/dist");
const out = path.resolve(REPO, args.out || "shots-out/zones-real");
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
const space = await bootFreshSpace();
const web = await edge(dist, space.url);
const { chromium } = await import("playwright-core");
const browser = await chromium.launch({ args: ["--no-sandbox"] });
let failed = 0;
const say = (ok, line) => { console.log(`${ok ? "ok  " : "FAIL"} ${line}`); if (!ok) failed += 1; };
const SIZES = { wide: { width: 1440, height: 900 }, phone: { width: 390, height: 844 } };
const errors = [], refused = [];

let session = null;
if (space.claim) {
  const ctx = await browser.newContext({ viewport: SIZES.wide, deviceScaleFactor: 1 });
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
const sess = session ?? JSON.stringify(ownerSession(space, web.origin));
const token = space.token;   // the admin token of the booted daemon: the same owner, for the API calls the page does not make

async function api(ctx, cap, data = {}) {
  const r = await ctx.request.post(`${web.origin}/v1/${cap.replaceAll(".", "/")}`, { headers: { authorization: `Bearer ${token}` }, data });
  const text = await r.text();
  let body = null; try { body = JSON.parse(text); } catch { body = text; }
  if (r.status() >= 400) console.log(`     api ${cap} ${r.status()} ${String(text).slice(0, 200)}`);
  return { status: r.status(), body: body?.data ?? body };
}
const open = async (ctx, url) => {
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("response", (r) => { const u = new URL(r.url()); if ((u.pathname.startsWith("/v1/") || u.pathname.startsWith("/sync/")) && r.status() >= 400) refused.push(`${r.status()} ${u.pathname}`); });
  await page.goto(url, { waitUntil: "load", timeout: 60000 });
  await dismissOnboarding(page).catch(() => false);
  return page;
};
const pick = async (page, trigger, city) => {
  await page.getByTestId(trigger).click();
  await page.getByTestId("menu-search").fill(city);
  await page.waitForTimeout(500);
  const items = page.locator("[data-testid^='menu-item-']").filter({ hasText: city });
  console.log(`     ${city}: ${await items.count()} matching rows`);
  await items.first().click();
  await page.waitForTimeout(600);
};

try {
  const ctx = await browser.newContext({ viewport: SIZES.wide, deviceScaleFactor: 1, colorScheme: "light", reducedMotion: "reduce" });
  const seed = await ctx.newPage();
  await seed.goto(`${web.origin}/home?skin=paper`, { waitUntil: "load", timeout: 60000 });
  await seed.evaluate((v) => localStorage.setItem("vyre.session.v1", v), sess);
  await seed.close();

  // 1. the admin sets the Space zone in Console
  const con = await open(ctx, `${web.origin}/console?skin=paper`);
  await con.getByTestId("row-nav-space").click({ timeout: 30000 }).catch(async () => { console.log("testids: " + JSON.stringify((await con.$$eval("[data-testid]", (n) => n.map((x) => x.getAttribute("data-testid")))).slice(0, 50))); });
  say(await con.getByTestId("infra-space-timezone").waitFor({ timeout: 30000 }).then(() => true, () => false), "Console, Space, General has the Space time zone row");
  await pick(con, "infra-space-timezone", "Los Angeles");
  const line = await con.getByTestId("row-space-timezone-confirm").innerText().catch(() => "");
  say(/will read in Pacific Time\. Deadlines already set keep their moment\./.test(line), `the confirm line reads: ${JSON.stringify(line.slice(0, 140))}`);
  await con.screenshot({ path: path.join(out, "paper-wide-1-console-confirm.png") });
  await con.getByTestId("infra-space-timezone-save").click();
  await con.waitForTimeout(1500);
  const got = await api(ctx, "spaces.get");
  say(got.body?.space?.timezone === "America/Los_Angeles", `spaces.get says ${got.body?.space?.timezone}`);
  say(/Space time zone is now Pacific Time\./.test(await con.getByTestId("row-space-timezone-saved").innerText().catch(() => "")), "the saved line with Undo and the audit note shows");
  await con.screenshot({ path: path.join(out, "paper-wide-2-console-saved.png") });
  await con.close();

  // 2. the same person's own zone, in Settings
  const set = await open(ctx, `${web.origin}/settings?skin=paper#screen=settings.page&page=profile`);
  say(await set.getByTestId("ctl-profile.timezone").waitFor({ timeout: 30000 }).then(() => true, () => false), "Settings, Profile has Your time zone");
  await pick(set, "ctl-profile.timezone", "Karachi");
  await set.waitForTimeout(1200);
  const mine = await api(ctx, "settings.get", { key: "profile.timezone" });
  say(mine.body?.row?.value === "Asia/Karachi", `profile.timezone is ${mine.body?.row?.value}`);
  await set.screenshot({ path: path.join(out, "paper-wide-3-settings-zone.png") });
  await set.close();

  // 3. a goal, started, with its check-ins at 9:00 in the Space zone
  const agents = await api(ctx, "agents.list", {});
  const lead = agents.body?.agents?.[0]?.agentId;
  say(Boolean(lead), `an agent to lead the goal: ${lead}`);
  const made = await api(ctx, "goals.create", { title: "300 registrations for Lab 8", finish: { kind: "owner", line: "Lab 8 is full" }, deadline: Date.now() + 3 * 86_400_000, leadAgentId: lead, start: true, idempotencyKey: `zones-${Date.now()}` });
  say(made.status === 200 && made.body?.goal?.id, `goals.create ${made.status} zone ${made.body?.goal?.zone}`);
  say(made.body?.goal?.zone === "America/Los_Angeles", "the goal starts in the Space's zone, not the creator's");
  const goalId = made.body?.goal?.id;
  for (const skin of ["paper", "graphite"]) for (const [size, vp] of Object.entries(SIZES)) {
    const c = await browser.newContext({ viewport: vp, deviceScaleFactor: 1, colorScheme: skin === "graphite" ? "dark" : "light", reducedMotion: "reduce" });
    const seedPage = await c.newPage();
    await seedPage.goto(`${web.origin}/home?skin=${skin}`, { waitUntil: "load", timeout: 60000 });
    await seedPage.evaluate((v) => localStorage.setItem("vyre.session.v1", v), sess);
    await seedPage.close();
    const page = await open(c, `${web.origin}/chat?skin=${skin}#screen=goals.page&goalId=${goalId}`);
    let there = await page.getByTestId("goal-checkin").waitFor({ timeout: 20000 }).then(() => true, () => false);
    if (!there) {   // a phone shows the list first: open the goal from its row
      await page.locator("[data-testid^='goal-row-']").first().click({ timeout: 8000 }).catch(() => undefined);
      there = await page.getByTestId("goal-checkin").waitFor({ timeout: 20000 }).then(() => true, () => false);
    }
    say(there, `${skin} ${size}: the goal page draws its check-in`);
    if (there) {
      const text = (await page.getByTestId("goal-checkin").innerText()).replace(/\s+/g, " ").trim();
      if (skin === "paper" && size === "wide") {
        say(/9:00 AM \(\d{1,2}:\d{2} (AM|PM) your time\)/.test(text), `check-in reads ${JSON.stringify(text)}`);
        say(/\(10:00 PM your time\)/.test(text), "9:00 AM Pacific is 10:00 PM in Karachi (while Pacific is on winter time)");
        const title = await page.locator("[title*='Pacific Time']").first().getAttribute("title").catch(() => null);
        say(Boolean(title) && /Pacific Time/.test(title) && /Your time:/.test(title) && /Pakistan/.test(title), `hover names both zones: ${JSON.stringify(title)}`);
        await page.getByTestId("goal-checkin").hover();
      }
      await page.waitForTimeout(500);
    }
    await page.screenshot({ path: path.join(out, `${skin}-${size}-4-goal.png`) });
    await c.close();
  }
  await ctx.close();
} finally { await browser.close(); web.close(); await space.stop(); }
say(errors.length === 0, `no page errors${errors.length ? `: ${errors.join(" | ").slice(0, 400)}` : ""}`);
say(refused.length === 0, `no refused calls${refused.length ? `: ${[...new Set(refused)].join(", ")}` : ""}`);
console.log(failed === 0 ? "all good" : `${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
