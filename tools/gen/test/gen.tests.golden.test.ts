// Golden output for outputs 8, 9, 10, 11, 14: contract tests, event tests, permission and event catalogues, kind tables.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRegistry } from '../src/build.ts';
import { emitAll } from '../src/emit.ts';
import { loaded } from './fixture.ts';

const files = emitAll(buildRegistry(loaded()));

test('one contract test file per module wires stubs, examples and compiled validators', () => {
  const s = files.get('tests/alpha.contract.test.ts') as string;
  assert.match(s, /moduleContracts\(registry, "alpha", notImplemented, examples, validators, eventValidators\)/);
  assert.ok(files.has('tests/beta.contract.test.ts'));
});

test('catalogues list permissions, events and kinds', () => {
  assert.match(files.get('permissions.ts') as string, /"alpha.edit"/);
  assert.match(files.get('events.ts') as string, /"alpha.created"/);
  assert.match(files.get('kinds.ts') as string, /export const gateActs/);
});

test('seed.sql carries the built-in role rows', () => {
  assert.match(files.get('modules/access/seed.sql') as string, /INSERT INTO "access_roles"/);
});
