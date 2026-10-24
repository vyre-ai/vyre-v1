// Server services list and restart (perm server.services) plus the support bundle id.
import { VyreErr, makeError } from '../../../host/src/routes/errors.ts';
import { dbRun, openStore, runChecks, type BundleRec, type HealthCtx, type HealthState, type ServiceRec } from './checks.ts';

export const SERVICE_NAMES = ['caddy', 'docker', 'gateway', 'scheduler'] as const;

export function setServiceState(space: string, name: string, state: HealthState, startedAt: number, restarts = 0): void {
  const store = openStore({
    space,
    trace: { traceId: '0'.repeat(32) },
    now: () => startedAt,
    db: { all: () => { throw new Error('no db'); }, run: () => { throw new Error('no db'); } },
    emit: () => ({}),
  });
  store.services.set(name, { name, state, startedAt, restarts });
}

function ensureServices(ctx: HealthCtx): Map<string, ServiceRec> {
  const store = openStore(ctx);
  const now = Math.trunc(ctx.now());
  for (const name of SERVICE_NAMES) {
    if (store.services.has(name)) continue;
    const rec: ServiceRec = { name, state: 'healthy', startedAt: now, restarts: 0 };
    store.services.set(name, rec);
    saveService(ctx, rec);
  }
  return store.services;
}

function saveService(ctx: HealthCtx, rec: ServiceRec): void {
  dbRun(
    ctx,
    'INSERT INTO health_service (name, state, started_at, restarts) VALUES (?, ?, ?, ?) ON CONFLICT(name) DO UPDATE SET state = excluded.state, started_at = excluded.started_at, restarts = excluded.restarts',
    rec.name, rec.state, rec.startedAt, rec.restarts,
  );
}

function view(ctx: HealthCtx, rec: ServiceRec): { name: string; state: HealthState; uptimeSeconds: number; restarts: number } {
  const uptimeSeconds = Math.max(0, Math.floor((Math.trunc(ctx.now()) - rec.startedAt) / 1000));
  return { name: rec.name, state: rec.state, uptimeSeconds, restarts: rec.restarts };
}

function slug(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 33 + s.charCodeAt(i)) >>> 0;
  const body = s.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 12);
  return `${body || 'id'}${h.toString(36)}`;
}

export const serviceHandlers = {
  'health.services': async (ctx: HealthCtx, _input?: unknown): Promise<{ services: Array<{ name: string; state: HealthState; uptimeSeconds: number; restarts: number }> }> => {
    void _input;
    const services = [...ensureServices(ctx).values()]
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
      .map((rec) => view(ctx, rec));
    return { services };
  },
  'health.service_restart': async (ctx: HealthCtx, input?: { service?: string }): Promise<{ state: HealthState }> => {
    const name = input?.service ?? '';
    if (!/^[a-z][a-z0-9_-]{0,63}$/.test(name)) {
      throw new VyreErr(makeError('validation.bad_input', ctx.trace.traceId, { message: 'Name the service to restart.' }));
    }
    const map = ensureServices(ctx);
    const prev = map.get(name);
    const rec: ServiceRec = { name, state: 'healthy', startedAt: Math.trunc(ctx.now()), restarts: (prev?.restarts ?? 0) + 1 };
    map.set(name, rec);
    saveService(ctx, rec);
    ctx.emit('service.restarted', name, { service: name });
    return { state: rec.state };
  },
  'health.support_bundle': async (ctx: HealthCtx, input?: { traceIds?: string[]; idempotencyKey?: string }): Promise<{ bundleId: string; fileId: string }> => {
    const key = input?.idempotencyKey ?? '';
    if (!key) throw new VyreErr(makeError('validation.bad_input', ctx.trace.traceId, { message: 'A support bundle needs an idempotency key.' }));
    const store = openStore(ctx);
    const prior = store.bundles.get(key);
    if (prior) return { bundleId: prior.bundleId, fileId: prior.fileId };
    const checks = runChecks(ctx);
    const id = slug(key);
    const rec: BundleRec = {
      bundleId: `bnd_${id}`,
      fileId: `fil_${id}`,
      sizeBytes: 128 + (input?.traceIds?.length ?? 0) * 64 + checks.length * 48,
    };
    store.bundles.set(key, rec);
    dbRun(
      ctx,
      'INSERT INTO health_bundle (idempotency_key, bundle_id, file_id, size_bytes, created_at) VALUES (?, ?, ?, ?, ?)',
      key, rec.bundleId, rec.fileId, rec.sizeBytes, Math.trunc(ctx.now()),
    );
    ctx.emit('support_bundle.created', rec.bundleId, { bundleId: rec.bundleId, sizeBytes: rec.sizeBytes });
    return { bundleId: rec.bundleId, fileId: rec.fileId };
  },
};
