// @reads /tools/gen/src/cli.ts
// The generator command succeeds on the real manifests and is deterministic across two runs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const cli = fileURLToPath(new URL('../src/cli.ts', import.meta.url));

function walk(dir: string, base = dir): string[] {
  const out: string[] = [];
  for (const n of readdirSync(dir).sort()) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) out.push(...walk(p, base));
    else out.push(p.slice(base.length));
  }
  return out;
}

test('vyre-gen writes the same tree twice', () => {
  const a = mkdtempSync(join(tmpdir(), 'gen-a-'));
  const b = mkdtempSync(join(tmpdir(), 'gen-b-'));
  for (const d of [a, b]) {
    const r = spawnSync(process.execPath, [cli, '--out', d], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
  }
  const fa = walk(a);
  assert.deepEqual(fa, walk(b));
  assert.ok(fa.length > 100);
  for (const f of ['/registry.json', '/hash.txt', '/client.ts']) assert.equal(readFileSync(a + f, 'utf8'), readFileSync(b + f, 'utf8'));
});
