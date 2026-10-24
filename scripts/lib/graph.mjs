// Import graph for the CI selector and the pass cache. Ported from 0.6 scripts/ci-select.mjs (read only there).
// Static and dynamic imports, require, `new URL("./x", import.meta.url)`, quoted repo paths, and `// @reads <path>` fixtures.
import path from "node:path";
import crypto from "node:crypto";

export const CODE = /\.(?:m?js|cjs|tsx?|jsx)$/;
export const TEST = /\.test\.(?:m?js|cjs|tsx?)$/;
const EXTS = [".mjs", ".js", ".cjs", ".ts", ".tsx", ".jsx", ".json"];
const ROOTS = "(?:lib|contracts|manifest|kernel|host|sync|agent|sandbox|modules|client|ui|apps|relay|kits|connectors|testkit|fixtures|golden|perf|scripts|test)";

/** Every path-like specifier a source names. @param {string} src */
export function specifiers(src) {
  const out = new Set();
  const res = [
    /\b(?:import|export)\s[^'"`;]*?\bfrom\s*['"]([^'"]+)['"]/g,
    /\bimport\s*['"]([^'"]+)['"]/g,
    /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\brequire\(\s*['"]([^'"]+)['"]\s*\)/g,
    /new URL\(\s*['"](\.[^'"]+)['"]\s*,\s*import\.meta\.url/g,
    /^\s*\/\/\s*@reads\s+(\S+)/gm,
  ];
  for (const re of res) for (const m of src.matchAll(re)) out.add(m[1]);
  for (const m of src.matchAll(new RegExp(`['"\`](${ROOTS}/[\\w@./-]+\\.(?:m?js|cjs|tsx?|json|sh))['"\`]`, "g"))) out.add("/" + m[1]);
  return [...out];
}

/** The tracked file a specifier from `from` means, or null. */
export function resolve(from, spec, tracked) {
  const base = spec.startsWith("/") ? spec.slice(1) : spec.startsWith(".") ? path.posix.normalize(path.posix.join(path.posix.dirname(from), spec)) : null;
  if (base === null) return null;
  for (const c of [base, ...EXTS.map((e) => base + e), ...EXTS.map((e) => `${base}/index${e}`)]) if (tracked.has(c)) return c;
  return null;
}

/** file -> files it imports. @param {Set<string>} tracked @param {(f: string) => string} read */
export function imports(tracked, read) {
  const fwd = new Map();
  for (const f of tracked) {
    if (!CODE.test(f)) continue;
    let src = "";
    try { src = read(f); } catch { continue; }
    const set = new Set();
    for (const s of specifiers(src)) { const r = resolve(f, s, tracked); if (r && r !== f) set.add(r); }
    fwd.set(f, set);
  }
  return fwd;
}

/** file -> files that import it. */
export function dependents(fwd) {
  const rev = new Map();
  for (const [from, tos] of fwd) for (const to of tos) { if (!rev.has(to)) rev.set(to, new Set()); rev.get(to).add(from); }
  return rev;
}

/** The test files that reach `file` through any chain of imports. */
export function testsReaching(file, rev) {
  const seen = new Set([file]), q = [file];
  while (q.length) for (const d of rev.get(q.shift()) || []) if (!seen.has(d)) { seen.add(d); q.push(d); }
  return [...seen].filter((f) => TEST.test(f));
}

/** Transitive import closure of a file, sorted, including itself. */
export function closure(file, fwd) {
  const seen = new Set([file]), q = [file];
  while (q.length) for (const d of fwd.get(q.shift()) || []) if (!seen.has(d)) { seen.add(d); q.push(d); }
  return [...seen].sort();
}

/** Pass-cache key: sha256 over content hashes of the closure, node version, runner version and env tag. */
export function cacheKey(file, fwd, read, env) {
  const h = crypto.createHash("sha256");
  for (const f of closure(file, fwd)) { let c = ""; try { c = read(f); } catch { /* deleted */ } h.update(f + "\0" + crypto.createHash("sha256").update(c).digest("hex") + "\n"); }
  h.update(`${env.node}\0${env.runner}\0${env.tag}`);
  return h.digest("hex");
}
