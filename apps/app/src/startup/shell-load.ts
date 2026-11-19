// The signed-in shell's module, loaded once and kept: the page starts the load as soon as it knows a session is held (startup/warm.ts), and the session gate draws the shell directly when the load is done
// instead of suspending on it (a lazy component that is not loaded yet makes React show a fallback and hold the reveal for 300 ms: r40).
type ShellModule = typeof import("../shell/session/ShellHost.tsx");
let pending: Promise<ShellModule> | null = null;
let loaded: ShellModule | null = null;

export function loadShellHost(): Promise<ShellModule> {
  pending ??= import("../shell/session/ShellHost.tsx").then(
    (m) => {
      loaded = m;
      return m;
    },
    (e: unknown) => {
      pending = null;
      throw e;
    },
  );
  return pending;
}

export const loadedShellHost = (): ShellModule | null => loaded;
