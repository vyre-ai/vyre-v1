#!/usr/bin/env node
// Layer boundaries B1 to B8 (ARCH 2.2).
// Parses every static and dynamic import and checks it against scripts/boundaries.json:
// layer DAG, mayImport, forbidden edges, and B8 exceptions. MPL is not a boundary rule.
// B5 (generated files are never hand-edited) stays with gen --check; this script only publishes the glob.
// Files outside the layer packages (scripts, test, tools, spikes) are absence-checked only.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SOURCE = /\.(?:m?js|cjs|tsx?|jsx)$/;
const MULTI = new Set(['modules', 'apps', 'kits', 'relay', 'connectors']);
const TOPS = new Set(['lib', 'manifest', 'contracts', 'kernel', 'host', 'sync', 'agent', 'sandbox', 'client', 'ui', 'testkit']);

export interface BoundariesFile {
  layers: Record<string, string[]>;
  mayImport: Record<string, string[]>;
  rules?: {
    B2?: { allowNodeSqlite?: string[] };
    B3?: { allowCrypto?: string[]; crypto?: string[] };
    B4?: { noFetchIn?: string[] };
    B5?: { generatedGlob?: string };
    B6?: { allowlist?: string };
    B7?: { extra?: string[] };
  };
  exceptions?: Array<{ id?: string; from: string[]; to: string[]; via?: string }>;
  forbidden?: Array<{ from: string[]; to: string[]; reason?: string }>;
}

export interface AllowlistFile {
  allowedLicenses?: string[];
  deps?: Array<{ name: string; reason?: string; dev?: boolean }>;
}

export interface ImportRef {
  spec: string;
  dynamic: boolean;
  literal: boolean;
}

export interface Violation {
  rule: string;
  file: string;
  message: string;
  spec?: string;
}

export interface LayerEdge {
  from: string;
  to: string;
  fromLayer: number;
  toLayer: number;
  kind: 'down' | 'exception';
}

function violation(rule: string, file: string, message: string, spec?: string): Violation {
  if (spec) return { rule, file, message, spec };
  return { rule, file, message };
}

/** Package id for a repo-relative path, or null when the path is outside the layer tree. */
export function packageOf(file: string): string | null {
  const parts = file.replace(/\\/g, '/').replace(/^\.\//, '').split('/').filter((p) => p.length > 0);
  const head = parts[0];
  if (!head) return null;
  if (MULTI.has(head)) {
    const name = parts[1];
    if (!name || name.includes('*')) return null;
    return `${head}/${name}`;
  }
  if (TOPS.has(head)) return head;
  return null;
}

function matchPkg(pat: string, pkg: string): boolean {
  if (pat === pkg) return true;
  if (pat.endsWith('/*')) {
    const pre = pat.slice(0, -1);
    return pkg.startsWith(pre) && pkg.length > pre.length && !pkg.slice(pre.length).includes('/');
  }
  return false;
}

function matchTarget(pat: string, pkg: string, targetPath: string): boolean {
  if (matchPkg(pat, pkg)) return true;
  if (targetPath === pat || targetPath.startsWith(`${pat}/`)) return true;
  if (pat.endsWith('/*')) return targetPath.startsWith(pat.slice(0, -1));
  return false;
}

function matchDep(pat: string, name: string): boolean {
  if (pat === name) return true;
  if (pat.endsWith('*')) return name.startsWith(pat.slice(0, -1));
  return false;
}

/** Sample package id for a layer or mayImport pattern (`modules/*`, `sync/client`, `host`). */
function patternPkg(pat: string): string {
  if (pat.endsWith('/*')) return `${pat.slice(0, -2)}/_x`;
  const parts = pat.split('/').filter((p) => p.length > 0);
  const head = parts[0] ?? pat;
  if (MULTI.has(head)) {
    const name = parts[1];
    if (!name || name.includes('*')) return `${head}/_x`;
    return `${head}/${name}`;
  }
  return head;
}

/** Layer number from scripts/boundaries.json, or null when the package is not in the DAG. */
export function layerOf(pkg: string, config: BoundariesFile): number | null {
  let best: { n: number; len: number } | null = null;
  for (const [key, pats] of Object.entries(config.layers)) {
    const n = Number(key);
    if (!Number.isInteger(n)) continue;
    for (const pat of pats) {
      if (!matchPkg(pat, pkg)) continue;
      if (!best || pat.length > best.len) best = { n, len: pat.length };
    }
  }
  return best ? best.n : null;
}

/**
 * Downward mayImport edges plus B8 path exceptions.
 * An edge that does not go to a strictly lower layer is recorded as an exception (client -> sync/client, B8).
 * Exceptions with `via` are not edges: they are reached through a handle, not an import.
 */
export function layerDag(config: BoundariesFile): LayerEdge[] {
  const edges: LayerEdge[] = [];
  const push = (from: string, to: string, forceException: boolean) => {
    const fromLayer = layerOf(patternPkg(from), config);
    const toLayer = layerOf(patternPkg(to), config);
    if (fromLayer === null || toLayer === null) return;
    const kind = forceException || toLayer >= fromLayer ? 'exception' : 'down';
    edges.push({ from, to, fromLayer, toLayer, kind });
  };
  for (const [from, tos] of Object.entries(config.mayImport)) {
    for (const to of tos) {
      if (to === 'node:*' || to === 'allowlist') continue;
      push(from, to, false);
    }
  }
  for (const ex of config.exceptions ?? []) {
    if (ex.via) continue;
    for (const from of ex.from) for (const to of ex.to) push(from, to, true);
  }
  return edges;
}

/** Glob from B5. Drift of generated files is gen --check, not an import failure. */
export function generatedGlob(config: BoundariesFile): string {
  return config.rules?.B5?.generatedGlob ?? '**/generated/**';
}

function isAbsentPath(file: string): boolean {
  const n = file.replace(/\\/g, '/');
  return /(^|\/)local\/hands-/.test(n) || /(^|\/)local\/voice(?:\/|$|-)/.test(n) || /(^|\/)voice(?:\/|$)/.test(n);
}

function absentMessage(file: string): string {
  const n = file.replace(/\\/g, '/');
  if (/(^|\/)local\/hands-/.test(n)) return `absent path ${file}: local/hands-* is not part of v1`;
  return `absent path ${file}: voice paths are not part of v1`;
}

/** Paths that v1 must not contain: local/hands-* and voice trees. */
export function absenceViolations(paths: string[]): Violation[] {
  const out: Violation[] = [];
  for (const file of paths) {
    if (!isAbsentPath(file)) continue;
    out.push(violation('absence', file, absentMessage(file)));
  }
  return out;
}

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:\\])\/\/.*$/gm, '$1');
}

