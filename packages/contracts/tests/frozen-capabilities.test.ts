// @reads /generated/registry.json
// @reads /docs/frozen/snapshots
// Freeze review A (P-PR_34): every capability is complete (schemas, examples, errors, effects, level, a gate where it speaks), and the contract of each capability is frozen in
// docs/frozen/snapshots/<manifest>.json (lib/snapshot.ts): one small file per manifest, so a change to one capability touches one line of one file and two branches that change different
// manifests never conflict. The regen bot writes the files; this test fails on a missing, changed or stray one, naming the capability.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { SNAPSHOT_DIR, snapshotDrift } from '../../../lib/snapshot.ts';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const read = (f: string) => readFileSync(root + f, 'utf8');
const reg = JSON.parse(read('generated/registry.json')) as {
  $defs: Record<string, unknown>;
  modules: { id: string; owner: string }[];
  events: { name: string; module: string }[];
  capabilities: {
    name: string; v: number; module: string; input: unknown; output: unknown; errors: string[]; effects: string; level: string;
    permission: string | null; idempotency: string; gate?: { act: string; reason?: string }; examples: unknown[];
  }[];
};

test('every capability and event matches its snapshot in docs/frozen/snapshots', () => {
  const have = new Map<string, string>();
  for (const name of readdirSync(root + SNAPSHOT_DIR)) have.set(`${SNAPSHOT_DIR}/${name}`, read(`${SNAPSHOT_DIR}/${name}`));
  assert.deepEqual(snapshotDrift(reg, have), [], 'a contract changed without its snapshot: the regen bot writes them (node tools/gen/src/cli.ts --snapshots)');
});

test('capability names are unique', () => {
  const names = reg.capabilities.map((c) => c.name);
  assert.equal(new Set(names).size, names.length);
});

test('no capability without examples; every capability has schemas, errors, effects and level', () => {
  for (const c of reg.capabilities) {
    assert.ok(c.examples.length >= 1, `${c.name}: no examples`);
    assert.ok(c.input && typeof c.input === 'object', `${c.name}: no input schema`);
    assert.ok(c.output && typeof c.output === 'object', `${c.name}: no output schema`);
    assert.ok(c.errors.length >= 1, `${c.name}: no declared errors`);
    assert.ok(['read', 'write', 'outward'].includes(c.effects), `${c.name}: bad effects ${c.effects}`);
    assert.ok(typeof c.level === 'string' && c.level.length > 0, `${c.name}: no level`);
    assert.ok(c.permission === null || (typeof c.permission === 'string' && c.permission.length > 0), `${c.name}: bad permission`);
  }
});

test('every outward capability has a gate, and a gate of none gives a reason', () => {
  for (const c of reg.capabilities) {
    if (c.effects === 'outward') assert.ok(c.gate, `${c.name}: outward without a gate`);
    if (c.gate?.act === 'none') assert.ok(c.gate.reason && c.gate.reason.trim().length > 0, `${c.name}: gate none without a reason`);
  }
});

test('every key-idempotent capability takes an idempotencyKey', () => {
  const has = (s: unknown, seen: string[] = []): boolean => {
    if (Array.isArray(s)) return s.some((v) => has(v, seen));
    if (!s || typeof s !== 'object') return false;
    const o = s as Record<string, unknown>;
    if (o.properties && typeof o.properties === 'object' && 'idempotencyKey' in (o.properties as object)) return true;
    if (typeof o.$ref === 'string') {
      const k = o.$ref.split('/').pop()!;
      return !seen.includes(k) && has(reg.$defs[k], [...seen, k]);
    }
    return Object.values(o).some((v) => has(v, seen));
  };
  for (const c of reg.capabilities) if (c.idempotency === 'key') assert.ok(has(c.input), `${c.name}: idempotency key but no idempotencyKey input`);
});
