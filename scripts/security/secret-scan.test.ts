// The secret scan: every rule finds a seeded secret, the allowance needs a reason, and a clean file passes. Secrets are built from parts so this file holds none.
import test from 'node:test';
import assert from 'node:assert/strict';
import { RULES, allowed, checkAllowList, scanFiles, scanText } from './secret-scan.ts';

const seeded: Record<string, string> = {
  'private-key-block': ['-----BEGIN RSA', ' PRIVATE KEY-----'].join(''),
  'aws-access-key-id': ['AKIA', 'ABCDEFGHIJKLMNOP'].join(''),
  'github-token': ['gh', 'p_', 'a'.repeat(36)].join(''),
  'slack-token': ['xo', 'xb-', '1234567890-abcdefghij'].join(''),
  'stripe-live-key': ['sk', '_live_', 'a'.repeat(24)].join(''),
  'google-api-key': ['AI', 'za', 'A'.repeat(35)].join(''),
  'anthropic-or-openai-key': ['sk', '-ant-', 'a'.repeat(40)].join(''),
  'npm-token': ['npm', '_', 'a'.repeat(36)].join(''),
  'twilio-key': ['S', 'K', 'a'.repeat(32)].join(''),
};

test('every rule has a seeded secret that fails the scan', () => {
  assert.deepEqual(Object.keys(seeded).sort(), RULES.map((r) => r.id).sort());
  for (const [id, secret] of Object.entries(seeded)) {
    const hits = scanText('x.txt', `const token = "${secret}";`);
    assert.ok(hits.some((h) => h.rule === id), `${id} is found`);
  }
});

test('a hit never prints more than four characters of the secret', () => {
  const [h] = scanText('x.txt', seeded['github-token']!);
  assert.equal(h!.sample, 'ghp_...');
});

test('a clean file passes, and the inline marker allows one line', () => {
  assert.deepEqual(scanText('x.ts', 'const a = 1; // nothing here'), []);
  assert.deepEqual(scanText('x.ts', `fake("${seeded['aws-access-key-id']}") // secret-scan:allow a documented fake`), []);
});

test('a path allowance skips the file, and an allowance without a reason is refused', () => {
  const files = new Map([['fixtures/keys.txt', seeded['private-key-block']!], ['src/a.ts', seeded['github-token']!]]);
  const allow = [{ path: 'fixtures/', reason: 'fake keys for the vault scrub tests', until: '2099-01-01' }];
  assert.ok(allowed('fixtures/keys.txt', allow));
  assert.deepEqual(scanFiles(files, allow).map((h) => h.file), ['src/a.ts']);
  assert.deepEqual(checkAllowList(allow), []);
  assert.equal(checkAllowList([{ path: 'a', reason: '', until: '2099-01-01' }]).length, 1);
  assert.equal(checkAllowList([{ path: 'a', reason: 'a fake key in a test', until: 'later' }]).length, 1);
  assert.match(checkAllowList([{ path: 'a', reason: 'a fake key in a test', until: '2026-01-01' }], new Date('2026-10-26'))[0]!, /expired/);
});