/** Static imports, re-exports, require, and dynamic import() of a string literal. A non-literal import() is reported once. */
export function parseImports(src: string): ImportRef[] {
  const text = stripComments(src);
  const out: ImportRef[] = [];
  const seen = new Set<string>();
  const add = (spec: string, dynamic: boolean, literal: boolean) => {
    const key = `${dynamic ? 'd' : 's'}\0${literal ? 'l' : 'u'}\0${spec}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ spec, dynamic, literal });
  };
  for (const m of text.matchAll(/\b(?:import|export)\s+(?:type\s+)?[^'"`;]*?\bfrom\s*['"]([^'"]+)['"]/g)) add(m[1] ?? '', false, true);
  for (const m of text.matchAll(/\bimport\s*['"]([^'"]+)['"]/g)) add(m[1] ?? '', false, true);
  for (const m of text.matchAll(/\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g)) add(m[1] ?? '', false, true);
  for (const m of text.matchAll(/\bimport\s*\(\s*['"`]([^'"`]+)['"`]\s*\)/g)) add(m[1] ?? '', true, true);
  const rest = text.replace(/\bimport\s*\(\s*['"`]([^'"`]+)['"`]\s*\)/g, ' ');
  if (/\bimport\s*\(/.test(rest)) add('', true, false);
  return out;
}

/** Repo-relative path a relative specifier names, or null when it escapes the repo. */
export function resolveRelative(from: string, spec: string): string | null {
  if (!spec.startsWith('.')) return null;
  const stack = from.split('/').slice(0, -1).filter((p) => p.length > 0);
  for (const part of spec.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') {
      if (stack.length === 0) return null;
      stack.pop();
      continue;
    }
    stack.push(part);
  }
  return stack.join('/');
}

function mayImportOf(pkg: string, config: BoundariesFile): string[] {
  const exact = config.mayImport[pkg];
  if (exact) return exact;
  let best: string[] | undefined;
  let bestLen = -1;
  for (const [pat, list] of Object.entries(config.mayImport)) {
    if (matchPkg(pat, pkg) && pat.length > bestLen) {
      best = list;
      bestLen = pat.length;
    }
  }
  return best ?? [];
}

function classifyBare(spec: string): { kind: 'internal'; pkg: string; path: string } | { kind: 'third'; name: string } {
  if (spec.startsWith('@') && !spec.startsWith('@vyre/')) {
    return { kind: 'third', name: spec.split('/').slice(0, 2).join('/') };
  }
  const path = spec.startsWith('@vyre/') ? spec.slice('@vyre/'.length) : spec;
  const probe = path.includes('/') ? path : `${path}/index.ts`;
  const pkg = packageOf(probe);
  if (pkg) return { kind: 'internal', pkg, path };
  const name = spec.split('/')[0] ?? spec;
  return { kind: 'third', name };
}

function isCryptoSpec(spec: string, names: string[]): boolean {
  return names.some((name) => spec === name || spec.startsWith(`${name}/`));
}

function judgeNode(file: string, pkg: string, spec: string, config: BoundariesFile): Violation | null {
  if (spec === 'node:sqlite' || spec.startsWith('node:sqlite/')) {
    const allow = config.rules?.B2?.allowNodeSqlite ?? [];
    if (!allow.some((p) => matchPkg(p, pkg))) {
      return violation('B2', file, `node:sqlite is only allowed in ${allow.join(', ')}`, spec);
    }
  }
  const crypto = config.rules?.B3?.crypto ?? [];
  if (isCryptoSpec(spec, crypto)) {
    const allow = config.rules?.B3?.allowCrypto ?? [];
    if (!allow.some((p) => matchPkg(p, pkg))) {
      return violation('B3', file, `crypto import ${spec} is only allowed in ${allow.join(', ')}`, spec);
    }
  }
  return null;
}

function judgeThird(
  file: string,
  pkg: string,
  spec: string,
  name: string,
  config: BoundariesFile,
  allowlist: AllowlistFile | null,
  isTest: boolean,
): Violation | null {
  const crypto = config.rules?.B3?.crypto ?? [];
  const cryptoHit = isCryptoSpec(spec, crypto) || isCryptoSpec(name, crypto);
  if (cryptoHit) {
    const allow = config.rules?.B3?.allowCrypto ?? [];
    if (!allow.some((p) => matchPkg(p, pkg))) {
      return violation('B3', file, `crypto import ${name} is only allowed in ${allow.join(', ')}`, spec);
    }
  }
  const permitted = mayImportOf(pkg, config);
  const listed = permitted.includes('allowlist') || cryptoHit || permitted.some((p) => matchDep(p, name));
  if (!listed) return violation('B6', file, `${pkg} may not import third-party ${name}`, spec);
  if (!allowlist) return violation('B6', file, `third-party import ${name} but no allowlist was provided`, spec);
  const dep = (allowlist.deps ?? []).find((d) => matchDep(d.name, name));
  if (!dep) return violation('B6', file, `${name} is not in scripts/allowlist.json`, spec);
  if (dep.dev === true && !isTest) return violation('B6', file, `${name} is a dev dependency`, spec);
  return null;
}

function judge(
  file: string,
  pkg: string,
  spec: string,
  config: BoundariesFile,
  allowlist: AllowlistFile | null,
  isTest: boolean,
): Violation | null {
  if (isAbsentPath(spec)) return violation('absence', file, absentMessage(spec), spec);
  if (spec.startsWith('node:')) return judgeNode(file, pkg, spec, config);

  let targetPkg: string;
  let targetPath: string;
  if (spec.startsWith('.')) {
    const resolved = resolveRelative(file, spec);
    if (resolved === null) return violation('layer', file, 'import escapes the repository', spec);
    targetPath = resolved;
    if (isAbsentPath(targetPath)) return violation('absence', file, absentMessage(targetPath), spec);
    const found = packageOf(targetPath);
    if (found === null) return violation('layer', file, `import target ${targetPath} is outside the layer packages`, spec);
    targetPkg = found;
  } else {
    const bare = classifyBare(spec);
    if (bare.kind === 'third') return judgeThird(file, pkg, spec, bare.name, config, allowlist, isTest);
    targetPkg = bare.pkg;
    targetPath = bare.path;
    if (isAbsentPath(targetPath)) return violation('absence', file, absentMessage(targetPath), spec);
  }

  if (targetPkg === pkg) return null;
  if (pkg.startsWith('modules/') && targetPkg.startsWith('modules/')) {
    return violation('B1', file, `${pkg} imports ${targetPkg}; modules are leaf nodes`, spec);
  }
  for (const ban of config.forbidden ?? []) {
    if (!ban.from.some((p) => matchPkg(p, pkg))) continue;
    if (!ban.to.some((p) => matchTarget(p, targetPkg, targetPath))) continue;
    const why = ban.reason ? `: ${ban.reason}` : '';
    return violation('forbidden', file, `${pkg} must not import ${targetPath}${why}`, spec);
  }
  for (const ex of config.exceptions ?? []) {
    if (!ex.from.some((p) => matchPkg(p, pkg))) continue;
    if (!ex.to.some((p) => matchTarget(p, targetPkg, targetPath))) continue;
    if (ex.via) return violation('B8', file, `${pkg} reaches ${targetPath} ${ex.via}`, spec);
    return null;
  }
  const extra = config.rules?.B7?.extra ?? [];
  if (isTest && extra.some((p) => matchTarget(p, targetPkg, targetPath))) return null;
  const allowed = mayImportOf(pkg, config);
  if (allowed.some((p) => p !== 'node:*' && p !== 'allowlist' && matchTarget(p, targetPkg, targetPath))) return null;
  const src = layerOf(pkg, config);
  const dst = layerOf(targetPkg, config);
  if (src !== null && dst !== null && dst >= src) {
    return violation('layer', file, `${pkg} (layer ${src}) cannot import ${targetPkg} (layer ${dst})`, spec);
  }
  return violation('layer', file, `${pkg} may not import ${targetPkg}`, spec);
}

function fetchBanned(pkg: string, file: string, config: BoundariesFile): boolean {
  const zones = config.rules?.B4?.noFetchIn ?? [];
  return zones.some((z) => pkg === z || pkg.startsWith(`${z}/`) || file === z || file.startsWith(`${z}/`));
}

/** Check an in-memory file map. `files` keys are repo-relative paths. */
export function checkSources(files: Record<string, string>, config: BoundariesFile, allowlist?: AllowlistFile | null): Violation[] {
  const allow = allowlist ?? null;
  const out: Violation[] = [];
  for (const file of Object.keys(files).sort()) {
    out.push(...absenceViolations([file]));
    const src = files[file];
    if (src === undefined) continue;
    const pkg = packageOf(file);
    if (!pkg) continue;
    if (fetchBanned(pkg, file, config) && /\bfetch\s*\(/.test(stripComments(src))) {
      out.push(violation('B4', file, `fetch is not allowed in ${pkg}`));
    }
    const isTest = /\.test\.(?:m?js|cjs|tsx?)$/.test(file);
    for (const imp of parseImports(src)) {
      if (!imp.literal) {
        out.push(violation('dynamic', file, 'dynamic import is not a string literal'));
        continue;
      }
      const found = judge(file, pkg, imp.spec, config, allow, isTest);
      if (found) out.push(found);
    }
  }
  return out;
}

function repoRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), '..');
}

function loadJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

function tracked(root: string): string[] {
  const r = spawnSync('git', ['ls-files'], { cwd: root, encoding: 'utf8', maxBuffer: 1 << 28 });
  if (r.status !== 0) throw new Error((r.stderr || 'git ls-files failed').trim());
  return r.stdout.split('\n').filter((p) => p.length > 0);
}

function dedupe(list: Violation[]): Violation[] {
  const seen = new Set<string>();
  const out: Violation[] = [];
  for (const v of list) {
    const key = `${v.rule}\0${v.file}\0${v.spec ?? ''}\0${v.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(v);
  }
  return out;
}

function main(): number {
  const root = repoRoot();
  const cfgPath = resolve(root, 'scripts/boundaries.json');
  if (!existsSync(cfgPath)) {
    console.error('scripts/boundaries.json is missing');
    return 1;
  }
  const config = loadJson<BoundariesFile>(cfgPath);
  const allowPath = resolve(root, 'scripts/allowlist.json');
  const allowlist = existsSync(allowPath) ? loadJson<AllowlistFile>(allowPath) : null;
  const files: Record<string, string> = {};
  const names = tracked(root);
  for (const file of names) {
    if (!SOURCE.test(file)) continue;
    files[file] = readFileSync(resolve(root, file), 'utf8');
  }
  const violations = dedupe([...checkSources(files, config, allowlist), ...absenceViolations(names)]);
  if (violations.length === 0) {
    console.log(`boundaries: ${Object.keys(files).length} files, no violations`);
    return 0;
  }
  for (const v of violations) console.error(`${v.rule} ${v.file}${v.spec ? ` ${v.spec}` : ''}: ${v.message}`);
  console.error(`boundaries: ${violations.length} violation(s)`);
  return 1;
}

function invokedDirectly(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  return import.meta.url === pathToFileURL(resolve(entry)).href;
}

if (invokedDirectly()) process.exit(main());
