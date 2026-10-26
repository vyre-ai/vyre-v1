#!/usr/bin/env node
// License check for npm packages and cargo deny (ARCH 2.2 B6).
// Allowed: MIT, Apache-2.0, BSD, ISC, and MPL-2.0. MPL-2.0 is file-level only:
// the hit is accepted and marked fileLevel so the obligation stays on that dependency's files.
// AGPL, GPL, LGPL, and SSPL are blocked. An OR expression is accepted when one side is allowed.
// cargo deny output (human tree or JSON diagnostics) is parsed; a rejected crate is never accepted.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const ALLOWED_LICENSES = ['MIT', 'MIT-0', 'Apache-2.0', 'BSD-2-Clause', 'BSD-3-Clause', 'BSD', 'ISC', 'MPL-2.0', 'BlueOak-1.0.0', 'Unlicense', 'Zlib'] as const;

export interface LicenseHit {
  name: string;
  license: string;
  ok: boolean;
  fileLevel: boolean;
  reason: string;
}

export interface CargoDenyHit {
  crate: string;
  version: string;
  license: string;
  ok: boolean;
  fileLevel: boolean;
  reason: string;
}

export function licenseText(license: unknown): string {
  if (typeof license === 'string') return license;
  if (license && typeof license === 'object' && 'type' in license) {
    const t = (license as { type?: unknown }).type;
    if (typeof t === 'string') return t;
  }
  return '';
}

function balanced(s: string): boolean {
  let depth = 0;
  for (const c of s) {
    if (c === '(') depth += 1;
    else if (c === ')') {
      depth -= 1;
      if (depth < 0) return false;
    }
  }
  return depth === 0;
}

function unwrap(s: string): string {
  let t = s.trim();
  while (t.startsWith('(') && t.endsWith(')') && balanced(t.slice(1, -1))) t = t.slice(1, -1).trim();
  return t;
}

