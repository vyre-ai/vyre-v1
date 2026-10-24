// Restarting a server service updates its state, uptime and restart count.
import test from 'node:test';
import assert from 'node:assert/strict';
import { VyreErr } from '../../../host/src/routes/errors.ts';
import { healthCtx } from '../fixtures/ctx.ts';
import { resetHealth } from '../handlers/checks.ts';
import { setServiceState } from '../handlers/services.ts';
import { handlers } from '../impl.ts';

const list = handlers['health.services'];
const restart = handlers['health.service_restart'];
const bundle = handlers['health.support_bundle'];

test('restart service updates status', async () => {
  const ctx = healthCtx('svc-restart');
  resetHealth(ctx.space);
  setServiceState(ctx.space, 'caddy', 'down', ctx.now() - 5_000, 2);

  const before = await list(ctx, {});
  const prior = before.services.find((s) => s.name === 'caddy');
  assert.ok(prior);
  assert.equal(prior.state, 'down');
  assert.equal(prior.restarts, 2);
  assert.equal(prior.uptimeSeconds, 5);

  const out = await restart(ctx, { service: 'caddy' });
  assert.equal(out.state, 'healthy');

  const after = await list(ctx, {});
  const next = after.services.find((s) => s.name === 'caddy');
  assert.ok(next);
  assert.equal(next.state, 'healthy');
  assert.equal(next.restarts, 3);
  assert.equal(next.uptimeSeconds, 0);
  assert.deepEqual(after.services.map((s) => s.name), ['caddy', 'docker', 'gateway', 'scheduler']);

  const emitted = ctx.events.filter((e) => e.name === 'service.restarted');
  assert.equal(emitted.length, 1);
  assert.deepEqual(emitted[0]?.payload, { service: 'caddy' });

  const again = await list(ctx, {});
  assert.equal(again.services.find((s) => s.name === 'caddy')?.state, 'healthy');
  assert.equal(again.services.find((s) => s.name === 'caddy')?.restarts, 3);
});

test('restart of a named service returns healthy', async () => {
  const ctx = healthCtx('svc-example');
  resetHealth(ctx.space);
  const out = await restart(ctx, { service: 'example' });
  assert.equal(out.state, 'healthy');
  const listed = await list(ctx, {});
  const row = listed.services.find((s) => s.name === 'example');
  assert.ok(row);
  assert.equal(row.state, 'healthy');
  assert.equal(row.restarts, 1);
  assert.equal(row.uptimeSeconds, 0);
});

test('restart rejects an empty service name', async () => {
  const ctx = healthCtx('svc-empty');
  resetHealth(ctx.space);
  await assert.rejects(
    () => restart(ctx, { service: '' }),
    (e: unknown) => e instanceof VyreErr && e.error.code === 'validation.bad_input',
  );
});

test('support bundle returns stable ids', async () => {
  const ctx = healthCtx('svc-bundle');
  resetHealth(ctx.space);
  const made = await bundle(ctx, { idempotencyKey: 'idem_1', traceIds: ['0123456789abcdef0123456789abcdef'] });
  assert.match(made.bundleId, /^bnd_[a-z0-9]+$/);
  assert.match(made.fileId, /^fil_[a-z0-9]+$/);
  const again = await bundle(ctx, { idempotencyKey: 'idem_1', traceIds: ['0123456789abcdef0123456789abcdef'] });
  assert.deepEqual(again, made);
  assert.equal(ctx.events.filter((e) => e.name === 'support_bundle.created').length, 1);
});
