// What the Space defers (ruling 60): a capability is deferred when the host registered a refusing handler for it (host/src/routes/deferred.ts), and the host hands the list, with the modules
// whose every capability is deferred, to a signed-in client on identity.whoami. A whole module is a place the app hides (Sites); a place with one deferred action keeps showing (Vault import).

export interface DeferredSet {
  /** The deferred capability names. */
  readonly caps: ReadonlySet<string>;
  /** The modules whose every capability is deferred. */
  readonly deferredModules: ReadonlySet<string>;
  isDeferred(cap: string): boolean;
  isModuleDeferred(module: string): boolean;
}

export function createDeferred(deferredCaps: readonly string[] = [], deferredModules: readonly string[] = []): DeferredSet {
  const caps = new Set(deferredCaps);
  const modules = new Set(deferredModules);
  return { caps, deferredModules: modules, isDeferred: (cap) => caps.has(cap), isModuleDeferred: (m) => modules.has(m) };
}

/** Nothing deferred: what a client has before the bootstrap answers, or against a host that sends no list. */
export const NOTHING_DEFERRED: DeferredSet = createDeferred();
