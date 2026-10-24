// @reads /tools/gen/src/cli.ts
// gen --check is clean on a fresh tree and fails on drift.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const cli = fileURLToPath(new URL('../src/cli.ts', import.meta.url));
const run = (...a: string[]) => spawnSync(process.execPath, [cli, ...a], { encoding: 'utf8' });

test('check is clean on freshly generated output and fails after an edit', () => {
  const dir = mkdtempSync(join(tmpdir(), 'gen-check-'));
  assert.equal(run('--out', dir).status, 0);
  assert.equal(run('--check', '--out', dir).status, 0);
  appendFileSync(join(dir, 'hash.txt'), 'drift\n');
  const bad = run('--check', '--out', dir);
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /out of date/);
  rmSync(dir, { recursive: true });
});

test('diff against the committed registry reports no breaking change', () => {
  const r = run('--diff-against', fileURLToPath(new URL('../../../generated/registry.json', import.meta.url)));
  assert.equal(r.status, 0, r.stderr);
});
// exercised by the P-PR_11 evidence run