/** Split on OR or AND that sits at parenthesis depth 0. */
function splitTop(expr: string, op: 'OR' | 'AND'): string[] {
  const parts: string[] = [];
  let depth = 0;
  let cur = '';
  let i = 0;
  while (i < expr.length) {
    const c = expr[i] ?? '';
    if (c === '(') {
      depth += 1;
      cur += c;
      i += 1;
      continue;
    }
    if (c === ')') {
      depth = Math.max(0, depth - 1);
      cur += c;
      i += 1;
      continue;
    }
    if (depth === 0 && expr.slice(i, i + op.length).toUpperCase() === op) {
      const before = i === 0 || /\s/.test(expr[i - 1] ?? '');
      const afterIdx = i + op.length;
      const after = afterIdx >= expr.length || /\s/.test(expr[afterIdx] ?? '');
      if (before && after) {
        parts.push(cur.trim());
        cur = '';
        i = afterIdx;
        continue;
      }
    }
    cur += c;
    i += 1;
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts;
}

/** Map a single SPDX id or a common prose name onto a canonical id. */
export function normalizeLicense(raw: string): string {
  const s = unwrap(raw).replace(/\s+WITH\s+[A-Za-z0-9.-]+/gi, '').trim();
  const u = s.toLowerCase().replace(/[_\s]+/g, ' ');
  if (u === 'mit' || u === 'mit license' || u === 'expat') return 'MIT';
  if (u.startsWith('apache') || u.includes('apache')) return 'Apache-2.0';
  if (u === 'isc' || u === 'isc license') return 'ISC';
  if (u === 'bsd' || u === 'bsd license') return 'BSD';
  if (u.startsWith('bsd-2') || u.includes('2-clause') || u.includes('simplified bsd')) return 'BSD-2-Clause';
  if (u.startsWith('bsd-3') || u.includes('3-clause') || u.includes('revised bsd')) return 'BSD-3-Clause';
  if (u.startsWith('bsd-')) return s.replace(/\s+/g, '-');
  if (u.startsWith('mpl') || u.includes('mozilla public')) return 'MPL-2.0';
  if (u.includes('affero') || u.includes('agpl')) return 'AGPL-3.0';
  if (u.includes('sspl') || u.includes('server side public')) return 'SSPL-1.0';
  if (u.includes('lesser') || u.includes('lgpl')) return 'LGPL';
  if (u.includes('gpl') || u.includes('gnu general')) return 'GPL-3.0';
  if (/^AGPL/i.test(s)) return 'AGPL-3.0';
  if (/^GPL/i.test(s)) return 'GPL-3.0';
  if (/^SSPL/i.test(s)) return 'SSPL-1.0';
  return s;
}

function isAllowedId(id: string): boolean {
  if (/^(?:AGPL|GPL|SSPL|LGPL)(?:-|$)/.test(id)) return false;
  if (id === 'MIT' || id === 'MIT-0' || id === 'Apache-2.0' || id === 'ISC' || id === 'MPL-2.0' || id === 'BSD') return true;
  if (id === 'BlueOak-1.0.0' || id === 'Unlicense' || id === 'Zlib') return true;   // rulings 77 and 78: permissive, no copyleft
  if (id.startsWith('BSD-')) return true;
  return false;
}

/**
 * SPDX expression. OR passes when one disjunct is fully allowed.
 * MPL-2.0 sets fileLevel: the copyleft applies to that dependency's files, not the whole program.
 */
export function evaluateLicense(expr: string): { ok: boolean; fileLevel: boolean; reason: string } {
  const cleaned = unwrap(expr.replace(/\s+WITH\s+[A-Za-z0-9.-]+/gi, '').trim());
  if (!cleaned) return { ok: false, fileLevel: false, reason: 'missing license' };
  const failures: string[] = [];
  for (const or of splitTop(cleaned, 'OR')) {
    const ands = splitTop(unwrap(or), 'AND').map((part) => normalizeLicense(unwrap(part)));
    let ok = true;
    let fileLevel = false;
    for (const id of ands) {
      if (!isAllowedId(id)) {
        ok = false;
        failures.push(id);
        break;
      }
      if (id === 'MPL-2.0') fileLevel = true;
    }
    if (ok) {
      return {
        ok: true,
        fileLevel,
        reason: fileLevel ? 'MPL-2.0 is allowed at file level only' : 'allowed',
      };
    }
  }
  return { ok: false, fileLevel: false, reason: `blocked: ${failures.join(', ') || cleaned}` };
}

export function checkNpmLicenses(deps: Array<{ name: string; license: unknown }>): LicenseHit[] {
  return deps.map((dep) => {
    const license = licenseText(dep.license);
    const ev = evaluateLicense(license);
    return { name: dep.name, license, ok: ev.ok, fileLevel: ev.fileLevel, reason: ev.reason };
  });
}

function pushDeny(hits: CargoDenyHit[], crate: string, version: string, license: string): void {
  if (!crate) return;
  const ev = evaluateLicense(license);
  hits.push({
    crate,
    version,
    license: license || 'unknown',
    ok: false,
    fileLevel: ev.fileLevel,
    reason: ev.ok ? 'cargo deny rejected' : ev.reason,
  });
}

/** Human cargo-deny tree: `├ AGPL-3.0-only: 1` / `└─ name version`, or a `┌─ name` diagnostic with `license expression:`. */
function parseCargoDenyText(output: string): CargoDenyHit[] {
  const hits: CargoDenyHit[] = [];
  let license = '';
  let crate = '';
  let version = '';
  const flush = () => {
    if (!crate) return;
    pushDeny(hits, crate, version, license);
    crate = '';
    version = '';
  };
  for (const line of output.split(/\r?\n/)) {
    const named = /license(?:\s+expression)?\s*[:=]\s*(.+?)\s*$/i.exec(line);
    if (named) {
      license = (named[1] ?? '').trim();
      if (crate) flush();
      continue;
    }
    const box = /┌─\s*([A-Za-z0-9_-]+)\s+v?(\d+\S+)/.exec(line);
    if (box) {
      flush();
      crate = box[1] ?? '';
      version = box[2] ?? '';
      license = '';
      continue;
    }
    if (!line.includes('─')) {
      const banner = /^\s*[├└]\s+([A-Za-z0-9.+-]+)\b/.exec(line);
      if (banner) {
        license = banner[1] ?? '';
        continue;
      }
    }
    const leaf = /[└├]─\s*([A-Za-z0-9_-]+)\s+v?(\d+\S+)/.exec(line);
    if (leaf) {
      crate = leaf[1] ?? '';
      version = leaf[2] ?? '';
      flush();
    }
  }
  flush();
  return hits;
}

function collectJson(value: unknown, hits: CargoDenyHit[]): void {
  if (Array.isArray(value)) {
    for (const item of value) collectJson(item, hits);
    return;
  }
  if (!value || typeof value !== 'object') return;
  const obj = value as Record<string, unknown>;
  const fields = obj.fields && typeof obj.fields === 'object' ? obj.fields as Record<string, unknown> : obj;
  const severity = typeof fields.severity === 'string' ? fields.severity : '';
  const code = fields.code;
  const codeStr = typeof code === 'string'
    ? code
    : code && typeof code === 'object' && typeof (code as { code?: unknown }).code === 'string'
      ? (code as { code: string }).code
      : '';
  if (severity !== 'error' && codeStr !== 'rejected') return;
  const blob = JSON.stringify(value);
  const lic = /license(?:\s+expression)?\s*[:=]\s*([^"\\]+)/i.exec(blob);
  const crate = /([A-Za-z0-9_-]+) (\d+\.\d+\.\d+[A-Za-z0-9.+-]*)/.exec(blob);
  pushDeny(hits, crate?.[1] ?? 'unknown', crate?.[2] ?? '', (lic?.[1] ?? '').trim());
}

function parseCargoDenyJson(text: string): CargoDenyHit[] {
  const hits: CargoDenyHit[] = [];
  try {
    collectJson(JSON.parse(text) as unknown, hits);
    return hits;
  } catch {
    for (const line of text.split(/\r?\n/)) {
      const t = line.trim();
      if (!t.startsWith('{') && !t.startsWith('[')) continue;
      try {
        collectJson(JSON.parse(t) as unknown, hits);
      } catch {
        // a non-JSON line in a mixed log
      }
    }
  }
  return hits;
}

/** Parse `cargo deny check licenses` text or `--format json`. Every returned hit was rejected. */
export function parseCargoDeny(output: string): CargoDenyHit[] {
  const trimmed = output.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    const hits = parseCargoDenyJson(trimmed);
    if (hits.length > 0) return hits;
  }
  return parseCargoDenyText(output);
}

function repoRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), '..');
}

