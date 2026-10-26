#!/usr/bin/env node
// Dependency audit (P-L11_23): `npm audit --json` for the production dependencies. High and critical advisories fail the run unless scripts/security/audit-allow.json lists the advisory with a reason and
// an expiry date, so an allowance is reviewed again and never silent. Moderate and low advisories are printed and do not fail.
// A registry that cannot be reached fails the run too: an audit that did not run is not a pass.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export interface AllowEntry { advisory: string; reason: string; until: string }
export interface Finding { name: string; severity: string; via: string[] }

const FAIL = new Set(['high', 'critical']);

/** The advisories npm audit names for each vulnerable package (the `via` entries that are objects carry a url; strings point at another package). */
export function findings(report: unknown): Finding[] {
  const vulns = (report as { vulnerabilities?: Record<string, { severity?: string; via?: unknown[] }> } | null)?.vulnerabilities ?? {};
  const out: Finding[] = [];
  for (const [name, v] of Object.entries(vulns)) {
    const via = (v.via ?? []).map((x) => (typeof x === 'string' ? x : String((x as { url?: string; source?: unknown }).url ?? (x as { source?: unknown }).source ?? 'advisory')));
    out.push({ name, severity: String(v.severity ?? 'unknown'), via });
  }
  return out;
}

export function checkAllowList(allow: readonly AllowEntry[], now: Date): string[] {
  const out: string[] = [];
  for (const a of allow) {
    if (typeof a.reason !== 'string' || a.reason.trim().length < 10) out.push(`audit-allow.json: ${a.advisory} has no reason`);
    const until = Date.parse(a.until);
    if (!Number.isFinite(until)) out.push(`audit-allow.json: ${a.advisory} has no valid until date`);
    else if (until < now.getTime()) out.push(`audit-allow.json: the allowance for ${a.advisory} expired on ${a.until}`);
  }
  return out;
}

/** Findings that fail: high or critical, and neither the package nor one of its advisories is allowed. */
export function failing(list: readonly Finding[], allow: readonly AllowEntry[]): Finding[] {
  const ok = new Set(allow.map((a) => a.advisory));
  return list.filter((f) => FAIL.has(f.severity) && !ok.has(f.name) && !f.via.some((v) => ok.has(v)));
}

function main(): number {
  const dir = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
  const allow = (JSON.parse(readFileSync(resolve(dir, 'scripts/security/audit-allow.json'), 'utf8')) as { allow: AllowEntry[] }).allow;
  const bad = checkAllowList(allow, new Date());
  if (bad.length) { for (const b of bad) console.error(b); return 1; }
  const r = spawnSync('npm', ['audit', '--omit=dev', '--json'], { cwd: dir, encoding: 'utf8', maxBuffer: 1 << 28 });
  let report: unknown;
  try { report = JSON.parse(r.stdout); } catch { console.error(`npm audit gave no report: ${(r.stderr || r.error?.message || 'no output').trim().slice(0, 400)}`); return 1; }
  const err = (report as { error?: { summary?: string } }).error;
  if (err) { console.error(`npm audit failed: ${err.summary ?? 'unknown error'}`); return 1; }
  const list = findings(report);
  const fails = failing(list, allow);
  for (const f of list) console.log(`${FAIL.has(f.severity) && fails.includes(f) ? 'FAIL' : 'note'} ${f.severity} ${f.name} ${f.via.join(' ')}`);
  console.log(`audit: ${list.length} vulnerable package(s), ${fails.length} high or critical without an allowance`);
  return fails.length > 0 ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) process.exit(main());
