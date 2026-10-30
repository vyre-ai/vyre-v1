#!/usr/bin/env node
// The no-dead-buttons gate. Boots the real app (the production web export on a booted daemon, the shots harness), serves it under the desktop app's real CSP, visits every place and every state a click opens,
// clicks every interactive element from a fresh state and fails when a click changes nothing a person could see within 1.5 s. Run it on WebKit (the Mac app's engine) and on Chromium.
//   node scripts/click/dead-buttons.mjs --dist apps/app/dist [--browser webkit|chromium] [--csp tauri|none] [--spaces personal,team] [--out shots-out/dead-buttons] [--workers 4]
//        [--max-screens 40] [--places home,chat,...] [--update-baseline] [--no-gate]
// Exit 1 when a DEAD element is not in scripts/click/dead-baseline.json (empty by decision: there is no allowlist). Elements that are meant to do nothing carry data-noop-ok="<reason>".
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "../shots/lib.mjs";
import { bootFreshSpace, claimOnEdge, edge } from "../../apps/app/tests/real-app-harness.test.ts";
import { createCapCaller } from "../../client/src/gateway/index.ts";
import { routes } from "../../generated/routes.ts";
import * as P from "./page-side.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url)), REPO = path.resolve(HERE, "../..");
export const BASELINE = path.join(HERE, "dead-baseline.json");
const WINDOW_MS = 1500;
const CLOSERS = /^(cancel|close|dismiss|done|ok|got it|not now|later|no thanks|back|x|skip|maybe later|never mind|hide)$/i;
const RISKY = /sign out|log out|logout|delete space|wipe|erase everything|reset (everything|space)|leave (space|team)|close account|delete account/i;
const READ_CALL = /\/(list|list_by_contact|get|recent|learned|search|read|query|counts?|nav|me|options|status|tree|preview|sign_in_options)(\/|$|_)|\/(list|get|recent|learned)[a-z_]*$/;
const CHROME = /^(title-|rail-|tab-|space-tile|tab-strip)/;
const PLACES = ["home", "chat", "mail", "records", "files", "sites", "automations", "vault", "settings", "console"];

/** The CSP the Mac app ships (tauri.conf.json app.security.csp) as the webview applies it: Tauri adds a nonce to script-src and style-src, and a nonce makes the browser ignore 'unsafe-inline'. */
export function tauriCsp(nonce) {
  const conf = JSON.parse(fs.readFileSync(path.join(REPO, "apps/desktop/src-tauri/tauri.conf.json"), "utf8"));
  const csp = conf.app.security.csp;
  return csp.split(";").map((d) => d.trim()).filter(Boolean).map((d) => {
    const [name, ...vals] = d.split(/\s+/);
    if (name === "style-src" || name === "script-src") return `${name} ${vals.filter((v) => v !== "'unsafe-inline'").join(" ")} 'nonce-${nonce}'`;
    return d;
  }).join("; ");
}

/** Hash ids collapse to `*`, so one record stands for every record and the crawl visits each kind of screen once. */
export function screenKey(url) {
  const u = new URL(url);
  const h = u.hash.replace(/^#/, "").split("&").filter(Boolean).map((kv) => {
    const [k, v = ""] = kv.split("=");
    const dv = decodeURIComponent(v);
    if (k === "subject") return `${k}=${dv.split(":")[0]}:*`;
    if (/^[a-z]{2,6}_[A-Za-z0-9]{4,}$|^[0-9a-f-]{12,}$|^[0-9]+$/.test(dv)) return `${k}=*`;
    return `${k}=${dv}`;
  }).join("&");
  return `${u.pathname.replace(/\/[a-z]{2,6}_[A-Za-z0-9]{4,}/g, "/*")}${h ? `#${h}` : ""}`;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const slug = (s) => s.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").slice(0, 60).toLowerCase();

