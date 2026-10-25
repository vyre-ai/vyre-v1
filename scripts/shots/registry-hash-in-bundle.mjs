#!/usr/bin/env node
// A production web export must carry the daemon's registry hash (EXPO_PUBLIC_VYRE_REGISTRY_HASH), or the live socket's hello says registryHash "".
//   node scripts/shots/registry-hash-in-bundle.mjs <expo-export-dir>   exit 1 when no JS file of the export holds the hash
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { registryHash } from "../lib/registry-hash.mjs";

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out); else if (/\.(?:js|mjs|html)$/.test(e.name)) out.push(p);
  }
  return out;
}

/** The export's JS and HTML files that contain `hash`. */
export function filesWithHash(dir, hash) {
  return walk(dir).filter((f) => fs.readFileSync(f, "utf8").includes(hash));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dir = process.argv[2];
  if (!dir || !fs.existsSync(dir)) { console.error("usage: registry-hash-in-bundle.mjs <expo-export-dir>"); process.exit(2); }
  const hash = registryHash();
  const hits = filesWithHash(dir, hash);
  if (!hits.length) { console.error(`the export in ${dir} does not carry the registry hash ${hash.slice(0, 12)}... (EXPO_PUBLIC_VYRE_REGISTRY_HASH was not set when it was built)`); process.exit(1); }
  console.log(`registry hash ${hash.slice(0, 12)}... is in ${hits.length} file(s) of the export`);
}
