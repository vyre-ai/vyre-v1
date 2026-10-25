// @reads /generated/registry.json
// @reads /generated/hash.txt
// @reads /host/modules.json
// Freeze review A (P-PR_34): the capability registry matches docs/frozen/capabilities.md, every capability is complete,
// and the 10 percent per-lane sample recorded in the doc is the sample the rule produces.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const read = (f: string) => readFileSync(root + f, 'utf8');
const registryText = read('generated/registry.json');
const reg = JSON.parse(registryText) as {
  $defs: Record<string, unknown>;
  modules: { id: string; owner: string }[];
  events: unknown[];
  capabilities: {
    name: string; module: string; input: unknown; output: unknown; errors: string[]; effects: string; level: string;
    permission: string | null; idempotency: string; gate?: { act: string; reason?: string }; examples: unknown[];
  }[];
};
const doc = read('docs/frozen/capabilities.md');
const field = (label: string) => {
  const m = new RegExp(`^${label}: (.+)$`, 'm').exec(doc);
  assert.ok(m, `docs/frozen/capabilities.md has no "${label}:" line`);
  return m[1]!.trim();
};
const laneOf = new Map(reg.modules.map((m) => [m.id, m.owner]));

test('registry hash and counts equal docs/frozen/capabilities.md', () => {
  const hash = createHash('sha256').update(registryText).digest('hex');
  assert.equal(hash, read('generated/hash.txt').trim(), 'generated/hash.txt is not the hash of registry.json');
  assert.equal(field('Registry hash'), hash);
  assert.equal(Number(field('Capabilities')), reg.capabilities.length);
  assert.equal(Number(field('Events')), reg.events.length);
  assert.equal(Number(field('Registry modules')), reg.modules.length);
  const host = (JSON.parse(read('host/modules.json')) as { modules: unknown[] }).modules.length;
  assert.equal(Number(field('Host modules')), host);
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

test('the per-lane 10 percent sample in the doc is the sample the rule gives', () => {
  const by = new Map<string, string[]>();
  for (const c of reg.capabilities) {
    const lane = laneOf.get(c.module);
    assert.ok(lane, `${c.name}: module ${c.module} has no owner lane`);
    by.set(lane, [...(by.get(lane) ?? []), c.name]);
  }
  let total = 0;
  for (const [lane, names] of [...by].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    const sorted = [...names].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    const n = Math.ceil(sorted.length / 10), step = sorted.length / n;
    const want = Array.from({ length: n }, (_, i) => sorted[Math.floor(i * step)]!);
    const line = new RegExp(`^${lane}: (.+)$`, 'm').exec(doc);
    assert.ok(line, `no sample line for lane ${lane}`);
    assert.deepEqual(line[1]!.split(', '), want, `sample for ${lane} differs from the rule`);
    const row = new RegExp(`^\\| ${lane} \\| (\\d+) \\| (\\d+) \\|$`, 'm').exec(doc);
    assert.ok(row, `no table row for lane ${lane}`);
    assert.equal(Number(row[1]), sorted.length);
    assert.equal(Number(row[2]), n);
    total += n;
  }
  assert.ok(total >= Math.floor(reg.capabilities.length / 10), 'sample is under 10 percent overall');
});

// Run on the final commit of this packet, after merging main, so the CI log lists this file as ok.

// Run on the final commit of this packet, after merging main, so the CI log lists this file as ok.

// Run on the final commit of this packet, after merging main, so the CI log lists this file as ok.

// Run on the final commit of this packet, after merging main, so the CI log lists this file as ok.

// Run on the final commit of this packet, after merging main, so the CI log lists this file as ok.
// rerun on final commit
// run on the final commit of P-CC_33
// run on the final commit of the lanes PR
// run on the final commit of the kit stages PR