async function newWorker(browser, origin, session, nonce, csp, shotDir, spaceName) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, reducedMotion: "reduce", storageState: { cookies: [], origins: [{ origin, localStorage: [{ name: "vyre.session.v1", value: session }] }] }, acceptDownloads: true });
  await ctx.addInitScript(P.install);
  // Every load starts from the same state: the app keeps its open tabs, last place and selections in localStorage, and a replay must not inherit what an earlier click left there.
  await ctx.addInitScript(() => { try { for (const k of Object.keys(localStorage)) if (k !== "vyre.session.v1") localStorage.removeItem(k); sessionStorage.clear(); } catch { /* storage blocked */ } });
  if (csp === "tauri") {
    await ctx.route((u) => u.origin === origin && !/\.[a-z0-9]{2,5}$/i.test(u.pathname) && !u.pathname.startsWith("/v1/") && !u.pathname.startsWith("/sync/"), async (route) => {
      if (route.request().resourceType() !== "document") return route.continue();
      const res = await route.fetch();
      let body = await res.text();
      body = body.replace(/<(script|style)(\s|>)/g, `<$1 nonce="${nonce}"$2`);
      await route.fulfill({ response: res, body, headers: { ...res.headers(), "content-security-policy": tauriCsp(nonce) } });
    });
  }
  const w = { ctx, page: await ctx.newPage(), net: [], logs: [], events: [], origin, shotDir, spaceName };
  const pg = w.page;
  pg.setDefaultTimeout(10000);
  pg.on("response", (r) => { const u = new URL(r.url()); if (u.pathname.startsWith("/v1/") || u.pathname.startsWith("/sync/")) { const e = { m: r.request().method(), p: u.pathname, s: r.status(), t: Date.now(), body: "" }; w.net.push(e); if (e.s >= 400) void r.text().then((b) => { e.body = b.slice(0, 160); }).catch(() => undefined); } });
  pg.on("console", (m) => { if (m.type() === "error") w.logs.push({ t: Date.now(), text: m.text().slice(0, 240) }); });
  pg.on("pageerror", (e) => w.logs.push({ t: Date.now(), text: `pageerror ${e.message.slice(0, 240)}` }));
  pg.on("dialog", (d) => { w.events.push({ t: Date.now(), k: "native-dialog" }); void d.dismiss().catch(() => undefined); });
  pg.on("filechooser", () => w.events.push({ t: Date.now(), k: "filechooser" }));
  pg.on("download", () => w.events.push({ t: Date.now(), k: "download" }));
  ctx.on("page", (p) => { if (p !== pg) { w.events.push({ t: Date.now(), k: "popup" }); void p.close().catch(() => undefined); } });
  return w;
}

async function settle(w, max = 6000) {
  const pg = w.page;
  await pg.getByTestId("shell").or(pg.getByTestId("mobile-shell")).first().waitFor({ timeout: 20000 }).catch(() => undefined);
  const t0 = Date.now();
  for (;;) {
    const s = await pg.evaluate(P.poll).catch(() => null);
    if (!s || (s.now - s.lastMut > 300) || Date.now() - t0 > max) break;
    await sleep(120);
  }
}

async function load(w, url) {
  await w.page.goto("about:blank").catch(() => undefined);
    await w.page.goto(url, { waitUntil: "load", timeout: 60000 }).catch(() => undefined);
  await settle(w);
}

/** Replays the clicks that got to a state (a menu open, a dialog up) from a fresh load of its screen. Returns false when the path no longer leads there. */
async function replay(w, unit) {
  await load(w, unit.url);
  for (let n = 0; n < unit.steps.length; n++) {
    const st = unit.steps[n];
    const scope = n === 0 ? null : "[data-dbg-added]";
    const els = await w.page.evaluate(P.enumerate, scope);
    const same = els.filter((e) => e.label === st.label && e.sel === st.sel);
    const el = same[st.nth] ?? els.find((e) => e.label === st.label);
    if (!el) return false;
    await w.page.evaluate(P.clearMarks);
    const pt = await w.page.evaluate(P.pointFor, el.i);
    if (!pt || pt.x == null) return false;
    await w.page.evaluate(P.arm, [el.i, null]);
    await w.page.mouse.click(pt.x, pt.y);
    await sleep(350);
    await settle(w, 2500);
    await w.page.evaluate(P.markAdded);
  }
  return true;
}

