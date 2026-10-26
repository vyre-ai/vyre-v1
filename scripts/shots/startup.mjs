#!/usr/bin/env node
// Startup of the production web export (apps/app: the app entry only, no shots mounts, no samples), measured the way a person feels it: app.start to app.usable.
//   node scripts/shots/startup.mjs [--skip-export] [--route /home] [--runs 3] [--enforce]
// Prints (1) the bundle size of every JS chunk, raw and gzip, sorted, with the total and what the first screen loads, and (2) startup per size (desktop 1x CPU, phone 4x CPU), cold and warm, median of --runs.
// Budgets (V1-SPEC): desktop under 1000 ms, phone under 1500 ms at 4x CPU. --enforce exits 1 over budget. Run on the pinned v1-perf runners (ruling 46).
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { ensureDeps, ensureChromium } from "./ensure-deps.mjs";
import { parseArgs } from "./lib.mjs";
import { serve } from "./serve.mjs";
import { coldProfile } from "./startup-profile.mjs";
import { bundleReport } from "./bundle-report.mjs";
import { exportEnv } from "../lib/registry-hash.mjs";

export const BUDGET_MS = { desktop: 1000, phone: 1500 };
export const CPU = { desktop: 1, phone: 4 };

/** Every .js file under dir with its raw and gzip size in bytes, largest first. */
export function chunkSizes(dist) {
  const out = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.js$/.test(e.name)) { const buf = fs.readFileSync(p); out.push({ file: path.relative(dist, p), raw: buf.length, gzip: zlib.gzipSync(buf).length }); }
    }
  };
  walk(dist);
  return out.sort((a, b) => b.raw - a.raw);
}

