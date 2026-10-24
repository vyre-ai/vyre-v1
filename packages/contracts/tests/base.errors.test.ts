import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ERROR_CODES, ERROR_CODE_SET, VyreErr, notImplemented } from '../src/index.ts';

test('every error code has what, why, next and a stable http mapping', () => {
  assert.equal(new Set(ERROR_CODES.map((c) => c.code)).size, ERROR_CODES.length);
  const statusByGroup: Record<string, number[]> = { auth: [401], rate_limit: [429], validation: [404, 409, 422], provider: [502], timeout: [504], permission: [403, 404], internal: [500, 501, 503] };
  for (const c of ERROR_CODES) {
    assert.ok(c.what.length > 0 && c.why.length > 0 && c.next.length > 0, c.code);
    assert.ok((statusByGroup[c.group] ?? []).includes(c.http), `${c.code} http ${c.http}`);
    assert.ok(ERROR_CODE_SET.has(c.code));
  }
});

test('not-implemented carries the trace id and a next step', () => {
  const e = notImplemented('records.get', { traceId: 'a'.repeat(32) });
  assert.equal(e.code, 'internal.not_implemented');
  assert.equal(e.traceId, 'a'.repeat(32));
  assert.ok(e.next.length > 0);
  assert.equal(new VyreErr(e).error, e);
});