/** One click, judged. */
async function click(w, el, ovSel, closer) {
  const pg = w.page;
  const pt = await pg.evaluate(P.pointFor, el.i);
  if (pt.gone) return { gone: true };
  if (pt.x == null) return { skipped: pt.kids ? "covered by its own children" : null, dead: !pt.kids, cause: pt.kids ? "" : `covered: a person's pointer lands on ${pt.cover || "another element"}, never on the button` };
  const t0 = Date.now();
  w.net.length = 0; w.logs.length = 0; w.events.length = 0;
  await pg.evaluate(P.arm, [el.i, ovSel]);
  const urlBefore = pg.url();
  await pg.mouse.click(pt.x, pt.y);
  let res = null, fx = new Set();
  const seen = new Set();
  for (;;) {
    res = await pg.evaluate(P.poll).catch(() => null);
    if (!res) { fx.add("url"); break; }   // the page itself went away (a navigation): that is an effect
    for (const f of res.fx) fx.add(f);
    for (const e of w.events) fx.add(e.k);
    const real = [...fx].filter((f) => f !== "ovclose" || closer);
    if (real.length) {
      if (!seen.size) { seen.add(1); await sleep(160); continue; }   // let a menu or dialog finish opening so its items can be read
      break;
    }
    if (Date.now() - t0 > WINDOW_MS) break;
    await sleep(100);
  }
  const url = pg.url();
  const nets = w.net.filter((n) => n.t >= t0);
  const fail = nets.find((n) => n.s >= 400);
  const ok = nets.find((n) => n.m !== "GET" && n.s < 400 && !READ_CALL.test(n.p));   // the app polls reads (chat/recent, connections/list) all the time; only a write the click could have caused counts
  const logs = w.logs.filter((l) => l.t >= t0).map((l) => l.text);
  const ev = res?.ev ?? [];
  const effective = [...fx].filter((f) => !(f === "ovclose" && !closer));
  const alive = effective.length > 0;
  if (alive) {
    const opened = await pg.evaluate(P.markAdded).catch(() => 0);
    return { alive: true, fx: effective, url, navigated: url !== urlBefore, opened };
  }
  if (ok) return { alive: true, quiet: true, fx: ["call"], url, navigated: false, opened: 0, note: `${ok.m} ${ok.p} ${ok.s} with nothing visible changing` };
  const cause = fail ? `silent failure: ${fail.s} ${fail.m} ${fail.p} ${fail.body}`
    : logs.length ? `console error: ${logs[0]}`
    : ev.length ? `page event: ${ev[0]}`
    : "nothing happened: no handler, or a handler that changes nothing a person can see";
  return { dead: true, cause, url };
}

async function shotDead(w, el, name) {
  fs.mkdirSync(w.shotDir, { recursive: true });
  const f = path.join(w.shotDir, `${name}.png`);
  await w.page.evaluate(P_outline, el.i).catch(() => undefined);
  await w.page.screenshot({ path: f }).catch(() => undefined);
  return f;
}
const P_outline = (i) => { const e = document.querySelector(`[data-dbg-i="${i}"]`); if (e) { e.style.outline = "3px solid #ff2d55"; e.style.outlineOffset = "2px"; } };

