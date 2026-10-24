import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canonicalJson, envelopeHash, isId, labelRank, makeId, roundTrip, withinClearance } from '../src/index.ts';
import type { EventEnvelope } from '../src/index.ts';

const env: EventEnvelope<{ recordId: string }> = {
  seq: 7, id: 'evt_0190a1', type: 'record.updated', sv: 1, hlc: '18c-0001-dev_a', at: 1760000000000, traceId: 'b'.repeat(32), actor: 'usr_maya',
  depth: 0, label: 1, vis: 'space', enc: 0, payload: { recordId: 'rec_a1b2c3' }, fields: ['status'],
};

test('envelope round trips and the hash ignores key order and seq', () => {
  const back = roundTrip(env);
  assert.deepEqual(back, env);
  const shuffled = { payload: env.payload, enc: 0, vis: 'space', label: 1, depth: 0, actor: env.actor, traceId: env.traceId, at: env.at, hlc: env.hlc, sv: 1, type: env.type, id: env.id, seq: 99, fields: env.fields } as EventEnvelope<{ recordId: string }>;
  assert.equal(envelopeHash(shuffled), envelopeHash(env));
  assert.equal(canonicalJson({ b: 1, a: undefined, c: [{ z: 1, y: 2 }] }), '{"b":1,"c":[{"y":2,"z":1}]}');
});

test('ids and labels', () => {
  assert.ok(isId('rec', makeId('rec', new Uint8Array([1, 2, 3, 40]))));
  assert.ok(!isId('usr', 'rec_abc'));
  assert.equal(labelRank('restricted'), 3);
  assert.ok(withinClearance('internal', 'confidential'));
  assert.ok(!withinClearance('restricted', 'confidential'));
});
