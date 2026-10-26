// Pure helpers for the screenshot tooling (unit-tested in shots.test.ts).
import fs from "node:fs";
import path from "node:path";

export const SKINS = ["paper", "graphite"];
export const SIZES = { desktop: { width: 1280, height: 800 }, phone: { width: 390, height: 844 } };
export const MAX_EXPORT_S = 120;

/** `--key value` and `--flag` arguments. */
export function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith("--")) continue;
    const k = argv[i].slice(2), n = argv[i + 1];
    if (n === undefined || n.startsWith("--")) out[k] = true; else { out[k] = n; i++; }
  }
  return out;
}

/** The prototype hash for a target and skin: `{skin}` in the template is replaced. */
export function protoHash(template, skin) { return template.replaceAll("{skin}", skin); }

/** The route URL on the served export. The skin travels as ?skin= and the mode follows the skin's base unless given. */
export function routeUrl(origin, route, skin, mode) {
  const u = new URL(route.replace(/^\/?/, "/"), origin);
  u.searchParams.set("skin", skin);
  if (mode) u.searchParams.set("mode", mode);
  return u.href;
}

/** Targets from targets.json and targets/*.json. Later files may not redefine an id. */
export function loadTargets(dir) {
  const files = [path.join(dir, "targets.json")];
  const sub = path.join(dir, "targets");
  if (fs.existsSync(sub)) for (const f of fs.readdirSync(sub).sort()) if (f.endsWith(".json")) files.push(path.join(sub, f));
  const seen = new Map();
  for (const f of files) {
    if (!fs.existsSync(f)) continue;
    const list = JSON.parse(fs.readFileSync(f, "utf8")).targets ?? [];
    for (const t of list) {
      if (!t.id || !t.route || !t.proto) throw new Error(`${f}: target needs id, route and proto`);
      if (seen.has(t.id)) throw new Error(`${f}: duplicate target id ${t.id}`);
      seen.set(t.id, t);
    }
  }
  return [...seen.values()];
}

/** Side-by-side page: real on the left, prototype on the right, one caption each. */
export function sideBySideHtml({ title, real, proto }) {
  const esc = (s) => String(s).replaceAll("&", "&amp;").replaceAll("<", "&lt;");
  return `<!doctype html><meta charset="utf-8"><body style="margin:0;background:#888;font:600 13px system-ui;color:#fff">
<div style="padding:8px 12px">${esc(title)}</div>
<div style="display:flex;gap:12px;padding:0 12px 12px;align-items:flex-start">
<figure style="margin:0"><figcaption style="padding:4px 0">real (Expo web export)</figcaption><img src="${real}" style="display:block"></figure>
<figure style="margin:0"><figcaption style="padding:4px 0">prototype</figcaption><img src="${proto}" style="display:block"></figure>
</div></body>`;
}

/** Wrong frames: those whose value differs from the expected one. */
export function countWrongFrames(frames, expected) { return frames.filter((f) => f !== expected).length; }

/** Reads a budget row from budgets.json. */
export function budgetOf(budgets, name) {
  const b = budgets[name];
  if (!b || typeof b !== "object") throw new Error(`budgets.json has no row ${name}`);
  return b;
}

// Chromium aborts a navigation with net::ERR_NETWORK_CHANGED when the host's interfaces change mid-load (another job on the shared CI host adding a Docker network).
// That is the runner, not the app: retry that one error, at most twice; every other error throws as before.
export async function gotoSafe(page, url, opts) {
  for (let attempt = 0; ; attempt++) {
    try { return await page.goto(url, opts); }
    catch (e) { if (attempt >= 2 || !String(e?.message ?? e).includes("ERR_NETWORK_CHANGED")) throw e; }
  }
}