export async function crawl({ browser, space, name, web, csp, workers, maxScreens, maxMinutes, places, out, log }) {
  const nonce = Buffer.from(String(Math.random())).toString("base64").replace(/[^a-z0-9]/gi, "").slice(0, 16);
  const ws = [];
  for (let i = 0; i < workers; i++) ws.push(await newWorker(browser, web.origin, space.session, nonce, csp, path.join(out, "shots", name), name));
  const seedUrls = places.map((p) => `${web.origin}/${p}`);
  const queue = seedUrls.map((url) => ({ url, steps: [], depth: 0, place: new URL(url).pathname.slice(1) }));
  const screens = new Map();   // screenKey -> true
  const perPlace = new Map();
  const dead = [], quiet = [], disabled = [], skipped = [], stats = { clicks: 0, screens: 0, units: 0, noop: 0, cspViolations: 0 };
  const sigCount = new Map();
  const cspSeen = new Set();
  const chromeDone = new Set();
  let active = 0;
  const deadline = Date.now() + maxMinutes * 60000;
  const stateUnits = new Map();
  const pending = [];

  const record = (list, unit, el, extra) => list.push({ space: name, place: unit.place, screen: screenKey(unit.url), path: unit.steps.map((s) => s.label), label: el.label || `(${el.tag}${el.role ? ` role=${el.role}` : ""}${el.testid ? ` ${el.testid}` : ""})`, selector: el.sel, ...extra });

  async function runUnit(w, unit) {
    stats.units++;
    const ok = await replay(w, unit);
    if (!ok) { skipped.push({ space: name, place: unit.place, screen: screenKey(unit.url), path: unit.steps.map((s) => s.label), why: "path no longer reachable" }); return; }
    const scope = unit.steps.length ? "[data-dbg-added]" : null;
    let els = await w.page.evaluate(P.enumerate, scope);
    if (scope && !els.length) return;
    // A dialog: fill what a person would, and see whether the primary action stays disabled.
    if (scope) {
      const f = await w.page.evaluate(P.fillOverlay);
      if (f.filled) { await sleep(350); els = await w.page.evaluate(P.enumerate, scope); }
    }
    for (const e of els) if (e.disabled) record(disabled, unit, e, { note: scope ? "disabled in an open menu or dialog after every field is filled" : "disabled on screen" });
    const cand = [];
    const counts = new Map();
    for (const e of els) {
      if (e.disabled) continue;
      if (e.noop) { stats.noop++; continue; }
      if (/-selected$/.test(e.testid) || e.selected) continue;   // the place or tab already shown: pressing it again may do nothing
      if (!scope && CHROME.test(e.testid)) { const c = e.testid.replace(/-selected$/, ""); if (chromeDone.has(c)) continue; chromeDone.add(c); }
      if (RISKY.test(e.label)) { skipped.push({ space: name, place: unit.place, screen: screenKey(unit.url), path: unit.steps.map((s) => s.label), label: e.label, why: "ends the session or the Space; its confirm is not clicked" }); continue; }
      if (e.href && /^(mailto:|tel:|sms:)/.test(e.href)) continue;
      const sig = `${unit.place}|${scope ? "ov" : "top"}|${e.role}|${e.testid}|${e.sel}`;
      const n = (counts.get(sig) ?? 0) + 1; counts.set(sig, n);
      if (n > 3) continue;
      cand.push(e);
    }
    const cap = scope ? 40 : 90;
    let dirty = false;
    for (const e of cand.slice(0, cap)) {
      if (dirty) {
        const ok2 = await replay(w, unit);
        if (!ok2) break;
        const again = await w.page.evaluate(P.enumerate, scope);
        const match = again.find((x) => x.label === e.label && x.sel === e.sel && x.i !== undefined) ?? null;
        if (!match) continue;
        Object.assign(e, { i: match.i });
        dirty = false;
      }
      const closer = CLOSERS.test(e.label);
      stats.clicks++;
      const r = await click(w, e, scope, closer);
      for (const v of (await w.page.evaluate(() => (window.__dbg ? window.__dbg.ev.filter((s) => s.startsWith("csp ")) : [])).catch(() => []))) if (!cspSeen.has(v)) { cspSeen.add(v); stats.cspViolations++; }
      if (r.gone) { dirty = true; continue; }
      if (r.skipped) continue;
      if (r.dead) {
        const shot = await shotDead(w, e, `${unit.place}-${slug(screenKey(unit.url))}-${slug(e.label || e.sel)}-${stats.clicks}`);
        record(dead, unit, e, { cause: r.cause, shot, rect: e.rect });
        continue;
      }
      if (r.quiet) record(quiet, unit, e, { note: r.note });
      dirty = true;
      if (r.navigated || (r.url && new URL(r.url).origin !== w.origin)) {
        if (new URL(r.url).origin === w.origin) {
          const key = screenKey(r.url);
          const k = new URL(r.url).pathname.split("/")[1] || "home";
          if (!screens.has(key) && (perPlace.get(k) ?? 0) < maxScreens && screens.size < maxScreens * 12) {
            screens.set(key, true); perPlace.set(k, (perPlace.get(k) ?? 0) + 1); stats.screens++;
            pending.push({ url: r.url, steps: [], depth: 0, place: k });
          }
        }
        dirty = true;
      } else if (r.opened && unit.steps.length < 2) {
        const same = await w.page.evaluate(P.enumerate, "[data-dbg-added]");
        if (same.length) {
          const nth = els.filter((x) => x.label === e.label && x.sel === e.sel).findIndex((x) => x.i === e.i);
          pending.push({ url: unit.url, steps: [...unit.steps, { label: e.label, sel: e.sel, nth: Math.max(0, nth) }], depth: unit.depth + 1, place: unit.place });
        }
      }
    }
  }

  const runWorker = async (w) => {
    for (;;) {
      if (Date.now() > deadline) { if (pending.length || queue.length) log(`time budget spent: ${pending.length + queue.length} states not visited`); pending.length = 0; queue.length = 0; }
      const unit = queue.shift() ?? pending.shift();
      if (unit && unit.steps.length) { const n = (stateUnits.get(unit.place) ?? 0) + 1; stateUnits.set(unit.place, n); if (n > 60) continue; }
      if (!unit) { if (active === 0) return; await sleep(200); continue; }
      active++;
      const key = unit.steps.length ? null : screenKey(unit.url);
      if (key) { if (screens.get(key) === "done") { active--; continue; } screens.set(key, "done"); }
      try { await runUnit(w, unit); } catch (e) { log(`unit failed ${screenKey(unit.url)} ${unit.steps.map((s) => s.label).join(">")}: ${String(e).slice(0, 160)}`); skipped.push({ space: name, place: unit.place, screen: screenKey(unit.url), path: unit.steps.map((s) => s.label), why: `crawl error: ${String(e).slice(0, 120)}` }); }
      active--;
      try { fs.writeFileSync(path.join(out, `partial-${name}.json`), JSON.stringify({ dead, quiet, disabled, skipped, stats })); } catch { /* the crawl goes on */ }
      log(`${name} ${unit.place} ${screenKey(unit.url)}${unit.steps.length ? ` > ${unit.steps.map((s) => s.label).join(" > ")}` : ""}: ${stats.clicks} clicks, ${dead.length} dead`);
    }
  };
  for (const u of queue) screens.set(screenKey(u.url), true);
  await Promise.all(ws.map((w) => runWorker(w)));
  for (const w of ws) await w.ctx.close().catch(() => undefined);
  return { dead, quiet, disabled, skipped, stats };
}

