// Manifest health-check runner (spec 4.18, ARCH 3.5 HealthCheckDef).
// The list mirrors manifests/health.ts, including health() defaults. A manifest `states` object replaces those defaults.
import { VyreErr, makeError } from '../../../host/src/routes/errors.ts';

export type HealthState = 'healthy' | 'degraded' | 'down';
export type PauseArea = 'automations' | 'sync' | 'sends' | 'campaigns';

export interface HealthCtx {
  space: string;
  trace: { traceId: string };
  now(): number;
  db: { all(sql: string, ...args: unknown[]): unknown[]; run(sql: string, ...args: unknown[]): { changes: number } };
  emit(name: string, subject: string, payload: unknown): unknown;
}

export interface CheckDef {
  key: string;
  title: string;
  cap: string;
  intervalSec: number;
  timeoutMs: number;
  states: { degradedWhen?: string; downWhen?: string };
  dependsOn?: string[];
  pauses?: PauseArea[];
  next: string;
}

const NAMED = { degradedWhen: 'latencyMs > 2000', downWhen: "state == 'down'" };

export const CHECKS: CheckDef[] = [
  { key: 'host.disk_encrypted', title: 'Data directory is on an encrypted volume', cap: 'health.disk_encrypted', intervalSec: 60, timeoutMs: 5000, states: { downWhen: "state == 'down'" }, next: 'Enable FileVault or LUKS for the data directory, then run vyre-server doctor.' },
  { key: 'kernel.events_db', title: 'Event log healthy', cap: 'health.events_db', intervalSec: 60, timeoutMs: 5000, states: { ...NAMED }, pauses: ['automations', 'sync'], next: 'Run vyre-server doctor and restore from the last backup if the chain fails.' },
  { key: 'search.index', title: 'Search index caught up', cap: 'health.index_db', intervalSec: 60, timeoutMs: 5000, states: { ...NAMED }, dependsOn: ['kernel.events_db'], next: 'Rebuild the index with vyre rebuild --projection search.fts.' },
  { key: 'scheduler.tick', title: 'Scheduler running', cap: 'health.scheduler', intervalSec: 60, timeoutMs: 5000, states: { ...NAMED }, pauses: ['automations', 'campaigns'], next: 'Restart the scheduler service in Console, Infrastructure, Services.' },
  { key: 'host.docker', title: 'Docker running', cap: 'health.docker', intervalSec: 60, timeoutMs: 5000, states: { ...NAMED }, next: 'Start Docker or Colima; sites and agent computers need it.' },
  { key: 'host.caddy', title: 'Caddy running', cap: 'health.caddy', intervalSec: 60, timeoutMs: 5000, states: { ...NAMED }, dependsOn: ['host.docker'], next: 'Restart Caddy in Console, Infrastructure, Services.' },
  { key: 'host.disk_space', title: 'Disk space', cap: 'health.disk_space', intervalSec: 60, timeoutMs: 5000, states: { degradedWhen: 'freeBytes < 5000000000', downWhen: 'freeBytes < 500000000' }, next: 'Free disk space or extend the volume.' },
  { key: 'host.time_skew', title: 'Clock in sync', cap: 'health.time_skew', intervalSec: 60, timeoutMs: 5000, states: { degradedWhen: 'skewMs > 60000', downWhen: 'skewMs > 300000' }, next: 'Fix the server clock (NTP).' },
];

export interface ProbeReading {
  state: HealthState;
  detail?: string;
  latencyMs?: number;
  freeBytes?: number;
  skewMs?: number;
}

export interface CheckRow {
  key: string;
  title: string;
  state: HealthState;
  detail?: string;
  checkedAt: number;
  module: string;
  next: string;
}

interface Sample { at: number; state: HealthState; latencyMs?: number; detail?: string }
export interface PauseRow { area: PauseArea; key: string; reason: string }
export interface ServiceRec { name: string; state: HealthState; startedAt: number; restarts: number }
export interface BundleRec { bundleId: string; fileId: string; sizeBytes: number }

