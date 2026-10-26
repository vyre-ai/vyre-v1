// The dependency audit: a seeded high advisory fails, an allowed one passes until it expires, moderate advisories never fail, and an allowance without a reason or date is refused.
import test from 'node:test';
import assert from 'node:assert/strict';
import { checkAllowList, failing, findings } from './audit.ts';

const report = {
  vulnerabilities: {
    leftpad: { severity: 'high', via: [{ url: 'https://github.com/advisories/GHSA-aaaa-bbbb-cccc' }] },
    dusty: { severity: 'moderate', via: ['leftpad'] },
    boom: { severity: 'critical', via: ['inner'] },
  },
};

test('a seeded high or critical advisory fails; moderate does not', () => {
  const list = findings(report);
  assert.deepEqual(failing(list, []).map((f) => f.name).sort(), ['boom', 'leftpad']);
});

test('an allowance by package or by advisory url clears a finding', () => {
  const list = findings(report);
  assert.deepEqual(failing(list, [{ advisory: 'leftpad', reason: 'only used in a dev tool path', until: '2099-01-01' }]).map((f) => f.name), ['boom']);
  assert.deepEqual(failing(list, [{ advisory: 'https://github.com/advisories/GHSA-aaaa-bbbb-cccc', reason: 'not reachable from the server', until: '2099-01-01' }]).map((f) => f.name), ['boom']);
});

test('an allowance with no reason, no date, or a past date is refused', () => {
  const now = new Date('2026-10-26T00:00:00Z');
  assert.equal(checkAllowList([{ advisory: 'a', reason: '', until: '2099-01-01' }], now).length, 1);
  assert.equal(checkAllowList([{ advisory: 'a', reason: 'a good reason here', until: 'soon' }], now).length, 1);
  assert.match(checkAllowList([{ advisory: 'a', reason: 'a good reason here', until: '2026-01-01' }], now)[0]!, /expired/);
  assert.deepEqual(checkAllowList([{ advisory: 'a', reason: 'a good reason here', until: '2027-01-01' }], now), []);
});