/** The baseline key of a dead element: the same element on the same screen is the same entry from run to run. */
export const deadKey = (d) => `${d.space}|${d.place}|${d.screen}|${d.path.join(">")}|${d.label}|${d.selector}`;

const RANK = (d) => (d.path.length ? 2 : /add|new|create|send|save|connect|invite|import|upload|start|run/i.test(d.label) ? 0 : 1);

export function reportMd(all, meta) {
  const lines = [`# Dead buttons (${meta.browser}, csp ${meta.csp})`, "", `${all.dead.length} DEAD, ${all.quiet.length} quiet (a call went out, nothing visible changed), ${all.disabled.length} disabled, ${all.skipped.length} skipped. ${all.stats.clicks} clicks over ${all.stats.units} states.`, ""];
  const by = new Map();
  for (const d of all.dead) by.set(d.place, (by.get(d.place) ?? 0) + 1);
  lines.push(`Per place: ${[...by].map(([k, v]) => `${k} ${v}`).join(", ") || "none"}`, "", "## DEAD", "", "| space | place | screen | label | path | selector | shot | cause |", "|---|---|---|---|---|---|---|---|");
  for (const d of [...all.dead].sort((a, b) => RANK(a) - RANK(b))) lines.push(`| ${d.space} | ${d.place} | ${d.screen} | ${d.label.replace(/\|/g, "/")} | ${d.path.join(" > ")} | ${d.selector.replace(/\|/g, "/")} | ${d.shot ?? ""} | ${d.cause.replace(/\|/g, "/")} |`);
  const cover = new Map();
  for (const d of all.dead) { const m = /lands on (\S+)/.exec(d.cause); const k = m ? m[1] : "not covered"; cover.set(k, (cover.get(k) ?? 0) + 1); }
  lines.push("", "## DEAD by covering element", "", ...[...cover].sort((a, b) => b[1] - a[1]).map(([k, v]) => `- ${k}: ${v}`));
  lines.push("", "## Quiet", "");
  for (const d of all.quiet) lines.push(`- ${d.space} ${d.place} ${d.screen} ${d.path.join(" > ")} "${d.label}": ${d.note}`);
  lines.push("", "## Disabled", "");
  for (const d of all.disabled) lines.push(`- ${d.space} ${d.place} ${d.screen} ${d.path.join(" > ")} "${d.label}": ${d.note}`);
  return `${lines.join("\n")}\n`;
}

/** What a person has after a first day: a project with a file, a chat with a message, an automation. Each is best effort; a refusal is logged and the crawl goes on with what exists. */
async function seed(web, session, log) {
  const token = JSON.parse(session).sessions[web.origin].token;
  const api = createCapCaller({ baseUrl: web.origin, token: () => token, routes: async () => routes });
  const tries = [
    async () => { const p = await api("projects.create", { type: "project", title: "Release plan", idempotencyKey: "dead.p1" }); await api("files.create", { folderId: p.folderId, name: "notes.md", content: { text: "# Notes\nFirst draft." }, idempotencyKey: "dead.f1" }); },
    async () => { const c = await api("chat.start", { kind: "chat", agentIds: [], title: "Welcome chat", first: "Hello from the crawl" }); log(`seeded chat ${c?.thread?.id ?? ""}`); },
    async () => { await api("automations.create", { name: "Weekly summary", idempotencyKey: "dead.a1" }); },
    async () => { await api("records.create", { type: "contact", fields: { name: "Ada Lovelace" }, idempotencyKey: "dead.r1" }); },
  ];
  for (const t of tries) { try { await t(); } catch (e) { log(`seed step refused: ${String(e?.message ?? e).slice(0, 140)}`); } }
}