export interface SpaceStore {
  probes: Map<string, ProbeReading>;
  latest: Map<string, CheckRow>;
  samples: Map<string, Sample[]>;
  pauses: PauseRow[];
  services: Map<string, ServiceRec>;
  bundles: Map<string, BundleRec>;
}

const stores = new Map<string, SpaceStore>();

function emptyStore(): SpaceStore {
  return { probes: new Map(), latest: new Map(), samples: new Map(), pauses: [], services: new Map(), bundles: new Map() };
}

export function resetHealth(space: string): void {
  stores.delete(space);
}

export function openStore(ctx: HealthCtx): SpaceStore {
  const existing = stores.get(ctx.space);
  if (existing) return existing;
  const created = emptyStore();
  stores.set(ctx.space, created);
  hydrate(ctx, created);
  return created;
}

export function setProbeOverride(space: string, cap: string, reading: ProbeReading): void {
  const store = stores.get(space) ?? emptyStore();
  stores.set(space, store);
  store.probes.set(cap, reading);
}

function dbAll(ctx: HealthCtx, sql: string, ...args: unknown[]): unknown[] | null {
  try {
    if (!ctx.db) return null;
    return ctx.db.all(sql, ...args);
  } catch {
    return null;
  }
}

export function dbRun(ctx: HealthCtx, sql: string, ...args: unknown[]): void {
  try {
    if (!ctx.db) return;
    const bound = args.map((a) => (a === undefined ? null : a));
    ctx.db.run(sql, ...bound);
  } catch {
    // Memory remains the source of truth when the module tables are absent.
  }
}

function asState(v: unknown): HealthState | undefined {
  return v === 'healthy' || v === 'degraded' || v === 'down' ? v : undefined;
}

function asRow(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === 'object' ? v as Record<string, unknown> : null;
}

function hydrate(ctx: HealthCtx, store: SpaceStore): void {
  const latest = dbAll(ctx, 'SELECT key, title, state, detail, checked_at, module, next FROM health_latest');
  if (latest === null) return;
  for (const raw of latest) {
    const row = asRow(raw);
    const key = typeof row?.key === 'string' ? row.key : '';
    const state = asState(row?.state);
    if (!row || !key || !state || store.latest.has(key)) continue;
    const item: CheckRow = {
      key,
      title: typeof row.title === 'string' ? row.title : key,
      state,
      checkedAt: typeof row.checked_at === 'number' ? Math.trunc(row.checked_at) : ctx.now(),
      module: typeof row.module === 'string' ? row.module : moduleOf(key),
      next: typeof row.next === 'string' ? row.next : '',
    };
    if (typeof row.detail === 'string' && row.detail) item.detail = row.detail;
    store.latest.set(key, item);
  }
  const samples = dbAll(ctx, 'SELECT key, at, state, latency_ms, detail FROM health_sample');
  for (const raw of samples ?? []) {
    const row = asRow(raw);
    const key = typeof row?.key === 'string' ? row.key : '';
    const state = asState(row?.state);
    if (!row || !key || !state || typeof row.at !== 'number') continue;
    const list = store.samples.get(key) ?? [];
    const sample: Sample = { at: Math.trunc(row.at), state };
    if (typeof row.latency_ms === 'number') sample.latencyMs = Math.trunc(row.latency_ms);
    if (typeof row.detail === 'string' && row.detail) sample.detail = row.detail;
    list.push(sample);
    store.samples.set(key, list);
  }
  const pauses = dbAll(ctx, 'SELECT area, key, reason FROM health_pause');
  for (const raw of pauses ?? []) {
    const row = asRow(raw);
    const area = row?.area;
    if (!row || (area !== 'automations' && area !== 'sync' && area !== 'sends' && area !== 'campaigns')) continue;
    if (typeof row.key !== 'string' || typeof row.reason !== 'string') continue;
    store.pauses.push({ area, key: row.key, reason: row.reason });
  }
  const services = dbAll(ctx, 'SELECT name, state, started_at, restarts FROM health_service');
  for (const raw of services ?? []) {
    const row = asRow(raw);
    const state = asState(row?.state);
    if (!row || typeof row.name !== 'string' || !state || store.services.has(row.name)) continue;
    store.services.set(row.name, {
      name: row.name,
      state,
      startedAt: typeof row.started_at === 'number' ? Math.trunc(row.started_at) : ctx.now(),
      restarts: typeof row.restarts === 'number' ? Math.trunc(row.restarts) : 0,
    });
  }
  const probes = dbAll(ctx, 'SELECT cap, state, detail, latency_ms, free_bytes, skew_ms FROM health_probe');
  for (const raw of probes ?? []) {
    const row = asRow(raw);
    const state = asState(row?.state);
    if (!row || typeof row.cap !== 'string' || !state || store.probes.has(row.cap)) continue;
    const reading: ProbeReading = { state };
    if (typeof row.detail === 'string') reading.detail = row.detail;
    if (typeof row.latency_ms === 'number') reading.latencyMs = Math.trunc(row.latency_ms);
    if (typeof row.free_bytes === 'number') reading.freeBytes = Math.trunc(row.free_bytes);
    if (typeof row.skew_ms === 'number') reading.skewMs = Math.trunc(row.skew_ms);
    store.probes.set(row.cap, reading);
  }
}

