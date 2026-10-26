// The secret scan: every rule finds a seeded secret, the fake marker allows a line only in a test, fixture or sample path, and a clean file passes. Secrets are built from parts so this file holds none.
import test from 'node:test';
import assert from 'node:assert/strict';
import { RULES, markerCounts, scanFiles, scanText } from './secret-scan.ts';

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
const MARK = 'secret-scan: fake';

test('every rule has a seeded secret that fails the scan', () => {
  assert.deepEqual(Object.keys(seeded).sort(), RULES.map((r) => r.id).sort());
  for (const [id, secret] of Object.entries(seeded)) {
    const hits = scanText('src/x.ts', `const token = "${secret}";`);
    assert.ok(hits.some((h) => h.rule === id), `${id} is found`);
  }
});

test('a hit never prints more than four characters of the secret', () => {
  const [h] = scanText('src/x.ts', seeded['github-token']!);
  assert.equal(h!.sample, 'ghp_...');
});

test('a clean file passes', () => {
  assert.deepEqual(scanText('src/x.ts', 'const a = 1; // nothing here'), []);
});

test('the fake marker on the line, or the line before, allows a hit in a test, fixture or sample file', () => {
  const secret = seeded['aws-access-key-id']!;
  for (const file of ['agent/tests/a.test.ts', 'modules/x/fixtures/harness.ts', 'host/src/seams/seams.test.ts', 'golden/steps/07-agent-gate.ts', 'apps/app/src/places/vault/layout/sample.ts']) {
    assert.ok(markerCounts(file), file);
    assert.deepEqual(scanText(file, `const k = "${secret}"; // ${MARK}`), [], `${file}: same line`);
    assert.deepEqual(scanText(file, `// ${MARK}\nconst k = "${secret}";`), [], `${file}: line before`);
    assert.equal(scanText(file, `// ${MARK}\n\nconst k = "${secret}";`).length, 1, `${file}: the marker does not reach two lines down`);
  }
});

test('a marked fake in a production path still fails: production code can never exempt itself', () => {
  const secret = seeded['github-token']!;
  for (const file of ['host/src/daemon/daemon.ts', 'modules/vault/handlers/items.ts', 'kernel/src/seal/box.ts']) {
    assert.equal(markerCounts(file), false, file);
    assert.equal(scanText(file, `const k = "${secret}"; // ${MARK}`).length, 1, file);
  }
  assert.equal(scanFiles(new Map([['host/src/a.ts', `x = "${secret}" // ${MARK}`], ['host/tests/a.test.ts', `x = "${secret}" // ${MARK}`]])).map((h) => h.file).join(), 'host/src/a.ts');
});
