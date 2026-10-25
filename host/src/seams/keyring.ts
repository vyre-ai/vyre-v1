// The person key this node holds (ruling 62, 63): the signed-in person's own key, unwrapped by their client on their own computer after a password sign-in and handed to this daemon over loopback
// (host/src/routes/local-key.ts). The daemon never sees the password and never unwraps anything. The key lives in daemon memory only: never on disk or in a log. It is cleared at lock and at shutdown, and it
// lives only as long as the sessions that unlocked it: when the last of them ends (sign-out, a revoked device, a password change or reset all end sessions) the next read finds none alive, wipes the key and
// answers null. A node that is not the person's own (`allowed` says no) never takes it. The vault module reads it through its KeyPort for that person's Mine items.
export interface Keyring {
  /** `sessionId`: the session whose client handed the key over; without one (the local admin) the key stays until lock or shutdown */
  hold(personId: string, key: Uint8Array, sessionId?: string): boolean;
  clear(personId: string): void;
  /** a copy of the key, for the vault's KeyPort; null when the person has not unlocked here or every session that unlocked it has ended */
  get(personId: string): Uint8Array | null;
  /** Drop every key whose sessions have all ended, now (a timer calls this, so a signed-out person's key does not wait for a read). Answers how many keys it wiped. */
  sweep(): number;
  /** Whether a key is held for the person (no key leaves through this) */
  holds(personId: string): boolean;
  clearAll(): void;
}

interface Entry { key: Uint8Array; sessions: Set<string>; unbound: boolean }

export function createKeyring(o: { allowed(personId: string): boolean; /** is this session still signed in; omitted: sessions never end */ live?(sessionId: string): boolean }): Keyring {
  const held = new Map<string, Entry>();
  const wipe = (e: Entry | undefined): void => { e?.key.fill(0); };
  const fresh = (personId: string): Uint8Array | null => {
    const e = held.get(personId);
    if (!e) return null;
    if (o.live) for (const id of e.sessions) if (!o.live(id)) e.sessions.delete(id);
    if (!e.unbound && e.sessions.size === 0) { wipe(e); held.delete(personId); return null; }
    return Uint8Array.from(e.key);
  };
  return {
    hold(personId, key, sessionId) {
      if (!o.allowed(personId) || key.length !== 32) return false;
      const old = held.get(personId);
      wipe(old);
      held.set(personId, {
        key: Uint8Array.from(key),
        sessions: new Set([...(old?.sessions ?? []), ...(sessionId ? [sessionId] : [])]),
        unbound: sessionId === undefined || (old?.unbound ?? false),
      });
      return true;
    },
    clear(personId) { wipe(held.get(personId)); held.delete(personId); },
    get: (personId) => fresh(personId),
    sweep() {
      let n = 0;
      for (const personId of [...held.keys()]) { const had = held.has(personId); void fresh(personId); if (had && !held.has(personId)) n++; }
      return n;
    },
    holds: (personId) => held.has(personId),
    clearAll() { for (const e of held.values()) wipe(e); held.clear(); },
  };
}