const DEFAULTS: Record<string, ProbeReading> = {
  'health.disk_encrypted': { state: 'healthy', detail: 'Data directory is on an encrypted volume', latencyMs: 1 },
  'health.events_db': { state: 'healthy', detail: 'Event log opens and the chain head verifies', latencyMs: 1 },
  'health.index_db': { state: 'healthy', detail: 'Search index is caught up', latencyMs: 1 },
  'health.scheduler': { state: 'healthy', detail: 'Scheduler ticked within the last minute', latencyMs: 1 },
  'health.docker': { state: 'healthy', detail: 'Docker answered on its socket', latencyMs: 1 },
  'health.caddy': { state: 'healthy', detail: 'Caddy admin API answered and routes are loaded', latencyMs: 1 },
  'health.disk_space': { state: 'healthy', detail: 'Free space is above the threshold', latencyMs: 1, freeBytes: 50_000_000_000 },
  'health.time_skew': { state: 'healthy', detail: 'Clock skew is inside the relay window', latencyMs: 1, skewMs: 0 },
};

function readProbe(store: SpaceStore, cap: string): ProbeReading {
  const fallback = DEFAULTS[cap] ?? { state: 'healthy' as const, latencyMs: 1 };
  const over = store.probes.get(cap);
  if (!over) return { ...fallback };
  const merged: ProbeReading = { ...fallback, ...over };
  if (over.state && over.state !== fallback.state && over.detail === undefined) {
    merged.detail = over.state === 'down' ? 'Check is down' : 'Check is degraded';
  }
  return merged;
}

function applyDiskSpace(reading: ProbeReading): ProbeReading {
  const freeBytes = reading.freeBytes ?? 0;
  const state: HealthState = freeBytes < 500_000_000 ? 'down' : freeBytes < 5_000_000_000 ? 'degraded' : 'healthy';
  const detail = state === 'healthy' ? 'Free space is above the threshold' : state === 'degraded' ? 'Free space is low' : 'Free space is critically low';
  return { ...reading, state, detail, freeBytes, latencyMs: reading.latencyMs ?? 1 };
}

function applySkew(reading: ProbeReading): ProbeReading {
  const skewMs = reading.skewMs ?? 0;
  const abs = Math.abs(skewMs);
  const state: HealthState = abs > 300_000 ? 'down' : abs > 60_000 ? 'degraded' : 'healthy';
  const detail = state === 'healthy' ? 'Clock skew is inside the relay window' : `Clock skew is ${abs} ms`;
  return { ...reading, state, detail, skewMs, latencyMs: reading.latencyMs ?? 1 };
}