function readInstalled(root: string): Array<{ name: string; license: unknown }> {
  const nm = join(root, 'node_modules');
  if (!existsSync(nm)) return [];
  const out: Array<{ name: string; license: unknown }> = [];
  const take = (pkgPath: string) => {
    if (!existsSync(pkgPath)) return;
    let parsed: { name?: unknown; license?: unknown; private?: unknown };
    try {
      parsed = JSON.parse(readFileSync(pkgPath, 'utf8')) as { name?: unknown; license?: unknown; private?: unknown };
    } catch {
      return;
    }
    if (parsed.private === true) return;
    if (typeof parsed.name !== 'string') return;
    out.push({ name: parsed.name, license: parsed.license });
  };
  for (const name of readdirSync(nm)) {
    if (name === '.bin' || name.startsWith('.')) continue;
    if (name.startsWith('@')) {
      const scope = join(nm, name);
      for (const sub of readdirSync(scope)) take(join(scope, sub, 'package.json'));
    } else take(join(nm, name, 'package.json'));
  }
  return out;
}

function reportNpm(deps: Array<{ name: string; license: unknown }>): number {
  const hits = checkNpmLicenses(deps);
  let failed = 0;
  for (const hit of hits) {
    if (hit.ok && hit.fileLevel) console.log(`file-level ${hit.name}: ${hit.license}`);
    if (!hit.ok) {
      console.error(`${hit.name}: ${hit.license || '(none)'} ${hit.reason}`);
      failed += 1;
    }
  }
  return failed;
}

function reportCargo(output: string): number {
  const hits = parseCargoDeny(output);
  for (const hit of hits) console.error(`${hit.crate} ${hit.version}: ${hit.license} ${hit.reason}`);
  return hits.length;
}

function main(): number {
  const root = repoRoot();
  const args = process.argv.slice(2);
  const npmIdx = args.indexOf('--npm');
  const cargoIdx = args.indexOf('--cargo');
  let failed = 0;
  let saw = false;
  if (npmIdx >= 0) {
    saw = true;
    const file = args[npmIdx + 1];
    if (!file) {
      console.error('--npm needs a JSON file of {name, license}');
      return 1;
    }
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as Array<{ name: string; license: unknown }>;
    failed += reportNpm(parsed);
  }
  if (cargoIdx >= 0) {
    saw = true;
    const file = args[cargoIdx + 1];
    if (!file) {
      console.error('--cargo needs a cargo deny output file');
      return 1;
    }
    failed += reportCargo(readFileSync(file, 'utf8'));
  }
  if (!saw) {
    const installed = readInstalled(root);
    if (installed.length > 0) {
      saw = true;
      failed += reportNpm(installed);
    }
    const cargoToml = join(root, 'Cargo.toml');
    if (existsSync(cargoToml)) {
      saw = true;
      const r = spawnSync('cargo', ['deny', 'check', 'licenses'], { cwd: root, encoding: 'utf8', maxBuffer: 1 << 28 });
      const output = `${r.stdout ?? ''}\n${r.stderr ?? ''}`;
      const n = reportCargo(output);
      if (n === 0 && r.status !== 0) {
        console.error((r.stderr || r.error?.message || 'cargo deny failed').trim());
        failed += 1;
      } else failed += n;
    }
  }
  if (!saw) console.log('license-check: nothing to reject');
  else if (failed === 0) console.log('license-check: no blocked licenses');
  return failed > 0 ? 1 : 0;
}

function invokedDirectly(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  return import.meta.url === pathToFileURL(resolve(entry)).href;
}

if (invokedDirectly()) process.exit(main());
