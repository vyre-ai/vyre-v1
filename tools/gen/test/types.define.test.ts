// A manifest that uses every extension kind validates, and the DSL keeps literal capability names.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { conn, defineManifest, entity, ev, field, ftype, gateAct, health, importSource, block, list, notif, read, retention, rtype, screen, setting, step, taskKind, trigger, atool, vkind, perm, t, write } from '../../../packages/contracts/src/index.ts';
import { validateAll } from '../src/validate.ts';
import type { LaneTable } from '../src/validate.ts';

const table: LaneTable = { lanes: { L1: ['all'] }, extras: {}, frozenCount: 1, versioned: [] };

test('a manifest with every extension kind validates', () => {
  const m = defineManifest({
    id: 'all', title: 'All kinds', owner: 'L1',
    permissions: [perm('all.use', 'space', 'Use all', 'low', ['owner', 'admin'])],
    capabilities: [read('all.get', 'Get', { in: { id: t.id('rec') }, out: { ok: t.bool() }, on: ['record', '/id'], tool: 'meta' }), write('all.set', 'Set', { in: { id: t.id('rec') }, out: { ok: t.bool() }, on: ['record', '/id'], perm: 'all.use', emits: ['all.changed'], tool: 'meta' }), read('all.ping', 'Ping', { out: { state: t.enm('healthy', 'degraded', 'down') } })],
    events: [ev('all.changed', 'Changed', { p: { id: t.id('rec') }, subject: ['record', '/id'], notify: 'all.note', retention: 'all.keep', trigger: 'Changed' })],
    entities: [entity('thing', 'all_thing', 'thg_', { name: 'text' }, 'space')],
    fieldTypes: [ftype('text', 'Text', t.str())],
    viewKinds: [vkind('table', 'Table', 'rows')],
    recordTypes: [rtype('thing', 'Thing', 'Things', 'box', [field('name', 'text', 'Name')])],
    steps: [step('all.set', 'Set', 'data', 'capability', { cap: 'all.set', effects: 'write', in: { id: t.id('rec') }, out: { ok: t.bool() } })],
    triggers: [trigger('changed', 'Changed', { events: ['all.changed'] }, { id: t.id('rec') })],
    connectors: [conn('allc', 'All connector', { mode: 'api', scope: 'space', auth: { type: 'api_key', secret: 'All_Key' }, domains: ['example.com'], health: 'all.up', actions: ['all.get'] })],
    agentTools: [atool('all_tool', 'Tool', { cap: 'all.get', in: { id: t.id('rec') }, out: { ok: t.bool() } })],
    blocks: [block('all_block', { id: t.id('rec') }, 'Block {{id}}')],
    screens: [screen('all.main', 'records', 'ui:Main', { q: { g: ['all.get', { id: '/s' }] } })],
    health: [health('all.up', 'Up', 'all.ping', 'Restart')],
    gateActs: [gateAct('all_act', 'Act', 'low', 'all_block', { sendsOnApprove: 'all.set' })],
    taskKinds: [taskKind('work', 'Work', { blocks: ['all_block'] })],
    notificationKinds: [notif('all.note', 'badge', 'home', 'Note')],
    importSources: [importSource('csv', 'CSV', ['.csv'], 'all.get', 'record_type')],
    settings: [setting('all.setting', 'space', 'all', 'A setting', t.bool(), true)],
    retention: [retention('all.keep', 'Keep', '30d')],
    lists: [list('record', 'Thing', 'Things', 'all.get')],
  });
  assert.deepEqual(validateAll([{ file: 'manifests/all.ts', dir: '', manifest: m }], table), []);
  assert.deepEqual((m.capabilities ?? []).map((c) => c.name), ['all.get', 'all.set', 'all.ping']);
});
