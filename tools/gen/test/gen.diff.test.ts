// vyre-gen diff: additive changes pass, breaking changes without a version bump fail.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defineManifest, read, t } from '../../../packages/contracts/src/index.ts';
import type { CapabilityDef } from '../../../packages/contracts/src/index.ts';
import { buildRegistry } from '../src/build.ts';
import { diffRegistries } from '../src/diff.ts';

const reg = (caps: CapabilityDef[]) => buildRegistry([{ file: 'manifests/alpha.ts', dir: '', manifest: defineManifest({ id: 'alpha', title: 'Alpha', owner: 'L1', capabilities: caps }) }]);
const base = () => read('alpha.get', 'Get', { in: { id: t.str() }, out: { name: t.str() } });

test('new optional input, new output field and a new error code are additive', () => {
  const next = read('alpha.get', 'Get', { in: { id: t.str(), verbose: t.opt(t.bool()) }, out: { name: t.str(), extra: t.opt(t.str()) }, errors: ['validation.duplicate'] });
  const d = diffRegistries(reg([base()]), reg([next]));
  assert.deepEqual(d.breaking, []);
  assert.ok(d.additive.length >= 3, d.additive.join('\n'));
});

test('a new required input fails', () => {
  const next = read('alpha.get', 'Get', { in: { id: t.str(), must: t.str() }, out: { name: t.str() } });
  assert.ok(diffRegistries(reg([base()]), reg([next])).breaking.some((b) => b.includes('new required input')));
});

test('removing or retyping an output field fails', () => {
  const removed = read('alpha.get', 'Get', { in: { id: t.str() }, out: {} });
  assert.ok(diffRegistries(reg([base()]), reg([removed])).breaking.some((b) => b.includes('removed')));
  const retyped = read('alpha.get', 'Get', { in: { id: t.str() }, out: { name: t.int() } });
  assert.ok(diffRegistries(reg([base()]), reg([retyped])).breaking.some((b) => b.includes('type or enum changed')));
});

test('removing a capability fails unless a newer v exists', () => {
  assert.ok(diffRegistries(reg([base()]), reg([])).breaking.some((b) => b.includes('removed without a newer v')));
  const v2: CapabilityDef = { ...base(), v: 2 };
  assert.deepEqual(diffRegistries(reg([base()]), reg([v2])).breaking, []);
});
// exercised by the P-PR_11 evidence run
