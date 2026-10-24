// Loads every generated entry point so a broken or unreachable generated file fails a test, and checks the pieces agree.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
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
import { registry, registryHash } from '../../../generated/registry.ts';

test('registry hash matches registry.json', () => {
  const text = readFileSync(new URL('../../../generated/registry.json', import.meta.url), 'utf8');
  assert.equal(createHash('sha256').update(text).digest('hex'), registryHash);
  assert.equal(readFileSync(new URL('../../../generated/hash.txt', import.meta.url), 'utf8').trim(), registryHash);
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
