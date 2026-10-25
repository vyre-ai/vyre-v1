// Loads every generated entry point so a broken or unreachable generated file fails a test, and checks the pieces agree.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createClient } from '../../../generated/client.ts';
import type { CallRequest } from '../../../generated/client.ts';
import { stubs } from '../../../generated/stubs.ts';
import { routes } from '../../../generated/routes.ts';
import { cliCommands } from '../../../generated/cli.ts';
import { tools } from '../../../generated/tools.ts';
import { permissions, roleDefaults } from '../../../generated/permissions.ts';
import { events, triggerEvents } from '../../../generated/events.ts';
import * as kinds from '../../../generated/kinds.ts';
import type { KnownErrorCode } from '../../../generated/errors.ts';
import type { CapMap, EventMap } from '../../../generated/types.ts';
import { registry } from '../../../generated/registry.ts';
import { blockRegistry, renderFallback } from '../../../generated/blocks.ts';
import type { BlockDataMap } from '../../../generated/blocks.ts';
import { screens } from '../../../generated/screens.ts';
import { syncEntities } from '../../../generated/sync/entities.ts';
import { validateInput, validateEvent } from '../../../generated/validators.ts';
import { levelIncludes, ladderFor } from '../../../packages/contracts/src/index.ts';

test('registry.ts loads registry.json and stays free of node:crypto (it reaches the web bundle)', () => {
  const text = readFileSync(new URL('../../../generated/registry.json', import.meta.url), 'utf8');
  assert.deepEqual(registry, JSON.parse(text));
  assert.ok(!/node:crypto|registryHash/.test(readFileSync(new URL('../../../generated/registry.ts', import.meta.url), 'utf8')));
});

test('routes, tools and catalogues agree with the registry', () => {
  assert.equal(routes.length, registry.capabilities.length);
  assert.equal(new Set(routes.map((r) => r.method + ' ' + r.path)).size, routes.length);
  assert.equal(new Set(tools.map((t) => t.name)).size, tools.length);
  assert.equal(permissions.length, registry.permissions.length);
  assert.equal(Object.keys(roleDefaults).length, registry.permissions.length);
  assert.equal(events.length, registry.events.length);
  assert.ok(triggerEvents.every((e) => e.trigger));
  assert.equal(kinds.gateActs.length, registry.gateActs.length);
  assert.ok(cliCommands.every((c) => c.command.startsWith('vyre ')));
});

test('typed client sends the capability name and version through the transport', async () => {
  const seen: CallRequest[] = [];
  const api = createClient(async (req) => { seen.push(req); return {}; });
  await api.records.get({ type: 'contact', recordId: 'rec_a1b2c3' }, { traceId: '0123456789abcdef0123456789abcdef' });
  assert.equal(seen[0]?.cap, 'records.get');
  assert.equal(seen[0]?.v, 1);
  assert.equal(seen[0]?.opts?.traceId, '0123456789abcdef0123456789abcdef');
});

test('module call stubs go through ctx.call', async () => {
  const names: string[] = [];
  const s = stubs({ call: async (cap) => { names.push(cap); return {} as never; } });
  await s.records.get({ type: 'contact', recordId: 'rec_a1b2c3' });
  assert.deepEqual(names, ['records.get']);
});

test('type maps exist', () => {
  const cap: keyof CapMap = 'records.get';
  const ev: keyof EventMap = 'record.updated';
  const code: KnownErrorCode = 'internal.not_implemented';
  assert.deepEqual([cap, ev, code], ['records.get', 'record.updated', 'internal.not_implemented']);
});

test('compiled validators reject bad input and accept the example', () => {
  assert.ok(validateInput('records.get', 1, {}).length > 0);
  const ex = registry.capabilities.find((c) => c.name === 'records.get');
  assert.ok(ex);
  assert.deepEqual(validateInput('records.get', 1, ex.examples[0]?.input), []);
  assert.ok(validateEvent('record.created', { nope: 1 }).length > 0);
});

test('registry.json shares schemas instead of inlining them', () => {
  assert.ok(registry.$defs && Object.keys(registry.$defs).length > 50);
  assert.ok(readFileSync(new URL('../../../generated/registry.json', import.meta.url)).length < 5_000_000);
});

test('screen index and probes agree; every screen with perf has a probe', () => {
  const probes = JSON.parse(readFileSync(new URL('../../../generated/probes.json', import.meta.url), 'utf8')) as { probes: Array<{ id: string }> };
  const ids = new Set(probes.probes.map((p) => p.id));
  for (const s of screens) if (s.perf) assert.ok(ids.has(`screen.${s.id}`), s.id);
  assert.equal(screens.length, registry.screens.length);
});

test('block registry renders fallbacks and unknown types with the trace id', () => {
  assert.equal(blockRegistry.length, registry.blocks.length);
  const t: keyof BlockDataMap = 'record_card';
  assert.ok(blockRegistry.some((b) => b.type === t));
  assert.match(renderFallback('nope', {}, 'abc'), /trace abc/);
  assert.equal(renderFallback('record_card', { title: 'Elena', type: 'contact' }, 'abc'), 'Elena (contact)');
});

test('sync config covers entities and record types', () => {
  assert.equal(syncEntities.length, registry.entities.length + registry.recordTypes.length);
  const mail = syncEntities.find((e) => e.key === 'mail_message');
  assert.equal(mail?.acl.multi, true);
  assert.deepEqual(syncEntities.find((e) => e.key === 'conversation')?.acl.fallback, { resource: 'mailbox', field: 'mailboxIds' });
});

test('vault levels follow their own ladder', () => {
  assert.equal(levelIncludes('vault_item', 'view', 'use'), true);
  assert.equal(levelIncludes('vault_item', 'use', 'view'), false);
  assert.equal(levelIncludes('record', 'use', 'view'), true);
  assert.deepEqual([...ladderFor('vault_folder')], ['use', 'view', 'edit', 'manage']);
});
