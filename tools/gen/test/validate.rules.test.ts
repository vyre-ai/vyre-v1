// One failing fixture per validation rule (ARCH 3.7), plus the clean fixture.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { read, screen, t, write } from '../../../packages/contracts/src/index.ts';
import type { CapabilityDef, Manifest } from '../../../packages/contracts/src/index.ts';
import { validateAll } from '../src/validate.ts';
import { alpha, beta, loaded, table } from './fixture.ts';

const errs = (a: Manifest = alpha(), b: Manifest = beta(), tb = table) => validateAll(loaded(a, b), tb);
const withAlphaCaps = (f: (c: CapabilityDef[]) => CapabilityDef[]): Manifest => { const m = alpha(); m.capabilities = f(m.capabilities ?? []); return m; };

test('the clean fixture has no problems', () => assert.deepEqual(errs(), []));

const cases: Array<[string, () => string[], string]> = [
  ['duplicate capability', () => errs(withAlphaCaps((c) => [...c, ...c])), 'duplicate capability'],
  ['emits an undeclared event', () => errs(withAlphaCaps((c) => [{ ...(c[1] as CapabilityDef), emits: ['alpha.nope'] }, ...c.slice(0, 1)])), 'emits undeclared event'],
  ['unknown permission', () => errs(withAlphaCaps((c) => [c[0] as CapabilityDef, { ...(c[1] as CapabilityDef), permission: 'nope.perm' }])), 'unknown permission'],
  ['outward without a gate', () => errs(alpha(), (() => { const b = beta(); b.capabilities = [{ ...(b.capabilities?.[1] as CapabilityDef), gate: undefined }, ...(b.capabilities ?? []).filter((_, i) => i !== 1)]; return b; })()), 'outward capability needs a gate'],
  ['unknown error code', () => errs(withAlphaCaps((c) => [{ ...(c[0] as CapabilityDef), errors: ['validation.nope'] }, ...c.slice(1)])), 'unknown error code'],
  ['example that does not validate', () => errs(withAlphaCaps((c) => [{ ...(c[0] as CapabilityDef), examples: [{ name: 'bad', input: {}, output: {} }] }, ...c.slice(1)])), 'example bad input'],
  ['idempotency key not required', () => errs(withAlphaCaps((c) => [c[0] as CapabilityDef, { ...(c[1] as CapabilityDef), input: t.obj({ name: t.str() }) }])), 'does not require idempotencyKey'],
  ['resource pointer not an input', () => errs(withAlphaCaps((c) => [{ ...(c[0] as CapabilityDef), resource: { type: 'record', id: '/nope' } }, ...c.slice(1)])), 'resource id pointer'],
  ['capability name is a prefix of another', () => errs(withAlphaCaps((c) => [...c, read('alpha.get.more', 'More', { out: { x: t.bool() } })])), 'is a prefix of'],
  ['screen uses an unknown capability', () => errs((() => { const a = alpha(); a.screens = [screen('alpha.x', 'records', 'ui:X', { q: { q: ['alpha.zzz'] } })]; return a; })()), 'unknown capability alpha.zzz'],
  ['agent parity: a screen uses a capability agents cannot call', () => errs((() => { const a = alpha(); a.screens = [screen('alpha.x', 'records', 'ui:X', { q: { q: ['alpha.ping'] } })]; return a; })()), 'agent parity'],
  ['health check capability missing', () => errs((() => { const a = alpha(); a.health = [{ ...(a.health?.[0] as NonNullable<Manifest['health']>[number]), cap: 'alpha.zzz' }]; return a; })()), 'unknown capability alpha.zzz'],
  ['unknown gate act in a gate', () => errs(alpha(), (() => { const b = beta(); b.capabilities = [{ ...(b.capabilities?.[1] as CapabilityDef), gate: { act: 'nope' } }, ...(b.capabilities ?? []).filter((_, i) => i !== 1)]; return b; })()), 'unknown gate act nope'],
  ['em dash in text', () => errs(withAlphaCaps((c) => [{ ...(c[0] as CapabilityDef), summary: 'Read — one' }, ...c.slice(1)])), 'contains em dash'],
  ['owner not matching the lane table', () => errs({ ...alpha(), owner: 'L2' }), 'owner L2 must be L1'],
  ['module missing from the lane table', () => validateAll(loaded(), { ...table, lanes: { L1: ['alpha'] }, frozenCount: 1 }), 'is not in the lane table'],
  ['versioned type without versions capability', () => errs(alpha(), beta(), { ...table, versioned: ['alpha'] }), 'missing capability alpha.versions'],
  ['pre-auth capability needs a rate limit', () => errs(withAlphaCaps((c) => [...c, read('alpha.hello', 'Hello', { out: { x: t.bool() }, caller: 'anonymous' })])), 'anonymous capability needs a rate limit'],
  ['unknown field type in an entity', () => errs((() => { const a = alpha(); a.entities = [{ key: 'x', table: 'alpha_x', idPrefix: 'x_', fields: { f: { type: 'nope' } }, acl: { resource: 'space' }, sync: { profile: { desktop: 'all', phone: 'all', web: 'all' } } }]; return a; })()), 'unknown field type nope'],
  ['a block action maps a property that is not an input', () => errs((() => { const a = alpha(); a.blocks = [{ type: 'b', v: 1, data: t.obj({}), component: 'ui:B', fallback: 'b', actions: [{ key: 'go', label: 'Go', cap: 'alpha.get', input: { nope: '/x' } }] }]; return a; })()), 'maps nope'],
  ['a write capability reused with a changed route', () => errs(withAlphaCaps((c) => [...c, write('alpha.other', 'Other', { out: { x: t.bool() }, http: { method: 'POST', path: '/v1/alpha/get' } })])), 'already used by'],
];

for (const [name, run, expect] of cases) {
  test(`rule: ${name}`, () => {
    const e = run();
    assert.ok(e.some((x) => x.includes(expect)), `expected "${expect}" in:\n${e.join('\n')}`);
  });
}
