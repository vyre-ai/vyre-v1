// npm allowlist (MIT, Apache, BSD, ISC, MPL file-level) and cargo deny output.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ALLOWED_LICENSES, checkNpmLicenses, evaluateLicense, parseCargoDeny } from './license-check.ts';

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
    { name: 'blueoak', license: 'BlueOak-1.0.0' },
    { name: 'unlicense', license: 'Unlicense' },
    { name: 'zlib', license: 'Zlib' },
    { name: 'pako', license: '(MIT AND Zlib)' },
    { name: 'mixed', license: 'MIT AND GPL-3.0-only' },
    { name: 'apache', license: 'Apache-2.0' },
    { name: 'bsd2', license: 'BSD-2-Clause' },
    { name: 'bsd3', license: 'BSD-3-Clause' },
    { name: 'isc', license: 'ISC' },
    { name: 'mpl', license: 'MPL-2.0' },
    { name: 'none', license: '' },
  ]);
  const by = new Map(hits.map((h) => [h.name, h]));
  assert.equal(by.get('mit0')?.ok, true, 'MIT-0 (nodemailer) is permissive');
  for (const n of ['blueoak', 'unlicense', 'zlib', 'pako']) assert.equal(by.get(n)?.ok, true, `${n} is allowed`);
  assert.equal(by.get('mixed')?.ok, false, 'an AND expression needs every part allowed');
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

// ruling 84: 0BSD and Python-2.0 are permissive and allowed; CC-BY-4.0 is a data licence, allowed only for the data packages (caniuse-lite)
test('0BSD is allowed (tslib, jsc-safe-url)', () => {
  const hits = checkNpmLicenses([{ name: 'tslib', license: '0BSD' }, { name: 'jsc-safe-url', license: '0BSD' }]);
  assert.deepEqual(hits.map((h) => h.ok), [true, true]);
});

test('Python-2.0 is allowed (argparse)', () => {
  assert.equal(checkNpmLicenses([{ name: 'argparse', license: 'Python-2.0' }])[0]?.ok, true);
});

test('CC-BY-4.0 is allowed for the data package caniuse-lite', () => {
  assert.equal(checkNpmLicenses([{ name: 'caniuse-lite', license: 'CC-BY-4.0' }])[0]?.ok, true);
});

test('CC-BY-4.0 on a package that is not a data package is blocked', () => {
  const hit = checkNpmLicenses([{ name: 'some-code-library', license: 'CC-BY-4.0' }])[0];
  assert.equal(hit?.ok, false);
  assert.match(hit?.reason ?? '', /CC-BY-4\.0/);
  assert.equal(evaluateLicense('CC-BY-4.0').ok, false, 'with no package name it is blocked too');
});

test('the copyleft licences stay blocked next to the new ones', () => {
  assert.equal(checkNpmLicenses([{ name: 'x', license: '(0BSD AND GPL-3.0-only)' }])[0]?.ok, false);
});
