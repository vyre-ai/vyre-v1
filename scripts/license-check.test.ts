// npm allowlist (MIT, Apache, BSD, ISC, MPL file-level) and cargo deny output.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ALLOWED_LICENSES, checkNpmLicenses, parseCargoDeny } from './license-check.ts';

test('AGPL and GPL are blocked and the allowlist licenses pass', () => {
  assert.ok(ALLOWED_LICENSES.includes('MIT'));
  assert.ok(ALLOWED_LICENSES.includes('Apache-2.0'));
  assert.ok(ALLOWED_LICENSES.includes('ISC'));
  assert.ok(ALLOWED_LICENSES.includes('MPL-2.0'));
  const hits = checkNpmLicenses([
    { name: 'agpl', license: 'AGPL-3.0-only' },
    { name: 'gpl', license: 'GPL-3.0-only' },
    { name: 'sspl', license: 'SSPL-1.0' },
    { name: 'mit', license: 'MIT' },
    { name: 'mit0', license: 'MIT-0' },
    { name: 'apache', license: 'Apache-2.0' },
    { name: 'bsd2', license: 'BSD-2-Clause' },
    { name: 'bsd3', license: 'BSD-3-Clause' },
    { name: 'isc', license: 'ISC' },
    { name: 'mpl', license: 'MPL-2.0' },
    { name: 'none', license: '' },
  ]);
  const by = new Map(hits.map((h) => [h.name, h]));
  assert.equal(by.get('mit0')?.ok, true, 'MIT-0 (nodemailer) is permissive');
  assert.equal(by.get('agpl')?.ok, false);
  assert.match(by.get('agpl')?.reason ?? '', /AGPL/);
  assert.equal(by.get('gpl')?.ok, false);
  assert.match(by.get('gpl')?.reason ?? '', /GPL/);
  assert.equal(by.get('sspl')?.ok, false);
  assert.equal(by.get('none')?.ok, false);
  for (const name of ['mit', 'apache', 'bsd2', 'bsd3', 'isc', 'mpl']) {
    assert.equal(by.get(name)?.ok, true, name);
  }
  assert.equal(by.get('mpl')?.fileLevel, true);
  assert.match(by.get('mpl')?.reason ?? '', /file level/);
  assert.equal(by.get('mit')?.fileLevel, false);
  assert.equal(by.get('apache')?.fileLevel, false);
});

test('cargo deny output is parsed', () => {
  const text = [
    'error[rejected]: failed to satisfy license requirements',
    '  ├ AGPL-3.0-only: 1',
    '  │  └─ agpl-thing 1.0.0',
    '  └ GPL-3.0-only: 1',
    '     └─ gpl-thing 2.0.0',
  ].join('\n');
  const hits = parseCargoDeny(text);
  assert.equal(hits.length, 2);
  assert.equal(hits[0]?.crate, 'agpl-thing');
  assert.equal(hits[0]?.version, '1.0.0');
  assert.equal(hits[0]?.license, 'AGPL-3.0-only');
  assert.equal(hits[0]?.ok, false);
  assert.match(hits[0]?.reason ?? '', /AGPL/);
  assert.equal(hits[1]?.crate, 'gpl-thing');
  assert.equal(hits[1]?.version, '2.0.0');
  assert.equal(hits[1]?.license, 'GPL-3.0-only');
  assert.equal(hits[1]?.ok, false);
  assert.match(hits[1]?.reason ?? '', /GPL/);

  const json = JSON.stringify({
    type: 'diagnostic',
    fields: {
      severity: 'error',
      code: 'rejected',
      message: 'license is not explicitly allowed',
      labels: [{ span: 'gpl-crate 3.1.4', message: 'license expression: GPL-3.0-only' }],
    },
  });
  const parsed = parseCargoDeny(json);
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0]?.crate, 'gpl-crate');
  assert.equal(parsed[0]?.version, '3.1.4');
  assert.equal(parsed[0]?.license, 'GPL-3.0-only');
  assert.equal(parsed[0]?.ok, false);

  const diag = [
    'error[rejected]: license is not explicitly allowed',
    '   ┌─ agpl-crate 0.9.1 (registry+https://github.com/rust-lang/crates.io-index):',
    '   │',
    '   │ license expression: AGPL-3.0-only',
  ].join('\n');
  const boxed = parseCargoDeny(diag);
  assert.equal(boxed.length, 1);
  assert.equal(boxed[0]?.crate, 'agpl-crate');
  assert.equal(boxed[0]?.license, 'AGPL-3.0-only');
  assert.equal(boxed[0]?.ok, false);
});
