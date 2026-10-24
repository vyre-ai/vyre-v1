// Golden-output style tests for vyre-gen against a two-module fixture.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { create, defineManifest, ev, outward, perm, read, t, write } from '../../../packages/contracts/src/index.ts';
import type { Manifest } from '../../../packages/contracts/src/index.ts';
import { buildRegistry } from '../src/build.ts';
import { emitAll } from '../src/emit.ts';
import type { Loaded } from '../src/load.ts';
import { validateAll } from '../src/validate.ts';
import type { LaneTable } from '../src/validate.ts';

const table: LaneTable = { lanes: { L1: ['alpha', 'beta'] }, extras: {}, frozenCount: 2, versioned: [] };
const ID = t.id('rec');

function fixture(over: { betaCaps?: Manifest['capabilities'] } = {}): Loaded[] {
  const alpha = defineManifest({
    id: 'alpha', title: 'Alpha', owner: 'L1',
    permissions: [perm('alpha.edit', 'records', 'Edit alpha', 'low', ['owner', 'admin', 'member'], ['record'])],
    events: [ev('alpha.created', 'Alpha created', { p: { recordId: ID }, subject: ['record', '/recordId'] })],
    capabilities: [
      read('alpha.get', 'Read one alpha', { in: { recordId: ID }, out: { name: t.str() }, on: ['record', '/recordId'], tool: 'records' }),
      create('alpha.create', 'Create an alpha', { in: { name: t.str() }, out: { recordId: ID }, make: ['record_type', '/name'], perm: 'alpha.edit', emits: ['alpha.created'], tool: 'records' }),
    ],
  });
  const beta = defineManifest({
    id: 'beta', title: 'Beta', owner: 'L1',
    capabilities: over.betaCaps ?? [
      outward('beta.notify', 'Notify someone', { in: { to: t.str() }, out: { sent: t.bool() }, gate: 'none-for-test' }),
      write('beta.touch', 'Touch an alpha', { in: { recordId: ID }, out: { ok: t.bool() }, on: ['record', '/recordId'], perm: 'alpha.edit' }),
    ],
    gateActs: [],
  });
  return [{ file: 'manifests/alpha.ts', dir: '', manifest: alpha }, { file: 'manifests/beta.ts', dir: '', manifest: beta }];
}

test('fixture with an unknown gate act is rejected', () => {
  const errs = validateAll(fixture(), table);
  assert.ok(errs.some((e) => e.includes('unknown gate act none-for-test')), errs.join('\n'));
});

test('outward capability without a gate is rejected', () => {
  const errs = validateAll(fixture({ betaCaps: [outward('beta.notify', 'Notify someone', { in: { to: t.str() }, out: { sent: t.bool() } })] }), table);
  assert.ok(errs.some((e) => e.includes('outward capability needs a gate')), errs.join('\n'));
});

test('explicit gate none with a reason is accepted and the fixture generates', () => {
  const l = fixture({ betaCaps: [outward('beta.notify', 'Notify someone', { in: { to: t.str() }, out: { sent: t.bool() }, gate: { act: 'none', reason: 'internal ping' } })] });
  assert.deepEqual(validateAll(l, table), []);
  const reg = buildRegistry(l);
  assert.deepEqual(reg.capabilities.map((c) => c.name), ['alpha.create', 'alpha.get', 'beta.notify']);
  const files = emitAll(reg);
  for (const p of ['registry.json', 'hash.txt', 'routes.ts', 'client.ts', 'stubs.ts', 'types.ts', 'mcp-tools.json', 'tests/alpha/alpha.get.contract.test.ts', 'tests/alpha/events.contract.test.ts', 'modules/alpha/not-implemented.ts', 'docs/capabilities/alpha.get.md']) {
    assert.ok(files.has(p), `missing ${p}`);
  }
  const client = files.get('client.ts') as string;
  assert.match(client, /alpha: \{\n {6}create: call\("alpha.create", 1\),\n {6}get: call\("alpha.get", 1\),/);
  assert.match(files.get('types.ts') as string, /export type AlphaGetIn = \{\n {2}recordId: string;\n\};/);
  assert.match(files.get('routes.ts') as string, /"path": "\/v1\/alpha\/get"/);
  const tools = JSON.parse(files.get('mcp-tools.json') as string) as { tools: Array<{ name: string }> };
  assert.deepEqual(tools.tools.map((x) => x.name), ['alpha_create', 'alpha_get']);
});

test('generation is deterministic', () => {
  const l = fixture({ betaCaps: [read('beta.ping', 'Ping', { out: { pong: t.bool() } })] });
  const a = emitAll(buildRegistry(l));
  const b = emitAll(buildRegistry(l));
  assert.deepEqual([...a.keys()], [...b.keys()]);
  for (const [k, v] of a) assert.equal(b.get(k), v, k);
});

test('a duplicate capability name is rejected', () => {
  const l = fixture({ betaCaps: [read('alpha.get', 'Clash', { out: { x: t.bool() } })] });
  const errs = validateAll(l, table);
  assert.ok(errs.some((e) => e.includes('duplicate capability alpha.get@1')), errs.join('\n'));
});

test('requires is derived from references', () => {
  const l = fixture({ betaCaps: [write('beta.touch', 'Touch', { in: { recordId: ID }, out: { ok: t.bool() }, emits: ['alpha.created'] })] });
  const reg = buildRegistry(l);
  assert.deepEqual(reg.modules.find((m) => m.id === 'beta')?.requires, ['alpha']);
});
