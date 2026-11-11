// Pure helpers for the screenshot tooling (unit-tested in shots.test.ts).
import fs from "node:fs";
import path from "node:path";

export const SKINS = ["paper", "graphite"];
// SHOTS_DESKTOP_WIDTH and SHOTS_DESKTOP_HEIGHT look at the desktop size another way (a lane that must be seen at 1440); unset, it is 1280 by 800 as ever.
export const SIZES = { desktop: { width: Number(process.env.SHOTS_DESKTOP_WIDTH) || 1280, height: Number(process.env.SHOTS_DESKTOP_HEIGHT) || 800 }, phone: { width: 390, height: 844 } };
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

function shardCoordinate(index, total) {
  const n = Number(total), i = Number(index);
  if (!Number.isInteger(n) || n < 1) throw new Error(`shard total must be a positive integer, got ${total}`);
  if (!Number.isInteger(i) || i < 0 || i >= n) throw new Error(`shard index must be an integer from 0 to ${n - 1}, got ${index}`);
  return { index: i, total: n };
}

/** Stable modulo partition: every input occurs in exactly one shard and input order is retained. */
export function shardTargets(targets, index, total) {
  const shard = shardCoordinate(index, total);
  return targets.filter((_, position) => position % shard.total === shard.index);
}

/** Each parallel shard writes a unique index so artifact merging cannot overwrite another shard. */
export function shardIndexName(index, total) {
  const shard = shardCoordinate(index, total);
  if (shard.total === 1) return "index.md";
  const width = Math.max(2, String(shard.total - 1).length);
  return `index-shard-${String(shard.index).padStart(width, "0")}-of-${shard.total}.md`;
}

/** Combine complete shard indexes into the canonical artifact index. */
export function mergeShotIndexes(indexes, expectedShards) {
  const expected = Number(expectedShards);
  if (!Number.isInteger(expected) || expected < 1) throw new Error(`expected shard count must be a positive integer, got ${expectedShards}`);
  const names = expected === 1 ? ["index.md"] : Array.from({ length: expected }, (_, index) => shardIndexName(index, expected));
  const actual = indexes.map(({ name }) => name).sort();
  if (JSON.stringify(actual) !== JSON.stringify(names)) throw new Error(`expected shard indexes ${names.join(", ")}; found ${actual.join(", ") || "none"}`);
  const rows = indexes.flatMap(({ text }) => String(text).split("\n").filter((line) => /^\| /.test(line) && !/^\| target /.test(line) && !/^\|---/.test(line))).sort();
  return `# Side-by-side screenshots\n\nMerged from ${expected} shards.\n\n| target | skin | size | file |\n|---|---|---|---|\n${rows.join("\n")}\n`;
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

/**
 * The selector a screenshot waits for before it settles. A target's `waitFor` is a test id of the real app: the prototype never carries it, so a wait there ran its whole 30 s timeout
 * on every prototype shot (4 shots a target, 868 of 943 targets: the 35 minute cap of the `shots` shards). Only the real app is waited on; the prototype settles on its own protoSettleMs.
 */
export function waitSelector(side, target, size = "desktop") {
  return side === "real" ? waitForOf(target, size) : undefined;
}

/**
 * Does a miss of this target's `waitFor` at this size fail the shard? Always at desktop. At phone only when the target names a selector for phone (the object form): a plain selector was written for the
 * desktop layout and is often not on the phone's (a list in place of a table, a bottom bar in place of the rail), and 56 targets still miss that way (SHOTS-BUDGET-2026-11-11.md, Round 3). Those are printed, not failed.
 */
export function waitIsHard(target, size = "desktop") {
  return size === "desktop" || (typeof target.waitFor === "object" && target.waitFor !== null && size in target.waitFor);
}

/** A target's `waitFor` for one size. A string applies to every size; an object names the selector per size ({ desktop, phone }, `any` for the rest), for an element the layout shows on one size only (the phone's bottom rail, its Back button). */
export function waitForOf(target, size = "desktop") {
  const w = target.waitFor;
  return w === undefined || typeof w === "string" ? w : w[size] ?? w.any;
}

/**
 * The steps of a target written as strings (LINKED_01): "click|<testid>", "see|<testid>" (scroll into view) and "fill|<testid>|<text>". They are the clicks a person makes to reach the state the target shows, so the real shot
 * is taken after them; before this the screenshot job stopped at the first frame and the target's `waitFor` (an element of the state the steps reach) never appeared. Steps in other shapes (arrays, objects) belong to their own shooters.
 * Returns what failed, one line each; a step that fails does not stop the rest.
 */
export async function runTestIdSteps(page, steps, settleMs = 350) {
  const errs = [];
  if (!Array.isArray(steps) || !steps.length || !steps.every((s) => typeof s === "string")) return errs;
  for (const step of steps) {
    const [kind, id, ...rest] = step.split("|");
    const loc = page.locator(`[data-testid="${id}"]`).first();
    try {
      if (kind === "click") await loc.click({ timeout: 5000 });
      else if (kind === "see") await loc.scrollIntoViewIfNeeded({ timeout: 5000 });
      else if (kind === "fill") await loc.fill(rest.join("|"), { timeout: 5000 });
      else errs.push(`unknown step ${step}`);
    } catch (e) { errs.push(`${kind} ${id}: ${String(e?.message ?? e).split("\n")[0].slice(0, 100)}`); }
    await page.waitForTimeout(settleMs);
  }
  return errs;
}
