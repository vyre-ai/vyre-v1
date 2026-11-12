// Ports the daemon binds on the modules it loaded, by the names the modules export (the host never imports a module). Each one, left unbound, quietly does the wrong thing in a real Space:
//   terminal.bindTeam, computers.bindTeam   unbound means "a Team Space", so a Personal Space was treated as a Team one wherever nothing else said where a turn runs (f-wire, 12 Nov)
//   engine.bindSandboxStopper               unbound, turning "let the Space use my subscription" off never stopped the person's sessions on this server (it answered sandboxStopped false)

export interface SpacePortDeps {
  /** Is this Space a Team Space? (a Space with no kind is a Team one, as everywhere in the daemon) */
  team: boolean;
  /** Stop what runs on this server on a person's subscription: their idle engine sessions close now, a turn already running ends as it would. False when this server runs no engine. */
  stopSandbox(person: string): Promise<boolean>;
}

type Ns = Record<string, unknown>;
const fn = (ns: Ns | undefined, name: string): ((...a: never[]) => unknown) | null => (ns && typeof ns[name] === "function" ? (ns[name] as (...a: never[]) => unknown) : null);

/** Bind every port this file knows on the modules that offer it; returns `<module>.<port>` for each one bound. */
export function bindSpacePorts(modules: ReadonlyMap<string, Ns>, d: SpacePortDeps): string[] {
  const bound: string[] = [];
  for (const id of ["terminal", "computers"]) {
    const bindTeam = fn(modules.get(id), "bindTeam") as ((f: ((space: string) => boolean) | null) => void) | null;
    if (bindTeam) { bindTeam(() => d.team); bound.push(`${id}.bindTeam`); }
  }
  const bindSandboxStopper = fn(modules.get("engine"), "bindSandboxStopper") as ((f: ((person: string) => Promise<boolean>) | null) => void) | null;
  if (bindSandboxStopper) { bindSandboxStopper((person) => d.stopSandbox(person)); bound.push("engine.bindSandboxStopper"); }
  return bound;
}

/** Put the module defaults back (a daemon that stops, so a later one in the same process starts clean). */
export function unbindSpacePorts(modules: ReadonlyMap<string, Ns>): void {
  for (const id of ["terminal", "computers"]) (fn(modules.get(id), "bindTeam") as ((f: null) => void) | null)?.(null);
  (fn(modules.get("engine"), "bindSandboxStopper") as ((f: null) => void) | null)?.(null);
}
