#!/usr/bin/env node
// Secret scan over the tracked files (P-L11_23). Looks for credential shapes: private key blocks, cloud and provider tokens. It reads `git ls-files`, so a file that is not tracked is not scanned.
// A hit is allowed only with a reason: a path prefix in scripts/security/secret-allow.json (a fixture that holds a fake key on purpose), or the marker `secret-scan:allow` on the line itself.
// Exit 1 on any hit that is not allowed. Never prints the secret: the line shows the rule, the file, the line number and the first four characters.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export interface Rule { id: string; re: RegExp }
export interface Hit { rule: string; file: string; line: number; sample: string }
export interface AllowEntry { path: string; reason: string }

export const RULES: readonly Rule[] = [
  { id: 'private-key-block', re: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY(?: BLOCK)?-----/ },
  { id: 'aws-access-key-id', re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/ },
  { id: 'github-token', re: /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{50,})\b/ },
  { id: 'slack-token', re: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/ },
  { id: 'stripe-live-key', re: /\b[sr]k_live_[A-Za-z0-9]{16,}\b/ },
  { id: 'google-api-key', re: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { id: 'anthropic-or-openai-key', re: /\bsk-(?:ant-)?[A-Za-z0-9_-]{32,}\b/ },
  { id: 'npm-token', re: /\bnpm_[A-Za-z0-9]{36}\b/ },
  { id: 'twilio-key', re: /\bSK[0-9a-f]{32}\b/ },
];

const ALLOW_MARK = 'secret-scan:allow';
const SKIP_EXT = /\.(?:png|jpe?g|gif|webp|ico|icns|pdf|zip|gz|tgz|woff2?|ttf|otf|eot|mp[34]|mov|wasm|onnx|bin|db|sqlite|lock)$/i;
const MAX_BYTES = 2 * 1024 * 1024;

export function scanText(file: string, text: string): Hit[] {
  const hits: Hit[] = [];
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? '';
    if (line.includes(ALLOW_MARK)) continue;
    for (const r of RULES) {
      const m = r.re.exec(line);
      if (m) hits.push({ rule: r.id, file, line: i + 1, sample: `${m[0].slice(0, 4)}...` });
    }
  }
  return hits;
}

export function allowed(file: string, allow: readonly AllowEntry[]): AllowEntry | undefined {
  return allow.find((a) => file === a.path || (a.path.endsWith('/') && file.startsWith(a.path)));
}

/** Entries without a reason are refused: an allowance nobody explained is a hole. */
export function checkAllowList(allow: readonly AllowEntry[]): string[] {
  return allow.filter((a) => typeof a.reason !== 'string' || a.reason.trim().length < 10).map((a) => `secret-allow.json: ${a.path} has no reason`);
}

export function scanFiles(files: ReadonlyMap<string, string>, allow: readonly AllowEntry[]): Hit[] {
  const out: Hit[] = [];
  for (const [file, text] of files) {
    if (allowed(file, allow)) continue;
    out.push(...scanText(file, text));
  }
  return out;
}

function root(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), '../..');
}

function main(): number {
  const dir = root();
  const allow = (JSON.parse(readFileSync(resolve(dir, 'scripts/security/secret-allow.json'), 'utf8')) as { allow: AllowEntry[] }).allow;
  const bad = checkAllowList(allow);
  if (bad.length) { for (const b of bad) console.error(b); return 1; }
  const ls = spawnSync('git', ['ls-files', '-z'], { cwd: dir, encoding: 'utf8', maxBuffer: 1 << 28 });
  if (ls.status !== 0) { console.error((ls.stderr || 'git ls-files failed').trim()); return 1; }
  const files = new Map<string, string>();
  for (const f of ls.stdout.split('\0')) {
    if (!f || SKIP_EXT.test(f)) continue;
    let buf: Buffer;
    try { buf = readFileSync(resolve(dir, f)); } catch { continue; }
    if (buf.length > MAX_BYTES || buf.includes(0)) continue;
    files.set(f, buf.toString('utf8'));
  }
  const hits = scanFiles(files, allow);
  for (const h of hits) console.error(`secret-scan ${h.rule} ${h.file}:${h.line} (${h.sample})`);
  console.log(`secret-scan: ${files.size} files, ${hits.length} hit(s)`);
  return hits.length > 0 ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) process.exit(main());
