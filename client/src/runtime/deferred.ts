// What the Space defers (ruling 60): a capability is deferred when the host registered a refusing handler for it (host/src/routes/deferred.ts), and the host hands that list to a signed-in client.
// A module is deferred when every one of its capabilities is, so the app hides the whole place (Sites) and keeps a place that has one deferred action (Vault import).

export interface DeferredSet {
  /** The deferred capability names. */
  readonly caps: ReadonlySet<string>;
  /** The modules whose every capability is deferred. */
  readonly deferredModules: ReadonlySet<string>;
  isDeferred(cap: string): boolean;
  /** True when every capability of the module is deferred. */
  isModuleDeferred(module: string): boolean;
}

/** `{ module: [cap, ...] }` from registry rows (generated/registry.json capabilities). */
export function capsByModule(rows: readonly { name: string; module: string }[]): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const r of rows) (out[r.module] ??= []).push(r.name);
  return out;
}

export function createDeferred(deferredCaps: readonly string[], byModule: Readonly<Record<string, readonly string[]>>): DeferredSet {
  const caps = new Set(deferredCaps);
  const modules = new Set<string>();
  for (const [module, list] of Object.entries(byModule)) if (list.length > 0 && list.every((c) => caps.has(c))) modules.add(module);
  return { caps, deferredModules: modules, isDeferred: (cap) => caps.has(cap), isModuleDeferred: (m) => modules.has(m) };
}

/** Nothing deferred: what a client has before the bootstrap answers, or against a host that sends no list. */
export const NOTHING_DEFERRED: DeferredSet = createDeferred([], {});
