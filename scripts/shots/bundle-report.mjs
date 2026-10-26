#!/usr/bin/env node
// Largest modules per JS chunk of the production web export, from its source maps (export with --source-maps), entry chunks first.
//   node scripts/shots/bundle-report.mjs [--dist apps/app/dist] [--top 25]
// Sizes are the unminified source length of each module (relative weight, not bytes shipped); the chunk's own size is its shipped bytes.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "./lib.mjs";

const walk = (d, re, out = []) => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p, re, out);
    else if (re.test(e.name)) out.push(p);
  }
  return out;
};

/** [{ src, bytes }] for every module of one map, merging the sections of an indexed (Metro) map. */
export function modulesOf(mapFile) {
  const top = JSON.parse(fs.readFileSync(mapFile, "utf8"));
  const maps = top.sections ? top.sections.map((s) => s.map) : [top];
  const mods = [];
  for (const m of maps) (m.sources || []).forEach((src, i) => mods.push({ src, bytes: m.sourcesContent?.[i]?.length ?? 0 }));
  return mods;
}

export function bundleReport(dist, top = 25) {
  const html = fs.readFileSync(path.join(dist, "index.html"), "utf8");
  const entry = new Set([...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map((m) => m[1].replace(/^\//, "")));
  const files = walk(dist, /\.js$/).map((p) => ({ rel: path.relative(dist, p), abs: p, raw: fs.statSync(p).size }));
  files.sort((a, b) => (entry.has(b.rel) - entry.has(a.rel)) || b.raw - a.raw);
  const lines = [];
  for (const f of files.slice(0, 6)) {
    const mapFile = `${f.abs}.map`;
    lines.push(`\n${entry.has(f.rel) ? "ENTRY" : "chunk"} ${f.rel}  ${(f.raw / 1024).toFixed(0)} KB shipped`);
    if (!fs.existsSync(mapFile)) { lines.push("  no source map (export with --source-maps)"); continue; }
    const mods = modulesOf(mapFile).sort((a, b) => b.bytes - a.bytes);
    const total = mods.reduce((s, m) => s + m.bytes, 0) || 1;
    for (const m of mods.slice(0, top)) lines.push(`  ${String(Math.round(m.bytes / 1024)).padStart(6)} KB  ${((100 * m.bytes) / total).toFixed(1).padStart(5)}%  ${m.src.replace(/^(\.\.\/)+/, "")}`);
  }
  return lines.join("\n");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = parseArgs(process.argv.slice(2));
  const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
  console.log(bundleReport(path.resolve(REPO, args.dist || "apps/app/dist"), Number(args.top || 25)));
}