/** The scripts index.html loads before anything runs (the entry), by file name. */
export function entryScripts(dist) {
  const html = fs.readFileSync(path.join(dist, "index.html"), "utf8");
  return [...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map((m) => m[1].replace(/^\//, ""));
}

/** Source weight per package of the entry bundle, from its source map (sourcesContent length: the unminified size, so relative weight, not bytes shipped). */
export function weights(dist) {
  const maps = [];
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (/\.js\.map$/.test(e.name)) maps.push(p); } };
  walk(dist);
  const by = new Map();
  for (const m of maps) {
    const top = JSON.parse(fs.readFileSync(m, "utf8"));
    // an indexed map (Metro) keeps its sources in sections
    for (const map of top.sections ? top.sections.map((x) => x.map) : [top]) (map.sources || []).forEach((src, i) => {
      const len = (map.sourcesContent && map.sourcesContent[i] ? map.sourcesContent[i].length : 0);
      const nm = /node_modules\/((?:@[^/]+\/)?[^/]+)/.exec(src);
      const key = nm ? nm[1] : (/^(?:\.\.\/)*(?:[^/]*\/)?((?:apps|ui|client|lib|kernel|host|agent|generated|contracts|manifest)\/[^/]+(?:\/[^/]+)?)/.exec(src)?.[1] ?? "other");
      by.set(key, (by.get(key) || 0) + len);
    });
  }
  return [...by.entries()].sort((a, b) => b[1] - a[1]).map(([name, bytes]) => ({ name, bytes }));
}

export const median = (a) => { const s = a.filter((x) => x !== null).sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : null; };
const kb = (n) => (n / 1024).toFixed(1).padStart(8);

export function report(dist) {
  const chunks = chunkSizes(dist), entry = new Set(entryScripts(dist));
  const total = chunks.reduce((s, c) => s + c.raw, 0), totalGz = chunks.reduce((s, c) => s + c.gzip, 0);
  const lines = ["| chunk | raw KB | gzip KB | loaded first |", "|---|---:|---:|:---:|"];
  for (const c of chunks.slice(0, 40)) lines.push(`| ${c.file} | ${kb(c.raw)} | ${kb(c.gzip)} | ${entry.has(c.file) ? "yes" : ""} |`);
  const first = chunks.filter((c) => entry.has(c.file));
  lines.push(`\n${chunks.length} chunks, ${(total / 1024).toFixed(0)} KB raw, ${(totalGz / 1024).toFixed(0)} KB gzip; the entry loads ${first.length} script(s): ${(first.reduce((s, c) => s + c.raw, 0) / 1024).toFixed(0)} KB raw, ${(first.reduce((s, c) => s + c.gzip, 0) / 1024).toFixed(0)} KB gzip`);
  return { chunks, total, totalGz, entryRaw: first.reduce((s, c) => s + c.raw, 0), entryGz: first.reduce((s, c) => s + c.gzip, 0), text: lines.join("\n") };
}

export async function main(argv) {
  const HERE = path.dirname(fileURLToPath(import.meta.url)), REPO = path.resolve(HERE, "../..");
  const args = parseArgs(argv);
  const appDir = path.join(REPO, "apps/app"), dist = path.join(appDir, "dist");
  await ensureDeps(REPO);
  ensureChromium(REPO);
  if (!args["skip-export"]) {
    fs.rmSync(dist, { recursive: true, force: true });
    execSync("npx expo export --platform web --output-dir dist --source-maps", { cwd: appDir, stdio: "inherit", env: exportEnv() });
  }
  const rep = report(dist);
  console.log(rep.text);
  const w = weights(dist);
  if (w.length) console.log("\n| source weight (unminified) | KB |\n|---|---:|\n" + w.slice(0, 40).map((x) => `| ${x.name} | ${(x.bytes / 1024).toFixed(0)} |`).join("\n"));
  console.log(`METRIC ${JSON.stringify({ name: "bundle_bytes", raw: rep.total, gzip: rep.totalGz, entry_raw: rep.entryRaw, entry_gzip: rep.entryGz, chunks: rep.chunks.length })}`);
  console.log("\nLargest modules per chunk (entry first)" + bundleReport(dist));
  const server = await serve(dist, { spa: true });
  const { chromium } = await import("playwright-core");
  const browser = await chromium.launch({ args: ["--no-sandbox"] });
  const runs = Number(args.runs || 3), rows = [];
  try {
    for (const [size, vp] of [["desktop", { width: 1280, height: 800 }], ["phone", { width: 390, height: 844 }]]) {
      const cold = [], warm = [], sizes = [];
      for (let i = 0; i < runs; i++) {
        const ctx = await browser.newContext({ viewport: vp });
        const page = await ctx.newPage();
        const cdp = await ctx.newCDPSession(page);
        await cdp.send("Emulation.setCPUThrottlingRate", { rate: CPU[size] });
        let bytes = 0;
        page.on("response", async (r) => { try { bytes += (await r.body()).length; } catch { /* a cancelled request has no body */ } });
        for (const kind of ["cold", "warm"]) {
          bytes = 0;
          await page.goto(server.origin + (args.route || "/home"), { waitUntil: "load" });
          await page.waitForFunction(() => performance.getEntriesByName("app.usable").length > 0, null, { timeout: 30000 }).catch(() => {});
          const marks = await page.evaluate(() => performance.getEntriesByType("mark").map((m) => ({ name: m.name, startTime: m.startTime })));
          const a = marks.find((m) => m.name === "app.start"), b = marks.find((m) => m.name === "app.usable");
          (kind === "cold" ? cold : warm).push(a && b ? b.startTime - a.startTime : null);
          if (kind === "cold") { sizes.push(bytes); await page.waitForTimeout(1200); }
        }
        await ctx.close();
      }
      for (const [kind, v] of [["cold", cold], ["warm", warm]]) {
        const ms = median(v);
        rows.push({ size, kind, ms, budget: BUDGET_MS[size], cpu: CPU[size] });
        console.log(`METRIC ${JSON.stringify({ name: "startup_prod", size, kind, cpu_rate: CPU[size], ms, runs: v, budget_ms: BUDGET_MS[size], transferred_bytes: median(sizes) })}`);
      }
    }
  } finally { /* profile below uses the same browser */ }
  try { await coldProfile(browser, server.origin, args.route || "/home"); } catch (e) { console.log(`cold profile failed: ${e.message}`); }
  await browser.close(); server.close();
  console.log("\n| size | cpu | cold ms | warm ms | budget |\n|---|---:|---:|---:|---:|");
  for (const size of ["desktop", "phone"]) console.log(`| ${size} | ${CPU[size]}x | ${rows.find((r) => r.size === size && r.kind === "cold")?.ms?.toFixed(0)} | ${rows.find((r) => r.size === size && r.kind === "warm")?.ms?.toFixed(0)} | ${BUDGET_MS[size]} |`);
  const bad = rows.filter((r) => r.kind === "cold" && (r.ms === null || r.ms > r.budget));
  if (bad.length) { console.error(`startup over budget or marks missing: ${JSON.stringify(bad)}`); if (args.enforce) process.exit(1); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main(process.argv.slice(2));
