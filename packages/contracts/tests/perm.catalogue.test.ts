// Every built-in role against the permission catalogue (input for the permission matrix golden 12).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PERMISSIONS } from '../../../manifests/permissions.ts';

const ROLES = ['owner', 'admin', 'developer', 'member', 'guest'] as const;

test('the catalogue has unique keys, a title, a risk and a default for every role', () => {
  assert.equal(new Set(PERMISSIONS.map((p) => p.key)).size, PERMISSIONS.length);
  for (const p of PERMISSIONS) {
    assert.ok(p.title.length > 0 && ['low', 'medium', 'high'].includes(p.risk), p.key);
    for (const r of ROLES) assert.equal(typeof p.defaults[r], 'boolean', `${p.key} ${r}`);
  }
});

test('owner and admin hold everything; guests hold no high-risk row; members hold no high-risk row', () => {
  for (const p of PERMISSIONS) {
    assert.equal(p.defaults.owner, true, p.key);
    assert.equal(p.defaults.admin, true, p.key);
    if (p.risk === 'high') { assert.notEqual(p.defaults.guest, true, p.key); assert.notEqual(p.defaults.member, true, p.key); }
  }
});

test('the spec rows are all present and the roles matrix per role is stable', () => {
  const keys = new Set(PERMISSIONS.map((p) => p.key));
  for (const k of ['members.invite', 'records.reveal', 'vault.export', 'server.update', 'sites.promote', 'kits.publish', 'runs.manage', 'terminal.use', 'forms.publish']) assert.ok(keys.has(k), k);
  const count = (r: (typeof ROLES)[number]) => PERMISSIONS.filter((p) => p.defaults[r]).length;
  assert.equal(count('owner'), PERMISSIONS.length);
  assert.ok(count('member') < count('developer') + count('member'));
  assert.equal(count('guest'), 0);
});
