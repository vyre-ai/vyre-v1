// Golden output for outputs 1, 2, 3, 13 on the two-module fixture: registry, route table, handler types, entity DDL.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRegistry } from '../src/build.ts';
import { emitAll } from '../src/emit.ts';
import { loaded } from './fixture.ts';

const files = () => emitAll(buildRegistry(loaded()));

test('registry lists both modules, capabilities sorted, requires derived', () => {
  const reg = JSON.parse(files().get('registry.json') as string) as { modules: Array<{ id: string; requires: string[] }>; capabilities: Array<{ name: string }> };
  assert.deepEqual(reg.capabilities.map((c) => c.name), ['alpha.create', 'alpha.get', 'alpha.ping', 'beta.notify', 'beta.release']);
  assert.deepEqual(reg.modules.find((m) => m.id === 'alpha')?.requires, ['beta']);
});

test('route table has one POST route per capability', () => {
  const routes = files().get('routes.ts') as string;
  for (const p of ['/v1/alpha/get', '/v1/alpha/create', '/v1/beta/notify']) assert.ok(routes.includes(`"path": "${p}"`), p);
});

test('handler types list exactly the module capabilities', () => {
  const h = files().get('modules/alpha/handlers.ts') as string;
  assert.match(h, /"alpha.create": Handler<"alpha.create", X>;/);
  assert.ok(!h.includes('beta.notify'));
});

test('schema.sql has the entity table and its field-meta table', () => {
  const m = loaded();
  const a = m[0]?.manifest;
  assert.ok(a);
  a.entities = [{ key: 'thing', table: 'alpha_thing', idPrefix: 'thg_', fields: { name: { type: 'text' } }, acl: { resource: 'space' }, sync: { profile: { desktop: 'all', phone: 'all', web: 'all' } } }];
  const sql = emitAll(buildRegistry(m)).get('modules/alpha/schema.sql') as string;
  assert.match(sql, /CREATE TABLE IF NOT EXISTS "alpha_thing"/);
  assert.match(sql, /"alpha_thing__fm"/);
});

test('the permission catalogue loads independently of the filesystem registry for browser clients', async () => {
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const { pathToFileURL } = await import('node:url');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vyre-permission-catalogue-'));
  const reg = buildRegistry(loaded());
  try {
    const file = path.join(dir, 'permissions.ts');
    fs.writeFileSync(file, emitAll(reg).get('permissions.ts')!);
    const result = await import(pathToFileURL(file).href);
    assert.deepEqual(result.permissions, reg.permissions);
    assert.equal(result.roleDefaults['alpha.edit'].member, true);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
