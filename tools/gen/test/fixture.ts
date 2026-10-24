// Two-module fixture manifest used by the golden-output and rule tests.
import { block, create, defineManifest, ev, ftype, gateAct, health, perm, read, screen, t, write, outward } from '../../../packages/contracts/src/index.ts';
import type { Manifest } from '../../../packages/contracts/src/index.ts';
import type { Loaded } from '../src/load.ts';
import type { LaneTable } from '../src/validate.ts';

export const table: LaneTable = { lanes: { L1: ['alpha', 'beta'] }, extras: {}, frozenCount: 2, versioned: [] };
const ID = t.id('rec');

export function alpha(): Manifest {
  return defineManifest({
    id: 'alpha', title: 'Alpha', owner: 'L1',
    permissions: [perm('alpha.edit', 'records', 'Edit alpha', 'low', ['owner', 'admin', 'member'], ['record'])],
    fieldTypes: [ftype('text', 'Text', t.str())],
    events: [ev('alpha.created', 'Alpha created', { p: { recordId: ID }, subject: ['record', '/recordId'] })],
    blocks: [block('alpha_card', { recordId: ID, title: t.str() }, '{{title}}')],
    capabilities: [
      read('alpha.get', 'Read one alpha', { in: { recordId: ID }, out: { name: t.str() }, on: ['record', '/recordId'], tool: 'records' }),
      create('alpha.create', 'Create an alpha', { in: { name: t.str() }, out: { recordId: ID }, make: ['record_type', '/name'], perm: 'alpha.edit', emits: ['alpha.created'], tool: 'records' }),
    ],
    screens: [screen('alpha.main', 'records', 'ui:AlphaMain', { q: { one: ['alpha.get', { recordId: '/selected' }] } })],
    health: [health('alpha.up', 'Alpha up', 'alpha.ping', 'Restart alpha')],
  });
}

export function beta(): Manifest {
  return defineManifest({
    id: 'beta', title: 'Beta', owner: 'L1',
    gateActs: [gateAct('notify', 'Notify', 'low', 'alpha_card', { sendsOnApprove: 'beta.release' })],
    capabilities: [
      read('alpha.ping', 'Probe', { out: { state: t.enm('healthy', 'degraded', 'down') } }),
      outward('beta.notify', 'Notify someone', { in: { to: t.str() }, out: { sent: t.bool() }, gate: 'notify' }),
      write('beta.release', 'Release a held call', { in: { taskId: t.id('tsk') }, out: { ok: t.bool() } }),
    ],
  });
}

export function loaded(a: Manifest = alpha(), b: Manifest = beta()): Loaded[] {
  return [{ file: 'manifests/alpha.ts', dir: '', manifest: a }, { file: 'manifests/beta.ts', dir: '', manifest: b }];
}
