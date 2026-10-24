// @reads /tools/gen/src/cli.ts
// F11 acceptance (P-PR_33): 72 modules generate, requires point at existing manifests, every module has its contract test, committed output has no drift.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { all } from '../manifests/index.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const modules = all.filter((m) => m.kind === 'module' || m.kind === 'connector');

test('72 module manifests exist and every require names an existing manifest', () => {
  assert.equal(modules.length, 72);
  const ids = new Set(all.map((m) => m.id));
  for (const m of all) for (const r of Object.keys(m.requires ?? {})) assert.ok(ids.has(r), `${m.id} requires missing manifest ${r}`);
});

test('each of the 72 modules has a generated contract test, handlers and stub impl', () => {
  for (const m of modules) {
    for (const f of [`generated/tests/${m.id}.contract.test.ts`, `generated/modules/${m.id}/handlers.ts`, `generated/modules/${m.id}/stub-impl.ts`]) assert.ok(existsSync(root + f), f);
  }
});

test('gen --check is clean on the committed generated tree', () => {
  const r = spawnSync(process.execPath, [root + 'tools/gen/src/cli.ts', '--check'], { encoding: 'utf8', cwd: root });
  assert.equal(r.status, 0, r.stderr);
});
