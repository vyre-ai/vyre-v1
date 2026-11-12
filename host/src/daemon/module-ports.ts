// Ports the daemon binds on the modules it loaded, by the names the modules export (the host never imports a module). Each one, left unbound, quietly does the wrong thing in a real Space:
//   terminal.bindTeam, computers.bindTeam   unbound means "a Team Space", so a Personal Space was treated as a Team one wherever nothing else said where a turn runs (f-wire, 12 Nov)
//   engine.bindSandboxStopper               unbound, turning "let the Space use my subscription" off never stopped the person's sessions on this server (it answered sandboxStopped false)

export interface SpacePortDeps {
  /** Is this Space a Team Space? (a Space with no kind is a Team one, as everywhere in the daemon) */
  team: boolean;
  /** Stop what runs on this server on a person's subscription: their idle engine sessions close now, a turn already running ends as it would. False when this server runs no engine. */
  stopSandbox(person: string): Promise<boolean>;
  /** A turn is running on this server: background work (the search re-embed) waits. */
  busy?: () => boolean;
}

type Ns = Record<string, unknown>;
const fn = (ns: Ns | undefined, name: string): ((...a: never[]) => unknown) | null => (ns && typeof ns[name] === "function" ? (ns[name] as (...a: never[]) => unknown) : null);

// Two daemons in one process (tests) share the modules: each binding is kept, the newest is the one in force, and a daemon that stops puts back the one before it instead of the defaults.
const live: Array<{ modules: ReadonlyMap<string, Ns>; d: SpacePortDeps }> = [];

/** Bind every port this file knows on the modules that offer it; returns `<module>.<port>` for each one bound. */
export function bindSpacePorts(modules: ReadonlyMap<string, Ns>, d: SpacePortDeps): string[] {
  live.push({ modules, d });
  return apply(modules, d);
}

function apply(modules: ReadonlyMap<string, Ns>, d: SpacePortDeps): string[] {
  const bound: string[] = [];
  for (const id of ["terminal", "computers"]) {
    const bindTeam = fn(modules.get(id), "bindTeam") as ((f: ((space: string) => boolean) | null) => void) | null;
    if (bindTeam) { bindTeam(() => d.team); bound.push(`${id}.bindTeam`); }
  }
  const bindSandboxStopper = fn(modules.get("engine"), "bindSandboxStopper") as ((f: ((person: string) => Promise<boolean>) | null) => void) | null;
  if (bindSandboxStopper) { bindSandboxStopper((person) => d.stopSandbox(person)); bound.push("engine.bindSandboxStopper"); }
  // search by meaning on the local model memory already loads (no AI account pays): search keeps the word-hash stand-in until the model is ready and has re-embedded everything
  const setModel = fn(modules.get("search"), "setModel") as ((m: unknown) => void) | null;
  const local = fn(modules.get("memory"), "localEmbedder") as (() => { name: string; status(): { state: string; detail?: string }; embed(t: string[]): Promise<Float32Array[]> } | null) | null;
  if (setModel && local) {
    setModel({
      get name() { return local()?.name ?? "local"; },
      status: () => local()?.status() ?? { state: "not_set_up", detail: "the local model is not set up on this server" },
      embed: (t: string[]) => { const e = local(); return e ? e.embed(t) : Promise.reject(new Error("the local model is not set up")); },
      ...(d.busy ? { busy: d.busy } : {}),
    });
    bound.push("search.setModel");
  }
  return bound;
}

/** A daemon stops: its binding goes, and the binding of a daemon still running in this process (if any) is in force again; with none left, the module defaults are back. */
export function unbindSpacePorts(modules: ReadonlyMap<string, Ns>, d?: SpacePortDeps): void {
  const at = live.findLastIndex((x) => x.modules === modules && (d === undefined || x.d === d));
  if (at >= 0) live.splice(at, 1);
  const top = live.at(-1);
  if (top) { apply(top.modules, top.d); return; }
  reset(modules);
}

function reset(modules: ReadonlyMap<string, Ns>): void {
  for (const id of ["terminal", "computers"]) (fn(modules.get(id), "bindTeam") as ((f: null) => void) | null)?.(null);
  (fn(modules.get("engine"), "bindSandboxStopper") as ((f: null) => void) | null)?.(null);
  (fn(modules.get("search"), "setModel") as ((m: null) => void) | null)?.(null);
}
