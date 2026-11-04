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

let _ctx0 = null;
const ctx0 = () => _ctx0;
async function apiAs(tok, cap, data = {}) {
  const r = await _ctx0.request.post(`${web.origin}/v1/${cap.replaceAll(".", "/")}`, { headers: { authorization: `Bearer ${tok}` }, data });
  const text = await r.text(); let body = null; try { body = JSON.parse(text); } catch { body = text; }
  if (r.status() >= 400) console.log(`     api ${cap} ${r.status()} ${String(text).slice(0, 200)}`);
  return { status: r.status(), body: body?.data ?? body };
}
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
  _ctx0 = ctx;
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

  // 5. a real second person joins by invite and keeps their own zone (Los Angeles: the Space's own clock, so nothing extra shows for them)
  const roles = await api(ctx0(), "access.roles.list", {});
  const memberRole = roles.body?.roles?.find((r) => r.name === "Member");
  const invite = await api(ctx0(), "members.invites.create", { role: memberRole?.id, idempotencyKey: `zones-invite-${Date.now()}` });
  const link = new URL(invite.body?.link ?? "http://x/");
  say(/^\/join\//.test(link.pathname), `an invite link: ${link.pathname}`);
  const mctx = await browser.newContext({ viewport: SIZES.wide, deviceScaleFactor: 1, colorScheme: "light", reducedMotion: "reduce" });
  const jp = await mctx.newPage();
  jp.on("pageerror", (e) => errors.push(e.message));
  await jp.goto(web.origin + link.pathname + link.hash, { waitUntil: "load", timeout: 60000 });
  await jp.getByTestId("step-accept").waitFor({ timeout: 30000 });
  await jp.getByTestId("web").click();
  await jp.getByTestId("first").fill("Mira"); await jp.getByTestId("last").fill("Lopez"); await jp.getByTestId("next").click();
  await jp.getByTestId("username").fill("mira"); await jp.getByTestId("password").fill("fixture member password123"); await jp.getByTestId("confirm").fill("fixture member password123"); await jp.getByTestId("next").click();
  await jp.getByTestId("device").fill("Mira's laptop"); await jp.getByTestId("next").click();
  await jp.getByTestId("ai-none").click(); await jp.getByTestId("next").click();
  await jp.getByTestId("shell").waitFor({ timeout: 40000 });
  await dismissOnboarding(jp).catch(() => false);
  const msess = await jp.evaluate(() => localStorage.getItem("vyre.session.v1"));
  const mtoken = await jp.evaluate(() => { const all = JSON.parse(localStorage.getItem("vyre.session.v1")); return all.sessions[location.origin].token; });
  await jp.close();
  say(Boolean(msess && mtoken), "Mira joined as a second person");
  const people = await api(ctx0(), "access.principals.list", {});
  const mira = people.body?.principals?.find((p) => p.name === "Mira Lopez")?.id;
  const olivia = people.body?.principals?.find((p) => p.name === "Olivia Owner")?.id;
  say(Boolean(mira && olivia), `Mira ${mira}, Olivia ${olivia}`);
  const asMira = (cap, data) => apiAs(mtoken, cap, data);
  await asMira("settings.set", { key: "profile.timezone", value: "America/Los_Angeles" });

  // 6. a channel with a few messages, a private chat with the assistant, a task with a due date
  const chan = await api(ctx0(), "channels.create", { name: "redwood", visibility: "public", memberIds: [mira], topic: "Redwood Meridian", idempotencyKey: `zones-chan-${Date.now()}` });
  const chanThread = chan.body?.channel?.mainThreadId;
  say(Boolean(chanThread), `channel thread ${chanThread}`);
  await api(ctx0(), "chat.post", { threadId: chanThread, body: "Kickoff is Thursday at 9:00 AM Pacific. Mira, can you send the agenda?", idempotencyKey: `zones-m1-${Date.now()}` });
  await asMira("chat.post", { threadId: chanThread, body: "On it. I will send it tonight.", idempotencyKey: `zones-m2-${Date.now()}` });
  const priv = await api(ctx0(), "chat.start", { kind: "chat", agentIds: [lead], idempotencyKey: `zones-priv-${Date.now()}` });
  const privThread = priv.body?.thread?.threadId;
  if (privThread) await api(ctx0(), "chat.post", { threadId: privThread, body: "Remind me to call Rivera at 9 tomorrow.", idempotencyKey: `zones-p1-${Date.now()}` });
  const task = await api(ctx0(), "tasks.create", { title: "Send the Rivera engagement letter", assigned: { kind: "person", id: olivia }, due: Date.now() + 2 * 86_400_000 + 3 * 3_600_000, idempotencyKey: `zones-task-${Date.now()}` });
  const taskId = task.body?.task?.id ?? task.body?.taskId;
  say(Boolean(privThread), `private chat ${privThread}`);
  say(Boolean(taskId), `task ${taskId} ${task.status}`);

  const open2 = async (c, url) => { const pg = await open(c, url); return pg; };
  const hoverTime = async (page, shot) => { const t = page.locator("[data-testid='time-pop'] > *").first(); if (await t.count()) { await t.hover({ timeout: 4000 }).catch(() => undefined); await page.waitForTimeout(300); } await page.screenshot({ path: shot }); };
  const seeded = async (skin, size, session) => {
    const vp = SIZES[size];
    const c = await browser.newContext({ viewport: vp, deviceScaleFactor: 1, colorScheme: skin === "graphite" ? "dark" : "light", reducedMotion: "reduce" });
    const sp = await c.newPage();
    await sp.goto(`${web.origin}/home?skin=${skin}`, { waitUntil: "load", timeout: 60000 });
    await sp.evaluate((v) => localStorage.setItem("vyre.session.v1", v), session);
    await sp.close();
    return c;
  };
  for (const skin of ["paper", "graphite"]) for (const size of ["wide", "phone"]) {
    const tag = `${skin}-${size}`;
    // Console: the picker open with a search, then the confirm card for another zone
    const c = await seeded(skin, size, sess);
    let pg = await open2(c, `${web.origin}/console?skin=${skin}`);
    if (size === "phone") await pg.waitForTimeout(500);
    await pg.getByTestId("row-nav-space").click({ timeout: 15000 }).catch(() => undefined);
    const ok = await pg.getByTestId("infra-space-timezone").waitFor({ timeout: 20000 }).then(() => true, () => false);
    say(ok, `${tag}: Console has the Space time zone row`);
    if (ok) {
      await pg.getByTestId("infra-space-timezone").click();
      await pg.getByTestId("menu-search").fill("Los");
      await pg.waitForTimeout(400);
      await pg.screenshot({ path: path.join(out, `${tag}-console-picker.png`) });
      await pg.keyboard.press("Escape");
      await pick(pg, "infra-space-timezone", "Tokyo");
      await pg.screenshot({ path: path.join(out, `${tag}-console-confirm.png`) });
      await pg.getByTestId("infra-space-timezone-cancel").click().catch(() => undefined);
    }
    await pg.close();
    // Settings, Profile
    pg = await open2(c, `${web.origin}/settings?skin=${skin}#screen=settings.page&page=profile`);
    await pg.getByTestId("ctl-profile.timezone").waitFor({ timeout: 20000 }).catch(() => undefined);
    await pg.screenshot({ path: path.join(out, `${tag}-settings-profile.png`) });
    say(/Space time zone/.test(await pg.locator("body").innerText()), `${tag}: Settings shows the read-only Space time zone`);
    await pg.close();
    // the channel as Olivia (Karachi): the quiet note, times, hover
    const openThread = async (page, thread) => {
      await page.goto(`${web.origin}/chat?skin=${skin}#screen=chats.conversation&threadId=${thread}`, { waitUntil: "load", timeout: 60000 }).catch(() => undefined);
      await dismissOnboarding(page).catch(() => false);
      const there = await page.getByTestId("conversation-note").or(page.locator("[data-testid^='msg-']").first()).first().waitFor({ timeout: 15000 }).then(() => true, () => false);
      if (!there) await page.locator("[data-testid^='row-ch:']").first().click({ timeout: 5000 }).catch(() => undefined);
      await page.waitForTimeout(800);
    };
    pg = await open2(c, `${web.origin}/chat?skin=${skin}`);
    await openThread(pg, chanThread);
    const note = await pg.getByTestId("zone-note").innerText().catch(() => "");
    say(/Times here use Pacific Time/.test(note) && /Hover a time to see yours/.test(note), `${tag}: the channel note for Olivia: ${JSON.stringify(note)}`);
    await hoverTime(pg, path.join(out, `${tag}-channel-owner-karachi.png`));
    // the private chat: her own zone, no note, no second time
    await openThread(pg, privThread);
    say((await pg.getByTestId("zone-note").count()) === 0, `${tag}: a private chat has no zone note`);
    await pg.screenshot({ path: path.join(out, `${tag}-private-chat.png`) });
    await pg.close();
    // the task chip, on the task page
    pg = await open2(c, `${web.origin}/chat?skin=${skin}#screen=tasks.page&taskId=${taskId}`);
    await pg.getByTestId("rail-due").waitFor({ timeout: 20000 }).catch(() => undefined);
    const chip = pg.getByTestId("rail-due");
    await chip.hover({ timeout: 4000 }).catch(() => undefined);
    await pg.waitForTimeout(300);
    await pg.screenshot({ path: path.join(out, `${tag}-task-chip.png`) });
    await pg.close();
    await c.close();
    // the channel as Mira (Los Angeles = the Space zone): nothing extra
    const mc = await seeded(skin, size, msess);
    const mp = await open2(mc, `${web.origin}/chat?skin=${skin}`);
    await openThread(mp, chanThread);
    const mnote = await mp.getByTestId("zone-note").innerText().catch(() => "");
    say(/Times here use Pacific Time/.test(mnote) && !/see yours/.test(mnote), `${tag}: Mira sees the note with nothing about her time: ${JSON.stringify(mnote)}`);
    await hoverTime(mp, path.join(out, `${tag}-channel-member-la.png`));
    await mp.close();
    await mc.close();
  }
} finally { await browser.close(); web.close(); await space.stop(); }
say(errors.length === 0, `no page errors${errors.length ? `: ${errors.join(" | ").slice(0, 400)}` : ""}`);
say(refused.length === 0, `no refused calls${refused.length ? `: ${[...new Set(refused)].join(", ")}` : ""}`);
console.log(failed === 0 ? "all good" : `${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
