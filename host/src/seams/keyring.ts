// The person keys this node holds (ruling 62): the signed-in person's own key, opened with their password at sign-in on their own node and kept in daemon memory only. It is never written to disk or to a log, is cleared at
// sign-out, at a password change or reset and at shutdown, and a node that is not the person's own (`allowed` says no) never takes it. The vault module reads it through its KeyPort for that person's Mine items.
export interface Keyring {
  hold(personId: string, key: Uint8Array): void;
  clear(personId: string): void;
  stage(challengeId: string, personId: string, key: Uint8Array): void;
  release(challengeId: string): void;
  /** the key, for the vault's KeyPort; null when the person is not signed in here */
  get(personId: string): Uint8Array | null;
  clearAll(): void;
}

const STAGE_MS = 5 * 60_000;

export function createKeyring(o: { allowed(personId: string): boolean; now(): number }): Keyring {
  const held = new Map<string, Uint8Array>();
  const staged = new Map<string, { person: string; key: Uint8Array; expires: number }>();
  const wipe = (k: Uint8Array | undefined): void => { k?.fill(0); };
  return {
    hold(personId, key) {
      if (!o.allowed(personId)) return;
      wipe(held.get(personId));
      held.set(personId, Uint8Array.from(key));
    },
    clear(personId) {
      wipe(held.get(personId)); held.delete(personId);
      for (const [id, s] of staged) if (s.person === personId) { wipe(s.key); staged.delete(id); }
    },
    stage(challengeId, personId, key) {
      if (!o.allowed(personId)) return;
      staged.set(challengeId, { person: personId, key: Uint8Array.from(key), expires: o.now() + STAGE_MS });
    },
    release(challengeId) {
      const s = staged.get(challengeId);
      staged.delete(challengeId);
      if (!s) return;
      if (s.expires > o.now()) { wipe(held.get(s.person)); held.set(s.person, s.key); } else wipe(s.key);
    },
    get: (personId) => held.get(personId) ?? null,
    clearAll() {
      for (const k of held.values()) wipe(k);
      for (const s of staged.values()) wipe(s.key);
      held.clear(); staged.clear();
    },
  };
}
