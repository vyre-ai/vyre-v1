// Merge manifests into the registry. Module status is runtime state in host/modules.json and never enters the registry (ruling 25).
import type { Manifest, Owned, Registry, RegistryModule } from '../../../packages/contracts/src/index.ts';
import { DEFAULT_LADDER, ERROR_CODES, LEVEL_LADDERS } from '../../../packages/contracts/src/index.ts';
import type { Loaded } from './load.ts';
import { refsOf } from './refs.ts';

function flat<T extends object>(ms: Manifest[], pick: (m: Manifest) => T[] | undefined): Owned<T>[] {
  return ms.flatMap((m) => (pick(m) ?? []).map((i) => ({ ...i, module: m.id })));
}

function by<T>(items: T[], k: (t: T) => string): T[] {
  return [...items].sort((a, b) => (k(a) < k(b) ? -1 : k(a) > k(b) ? 1 : 0));
}

export function buildRegistry(loaded: Loaded[]): Registry {
  const ms = loaded.map((l) => l.manifest);
  const capOwner = new Map<string, string>();
  const eventOwner = new Map<string, string>();
  for (const m of ms) {
    for (const c of m.capabilities ?? []) capOwner.set(c.name, m.id);
    for (const e of m.events ?? []) eventOwner.set(e.name, m.id);
  }
  const modules: RegistryModule[] = ms.map((m) => {
    const refs = refsOf(m);
    const req = new Set(Object.keys(m.requires ?? {}));
    for (const c of refs.caps) { const o = capOwner.get(c); if (o && o !== m.id) req.add(o); }
    for (const e of refs.events) { const o = eventOwner.get(e); if (o && o !== m.id) req.add(o); }
    return { id: m.id, version: m.version, title: m.title, kind: m.kind, owner: m.owner, requires: [...req].sort() };
  });
  return {
    registryVersion: 1,
    levelLadders: { default: [...DEFAULT_LADDER], ...Object.fromEntries(Object.entries(LEVEL_LADDERS).map(([k, v]) => [k, [...(v ?? [])]])) },
    modules: by(modules, (m) => m.id),
    capabilities: by(flat(ms, (m) => m.capabilities), (c) => `${c.name}@${String(c.v).padStart(4, '0')}`),
    events: by(flat(ms, (m) => m.events), (e) => e.name),
    permissions: by(flat(ms, (m) => m.permissions), (p) => p.key),
    entities: by(flat(ms, (m) => m.entities), (e) => e.key),
    recordTypes: by(flat(ms, (m) => m.recordTypes), (r) => r.key),
    fieldTypes: by(flat(ms, (m) => m.fieldTypes), (f) => f.key),
    viewKinds: by(flat(ms, (m) => m.viewKinds), (v) => v.key),
    steps: by(flat(ms, (m) => m.steps), (s) => s.key),
    triggers: by(flat(ms, (m) => m.triggers), (s) => s.key),
    connectors: by(flat(ms, (m) => m.connectors), (s) => s.key),
    agentTools: by(flat(ms, (m) => m.agentTools), (s) => s.name),
    blocks: by(flat(ms, (m) => m.blocks), (s) => s.type),
    screens: by(flat(ms, (m) => m.screens), (s) => s.id),
    health: by(flat(ms, (m) => m.health), (s) => s.key),
    gateActs: by(flat(ms, (m) => m.gateActs), (s) => s.key),
    taskKinds: by(flat(ms, (m) => m.taskKinds), (s) => s.key),
    notificationKinds: by(flat(ms, (m) => m.notificationKinds), (s) => s.key),
    importSources: by(flat(ms, (m) => m.importSources), (s) => s.key),
    settings: by(flat(ms, (m) => m.settings), (s) => s.key),
    retention: by(flat(ms, (m) => m.retention), (s) => s.key),
    lists: by(flat(ms, (m) => m.lists), (s) => s.type),
    errors: ERROR_CODES.map((e) => ({ code: e.code, group: e.group, http: e.http, retryable: e.retryable, summary: e.summary })).sort((a, b) => (a.code < b.code ? -1 : 1)),
  };
}