async function sessionFor(kind, web, space, browser) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  await page.goto(claimOnEdge(space.claim, web.origin), { waitUntil: "load", timeout: 60000 });
  await page.getByTestId("claim-name").fill("Olivia Owner");
  await page.getByTestId("claim-username").fill("olivia");
  await page.getByTestId("claim-password").fill("correct horse battery 9");
  await page.getByTestId("claim-confirm").fill("correct horse battery 9");
  await page.getByTestId("claim-next").click();
  await page.getByTestId("claim-saved").click();
  await page.getByTestId("claim-create").click();
  await page.getByTestId("shell").waitFor({ timeout: 30000 });
  const s = await page.evaluate(() => localStorage.getItem("vyre.session.v1"));
  await ctx.close();
  return s;
}

export async function main(argv) {
  const args = parseArgs(argv);
  const dist = path.resolve(REPO, args.dist || "apps/app/dist");
  const out = path.resolve(REPO, args.out || "shots-out/dead-buttons");
  const engine = args.browser || "webkit", csp = args.csp || "tauri";
  const kinds = (args.spaces || "personal,team").split(",");
  const places = args.places ? String(args.places).split(",") : PLACES;
  const workers = Number(args.workers || 4), maxScreens = Number(args["max-screens"] || 40);
  if (!fs.existsSync(path.join(dist, "index.html"))) { console.error(`no web export at ${dist}; run npx expo export --platform web --output-dir dist in apps/app`); return 2; }
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });
  const pw = await import("playwright-core");
  const launcher = (pw.default ?? pw)[engine];
  const browser = await launcher.launch(engine === "chromium" ? { args: ["--no-sandbox"] } : {});
  const all = { dead: [], quiet: [], disabled: [], skipped: [], stats: { clicks: 0, units: 0, screens: 0, noop: 0, cspViolations: 0 } };
  const t0 = Date.now();
  try {
    for (const kind of kinds) {
      const space = await bootFreshSpace(kind === "team" ? undefined : "personal");
      const web = await edge(dist, space.url);
      try {
        space.session = await sessionFor(kind, web, space, browser);
        await seed(web, space.session, (m) => console.log(m));
        const r = await crawl({ browser, space, name: kind, web, csp, workers, maxScreens, maxMinutes: Number(args["max-minutes"] || 12), places, out, log: (m) => console.log(m) });
        for (const k of ["dead", "quiet", "disabled", "skipped"]) all[k].push(...r[k]);
        for (const k of Object.keys(all.stats)) all.stats[k] += r.stats[k];
      } finally { web.close(); await space.stop(); fs.rmSync(space.dir, { recursive: true, force: true }); }
    }
  } finally { await browser.close(); }
  fs.writeFileSync(path.join(out, "report.md"), reportMd(all, { browser: engine, csp }));
  fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(all, null, 1));
  console.log(`done in ${Math.round((Date.now() - t0) / 1000)} s: ${all.dead.length} dead, ${all.quiet.length} quiet, ${all.disabled.length} disabled, ${all.stats.clicks} clicks, ${all.stats.cspViolations} csp violations; report ${path.join(out, "report.md")}`);
  if (args["update-baseline"]) { fs.writeFileSync(BASELINE, `${JSON.stringify({ note: "Dead buttons known on main. Burn this list down; a new entry fails the gate. Regenerate with --update-baseline only to shrink it.", dead: [...new Set(all.dead.map(deadKey))].sort() }, null, 1)}\n`); console.log(`wrote ${BASELINE}`); return 0; }
  if (args["no-gate"]) return 0;
  const known = new Set(fs.existsSync(BASELINE) ? JSON.parse(fs.readFileSync(BASELINE, "utf8")).dead : []);
  const fresh = all.dead.filter((d) => !known.has(deadKey(d)));
  if (fresh.length) { console.error(`${fresh.length} new dead button(s):\n${fresh.map((d) => `  ${d.space} ${d.place} ${d.screen} ${d.path.join(" > ")} "${d.label}" (${d.cause}) ${d.shot ?? ""}`).join("\n")}`); return 1; }
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) process.exit(await main(process.argv.slice(2)));
