// health.run executes every manifest check. A failing check returns that check's next step.
import test from 'node:test';
import assert from 'node:assert/strict';
import { VyreErr } from '../../../host/src/routes/errors.ts';
import { healthCtx } from '../fixtures/ctx.ts';
import { CHECKS, resetHealth, setProbeOverride } from '../handlers/checks.ts';
import { handlers } from '../impl.ts';

const run = handlers['health.run'];
const doctor = handlers['health.doctor'];
const status = handlers['health.status'];
const history = handlers['health.history'];
const paused = handlers['health.paused_reasons'];

test('health.run executes every manifest health check and carries next-step text', async () => {
  const ctx = healthCtx('checks-all');
  resetHealth(ctx.space);
  const out = await run(ctx, {});
  assert.deepEqual(out.checks.map((c) => c.key), CHECKS.map((c) => c.key));
  for (const row of out.checks) {
    const def = CHECKS.find((c) => c.key === row.key);
    assert.ok(def);
    assert.equal(row.state, 'healthy');
    assert.equal(row.next, def.next);
    assert.equal(row.module, row.key.slice(0, row.key.indexOf('.')));
    assert.equal(row.checkedAt, 1760000000000);
  }
  const listed = await status(ctx, {});
  assert.equal(listed.overall, 'healthy');
  assert.equal(listed.checks.length, CHECKS.length);
});

test('every failing check returns its next step', async () => {
  const ctx = healthCtx('checks-fail');
  resetHealth(ctx.space);
  setProbeOverride(ctx.space, 'health.disk_encrypted', { state: 'down' });
  setProbeOverride(ctx.space, 'health.disk_space', { freeBytes: 100, state: 'healthy' });
  setProbeOverride(ctx.space, 'health.time_skew', { skewMs: 400_000 });
  setProbeOverride(ctx.space, 'health.events_db', { state: 'down' });

  const out = await run(ctx, {});
  const failing = out.checks.filter((c) => c.state !== 'healthy');
  assert.ok(failing.length >= 4);
  for (const row of failing) {
    const def = CHECKS.find((c) => c.key === row.key);
    assert.ok(def);
    assert.equal(row.next, def.next);
    assert.ok(row.next.length > 0);
  }

  const disk = out.checks.find((c) => c.key === 'host.disk_space');
  assert.equal(disk?.state, 'down');
  assert.equal(disk?.next, 'Free disk space or extend the volume.');
  const enc = out.checks.find((c) => c.key === 'host.disk_encrypted');
  assert.equal(enc?.state, 'down');
  assert.equal(enc?.next, 'Enable FileVault or LUKS for the data directory, then run vyre-server doctor.');
  const skew = out.checks.find((c) => c.key === 'host.time_skew');
  assert.equal(skew?.state, 'down');
  assert.equal(skew?.next, 'Fix the server clock (NTP).');
  const search = out.checks.find((c) => c.key === 'search.index');
  assert.equal(search?.state, 'down');
  assert.equal(search?.detail, 'Waiting on kernel.events_db');
  assert.equal(search?.next, 'Rebuild the index with vyre rebuild --projection search.fts.');

  const doc = await doctor(ctx, {});
  assert.equal(doc.ok, false);
  assert.equal(doc.findings.length, CHECKS.length);
  for (const finding of doc.findings) {
    if (finding.state === 'healthy') continue;
    const def = CHECKS.find((c) => c.key === finding.key);
    assert.equal(finding.next, def?.next);
    assert.ok(finding.next.length > 0);
  }

  const reasons = await paused(ctx, {});
  assert.deepEqual(
    reasons.paused.map((p) => p.area).sort(),
    ['automations', 'sync'],
  );
  assert.ok(reasons.paused.every((p) => p.key === 'kernel.events_db' && p.reason.includes('Run vyre-server doctor')));

  const samples = await history(ctx, { key: 'host.disk_space', sinceMs: 1760000000000 });
  assert.equal(samples.samples.length, 1);
  assert.equal(samples.samples[0]?.state, 'down');

  const changed = ctx.events.filter((e) => e.name === 'health.changed').length;
  assert.ok(changed >= failing.length);
  ctx.events.length = 0;
  await run(ctx, {});
  assert.equal(ctx.events.filter((e) => e.name === 'health.changed').length, 0);
});

test('health.run rejects an unknown check key', async () => {
  const ctx = healthCtx('checks-missing');
  resetHealth(ctx.space);
  await assert.rejects(
    () => run(ctx, { key: 'missing.check' }),
    (e: unknown) => e instanceof VyreErr && e.error.code === 'validation.not_found',
  );
});

test('probe handlers return a state', async () => {
  const ctx = healthCtx('checks-probes');
  resetHealth(ctx.space);
  const encrypted = await handlers['health.disk_encrypted'](ctx, {});
  const events = await handlers['health.events_db'](ctx, {});
  const index = await handlers['health.index_db'](ctx, {});
  const scheduler = await handlers['health.scheduler'](ctx, {});
  const docker = await handlers['health.docker'](ctx, {});
  const caddy = await handlers['health.caddy'](ctx, {});
  for (const out of [encrypted, events, index, scheduler, docker, caddy]) {
    assert.equal(out.state, 'healthy');
    assert.equal(typeof out.latencyMs, 'number');
  }
  const disk = await handlers['health.disk_space'](ctx, {});
  assert.equal(disk.state, 'healthy');
  assert.equal(typeof disk.freeBytes, 'number');
  const skew = await handlers['health.time_skew'](ctx, {});
  assert.equal(skew.state, 'healthy');
  assert.equal(skew.skewMs, 0);
});
