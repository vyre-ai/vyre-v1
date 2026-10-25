// The person key this node holds (ruling 62, 63): the signed-in person's own key, unwrapped by their client on their own computer after a password sign-in and handed to this daemon over loopback
// (host/src/routes/local-key.ts). The daemon never sees the password and never unwraps anything. The key lives in daemon memory only: never on disk or in a log, cleared at sign-out, at lock and at
// shutdown, and a node that is not the person's own (`allowed` says no) never takes it. The vault module reads it through its KeyPort for that person's Mine items.
export interface Keyring {
  hold(personId: string, key: Uint8Array): boolean;
  clear(personId: string): void;
  /** the key, for the vault's KeyPort; null when the person has not unlocked here */
  get(personId: string): Uint8Array | null;
  clearAll(): void;
}

export function createKeyring(o: { allowed(personId: string): boolean }): Keyring {
  const held = new Map<string, Uint8Array>();
  const wipe = (k: Uint8Array | undefined): void => { k?.fill(0); };
  return {
    hold(personId, key) {
      if (!o.allowed(personId) || key.length !== 32) return false;
      wipe(held.get(personId));
      held.set(personId, Uint8Array.from(key));
      return true;
    },
    clear(personId) { wipe(held.get(personId)); held.delete(personId); },
    get: (personId) => held.get(personId) ?? null,
    clearAll() { for (const k of held.values()) wipe(k); held.clear(); },
  };
}