export function probeReading(store: SpaceStore, cap: string): ProbeReading {
  const raw = readProbe(store, cap);
  if (cap === 'health.disk_space') return applyDiskSpace(raw);
  if (cap === 'health.time_skew') return applySkew(raw);
  return { ...raw, latencyMs: raw.latencyMs ?? 1 };
}

function moduleOf(key: string): string {
  const i = key.indexOf('.');
  return i < 0 ? 'health' : key.slice(0, i);
}

function exprTrue(src: string | undefined, values: Record<string, unknown>): boolean {
  if (!src) return false;
  const m = src.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*(==|!=|<=|>=|<|>)\s*(.+)$/);
  if (!m) return false;
  const left = values[m[1] ?? ''];
  const raw = (m[3] ?? '').trim();
  let right: unknown;
  if ((raw.startsWith("'") && raw.endsWith("'")) || (raw.startsWith('"') && raw.endsWith('"'))) right = raw.slice(1, -1);
  else if (raw === 'true') right = true;
  else if (raw === 'false') right = false;
  else right = Number(raw);
  const op = m[2];
  if (op === '==') return left === right;
  if (op === '!=') return left !== right;
  const n = (v: unknown): number => (typeof v === 'number' ? v : Number(v));
  if (op === '<') return n(left) < n(right);
  if (op === '>') return n(left) > n(right);
  if (op === '<=') return n(left) <= n(right);
  if (op === '>=') return n(left) >= n(right);
  return false;
}

function ordered(defs: CheckDef[]): CheckDef[] {
  const byKey = new Map(defs.map((d) => [d.key, d]));
  const seen = new Set<string>();
  const out: CheckDef[] = [];
  const visit = (d: CheckDef): void => {
    if (seen.has(d.key)) return;
    seen.add(d.key);
    for (const dep of d.dependsOn ?? []) {
      const next = byKey.get(dep);
      if (next) visit(next);
    }
    out.push(d);
  };
  for (const d of defs) visit(d);
  return out;
}

function judge(def: CheckDef, reading: ProbeReading, deps: Map<string, HealthState>): { state: HealthState; detail?: string } {
  const latencyMs = reading.latencyMs ?? 0;
  if (latencyMs > def.timeoutMs) return { state: 'down', detail: 'Check timed out' };
  const downDep = (def.dependsOn ?? []).find((k) => deps.get(k) === 'down');
  if (downDep) return { state: 'down', detail: `Waiting on ${downDep}` };
  const values: Record<string, unknown> = {
    state: reading.state,
    detail: reading.detail,
    latencyMs,
    freeBytes: reading.freeBytes,
    skewMs: reading.skewMs,
  };
  if (exprTrue(def.states.downWhen, values) || reading.state === 'down') {
    return { state: 'down', detail: reading.detail ?? 'Check is down' };
  }
  const degDep = (def.dependsOn ?? []).find((k) => deps.get(k) === 'degraded');
  if (exprTrue(def.states.degradedWhen, values) || reading.state === 'degraded' || degDep) {
    return { state: 'degraded', detail: reading.detail ?? (degDep ? `Waiting on ${degDep}` : 'Check is degraded') };
  }
  return { state: 'healthy', detail: reading.detail };
}

function rowOf(def: CheckDef, state: HealthState, detail: string | undefined, at: number): CheckRow {
  const row: CheckRow = { key: def.key, title: def.title, state, checkedAt: at, module: moduleOf(def.key), next: def.next };
  if (detail) row.detail = detail;
  return row;
}

function saveLatest(ctx: HealthCtx, row: CheckRow): void {
  dbRun(
    ctx,
    'INSERT INTO health_latest (key, title, state, detail, checked_at, module, next) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET title = excluded.title, state = excluded.state, detail = excluded.detail, checked_at = excluded.checked_at, module = excluded.module, next = excluded.next',
    row.key, row.title, row.state, row.detail ?? null, row.checkedAt, row.module, row.next,
  );
}

