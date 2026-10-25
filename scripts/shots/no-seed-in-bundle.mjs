// The 11 MB prototype-seed.generated.json is test and shots data: it must never reach a production bundle.
//  checkSources(root): no source file under apps/, ui/, host/ or agent/ may name the file or the generator (only tests, scripts/shots and the fixtures' own generated output may)
//  checkBundle(dir):   no file of a production web export (apps/app: npx expo export --platform web) may contain the seed's marker strings
// CLI: node scripts/shots/no-seed-in-bundle.mjs <expo-export-dir>   exit 1 on a hit (the CI step that exports the production app runs it).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Strings only the generated seed carries (Files tree ids and a Harbor-only folder name). */
export const MARKERS = ['"pj-rivera"', '"hb-voss"', "Voss Ceramics", "autumn-range-brief.md"];
const NAMES = ["prototype-seed.generated", "gen-prototype-seed"];

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name === ".git" || e.name === "dist") continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out); else out.push(p);
  }
  return out;
}

/** Source files outside the allowed places that mention the seed. */
export function checkSources(root) {
  const bad = [];
  for (const top of ["apps", "ui", "host", "agent", "client", "kernel"]) {
    const dir = path.join(root, top);
    if (!fs.existsSync(dir)) continue;
    for (const f of walk(dir)) {
      if (!/\.(tsx?|mjs|js|json)$/.test(f) || f.endsWith("prototype-seed.generated.json")) continue;
      const rel = path.relative(root, f);
      if (/\.test\.[tj]sx?$/.test(rel)) continue;
      const src = fs.readFileSync(f, "utf8");
      if (NAMES.some((n) => src.includes(n))) bad.push(rel);
    }
  }
  return bad;
}

/** Files of an export directory that contain the seed. */
export function checkBundle(dir) {
  const bad = [];
  for (const f of walk(dir)) {
    if (!/\.(js|json|html|map|css|txt)$/.test(f)) continue;
    const src = fs.readFileSync(f, "utf8");
    if (MARKERS.filter((m) => src.includes(m)).length >= 2) bad.push(path.relative(dir, f));
  }
  return bad;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url) && process.argv[2]) {
  const bad = checkBundle(process.argv[2]);
  if (bad.length) { console.error(`the prototype seed is in the production export: ${bad.join(", ")}`); process.exit(1); }
  console.log("production export is free of the prototype seed");
}