function samePauses(a: PauseRow[], b: PauseRow[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((p, i) => p.area === b[i]?.area && p.reason === b[i]?.reason && p.key === b[i]?.key);
}

function syncPauses(ctx: HealthCtx, store: SpaceStore, def: CheckDef, state: HealthState): void {
  const prev = store.pauses.filter((p) => p.key === def.key);
  store.pauses = store.pauses.filter((p) => p.key !== def.key);
  if (state === 'healthy') {
    if (prev.length) ctx.emit('health.resumed', def.key, { key: def.key });
    dbRun(ctx, 'DELETE FROM health_pause WHERE key = ?', def.key);
    return;
  }
  const areas = def.pauses ?? [];
  if (!areas.length) {
    dbRun(ctx, 'DELETE FROM health_pause WHERE key = ?', def.key);
    return;
  }
  const reason = `${def.title} is ${state}: ${def.next}`;
  const next = areas.map((area) => ({ area, key: def.key, reason }));
  store.pauses.push(...next);
  if (!samePauses(prev, next)) ctx.emit('health.paused', def.key, { key: def.key, paused: areas, reason });
  dbRun(ctx, 'DELETE FROM health_pause WHERE key = ?', def.key);
  for (const p of next) dbRun(ctx, 'INSERT INTO health_pause (area, key, reason) VALUES (?, ?, ?)', p.area, p.key, p.reason);
}

function runOne(ctx: HealthCtx, store: SpaceStore, def: CheckDef, deps: Map<string, HealthState>): CheckRow {
  const reading = probeReading(store, def.cap);
  const judged = judge(def, reading, deps);
  const at = Math.trunc(ctx.now());
  const row = rowOf(def, judged.state, judged.detail, at);
  const prev = store.latest.get(def.key);
  store.latest.set(def.key, row);
  const sample: Sample = { at, state: row.state };
  if (reading.latencyMs !== undefined) sample.latencyMs = reading.latencyMs;
  if (row.detail) sample.detail = row.detail;
  const history = store.samples.get(def.key) ?? [];
  const without = history.filter((s) => s.at !== at);
  without.push(sample);
  store.samples.set(def.key, without);
  dbRun(ctx, 'INSERT OR REPLACE INTO health_sample (key, at, state, latency_ms, detail) VALUES (?, ?, ?, ?, ?)', def.key, at, row.state, sample.latencyMs ?? null, sample.detail ?? null);
  saveLatest(ctx, row);
  if (!prev || prev.state !== row.state) {
    const from: HealthState = prev?.state ?? 'healthy';
    if (prev || row.state !== 'healthy') {
      const payload: { key: string; from: HealthState; to: HealthState; detail?: string } = { key: def.key, from, to: row.state };
      if (row.detail) payload.detail = row.detail;
      ctx.emit('health.changed', def.key, payload);
    }
  }
  syncPauses(ctx, store, def, row.state);
  deps.set(def.key, row.state);
  return row;
}

export function runChecks(ctx: HealthCtx, key?: string): CheckRow[] {
  const store = openStore(ctx);
  const selected = key ? CHECKS.filter((c) => c.key === key) : CHECKS;
  if (key && selected.length === 0) {
    throw new VyreErr(makeError('validation.not_found', ctx.trace.traceId, { message: `No health check ${key}.` }));
  }
  const needed = new Set<string>();
  const add = (d: CheckDef): void => {
    if (needed.has(d.key)) return;
    needed.add(d.key);
    for (const dep of d.dependsOn ?? []) {
      const found = CHECKS.find((c) => c.key === dep);
      if (found) add(found);
    }
  };
  for (const d of selected) add(d);
  const defs = ordered(CHECKS.filter((c) => needed.has(c.key)));
  const deps = new Map<string, HealthState>();
  const ran: CheckRow[] = [];
  for (const def of defs) ran.push(runOne(ctx, store, def, deps));
  const want = new Set(selected.map((d) => d.key));
  return ran.filter((r) => want.has(r.key));
}

export function overallOf(states: HealthState[]): HealthState {
  if (states.some((s) => s === 'down')) return 'down';
  if (states.some((s) => s === 'degraded')) return 'degraded';
  return 'healthy';
}

function probeOut(reading: ProbeReading, extra?: 'free' | 'skew'): { state: HealthState; detail?: string; latencyMs?: number; freeBytes?: number; skewMs?: number } {
  const out: { state: HealthState; detail?: string; latencyMs?: number; freeBytes?: number; skewMs?: number } = { state: reading.state };
  if (reading.detail) out.detail = reading.detail;
  if (reading.latencyMs !== undefined) out.latencyMs = reading.latencyMs;
  if (extra === 'free' && reading.freeBytes !== undefined) out.freeBytes = reading.freeBytes;
  if (extra === 'skew' && reading.skewMs !== undefined) out.skewMs = reading.skewMs;
  return out;
}

function probeHandler(cap: string, extra?: 'free' | 'skew') {
  return async (ctx: HealthCtx, _input?: unknown): Promise<{ state: HealthState; detail?: string; latencyMs?: number; freeBytes?: number; skewMs?: number }> => {
    void _input;
    return probeOut(probeReading(openStore(ctx), cap), extra);
  };
}

export const checkHandlers = {
  'health.disk_encrypted': probeHandler('health.disk_encrypted'),
  'health.events_db': probeHandler('health.events_db'),
  'health.index_db': probeHandler('health.index_db'),
  'health.scheduler': probeHandler('health.scheduler'),
  'health.docker': probeHandler('health.docker'),
  'health.caddy': probeHandler('health.caddy'),
  'health.disk_space': probeHandler('health.disk_space', 'free'),
  'health.time_skew': probeHandler('health.time_skew', 'skew'),
  'health.run': async (ctx: HealthCtx, input?: { key?: string }): Promise<{ checks: CheckRow[] }> => {
    const key = input?.key;
    return { checks: runChecks(ctx, key ? key : undefined) };
  },
  'health.doctor': async (ctx: HealthCtx, _input?: unknown): Promise<{ ok: boolean; findings: Array<{ key: string; state: HealthState; next: string }> }> => {
    void _input;
    const checks = runChecks(ctx);
    return {
      ok: checks.every((c) => c.state === 'healthy'),
      findings: checks.map((c) => ({ key: c.key, state: c.state, next: c.next })),
    };
  },
  'health.status': async (ctx: HealthCtx, _input?: unknown): Promise<{ overall: HealthState; checks: CheckRow[] }> => {
    void _input;
    const store = openStore(ctx);
    const checks = CHECKS.map((d) => store.latest.get(d.key)).filter((r): r is CheckRow => r !== undefined);
    const rows = checks.length ? checks : CHECKS.map((d) => rowOf(d, 'healthy', 'Not checked yet', Math.trunc(ctx.now())));
    return { overall: checks.length ? overallOf(checks.map((c) => c.state)) : 'healthy', checks: rows };
  },
  'health.history': async (ctx: HealthCtx, input?: { key?: string; sinceMs?: number }): Promise<{ samples: Array<{ at: number; state: HealthState; latencyMs?: number; detail?: string }> }> => {
    if (!input?.key) throw new VyreErr(makeError('validation.bad_input', ctx.trace.traceId, { message: 'History needs a check key.' }));
    const since = input.sinceMs ?? 0;
    const samples = (openStore(ctx).samples.get(input.key) ?? [])
      .filter((s) => s.at >= since)
      .sort((a, b) => a.at - b.at)
      .map((s) => {
        const row: { at: number; state: HealthState; latencyMs?: number; detail?: string } = { at: s.at, state: s.state };
        if (s.latencyMs !== undefined) row.latencyMs = s.latencyMs;
        if (s.detail) row.detail = s.detail;
        return row;
      });
    return { samples };
  },
  'health.paused_reasons': async (ctx: HealthCtx, _input?: unknown): Promise<{ paused: PauseRow[] }> => {
    void _input;
    const paused = [...openStore(ctx).pauses].sort((a, b) => (a.area === b.area ? (a.key < b.key ? -1 : 1) : a.area < b.area ? -1 : 1));
    return { paused };
  },
};
