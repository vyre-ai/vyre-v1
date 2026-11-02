// The person key a Space server may open after a Google, Microsoft or GitHub sign-in (owner ruling 3 Nov, R62 amended; RULINGS "62 (amended)" names its two risks). A member who signs in with their
// provider never types the password that wraps their key, so without this their own AI accounts would stay closed. The wrap:
//   - is made only while this server holds the key because their client handed it over after opening it with their password (the Space key door, host/src/routes/local-key.ts);
//   - is sealed (AES-256-GCM, bound to the Space and the person) under a random server secret kept in a file beside the Vault's own key (`person-wrap.key`, mode 600), never in the database;
//   - is opened only by the identity module's provider sign-ins, after the provider's proof, into the keyring for the new session alone (modules/identity/handlers/signin.ts), each open an audit row;
//   - is dropped by a password change, a reset or a recovery, by the person ("Forget on this server", which also stops new ones), and every one of them when an owner turns the policy off.
// The policy is `vault.open_after_provider_sign_in` (Console, Sign-in requirements), on unless set to false.
import { aesUnwrap, aesWrap } from "../../../kernel/src/seal/index.ts";
import type { Box } from "../../../kernel/src/seal/index.ts";

export const WRAP_POLICY = "vault.open_after_provider_sign_in";

type Db = { run(sql: string, ...args: unknown[]): unknown; all(sql: string, ...args: unknown[]): unknown[] };

export interface KeyWraps {
  /** Seal the key the server holds for this person, unless the policy is off or they said Forget. True when a wrap is kept. */
  make(personId: string, key: Uint8Array): boolean;
  /** The person key, for a provider sign-in that just proved who this is; null when there is no wrap, the policy is off or it does not open. The caller wipes it. */
  open(personId: string): Uint8Array | null;
  /** Whether a wrap is kept for the person (the Vault shows "Opens after Google sign-in on this server"). */
  has(personId: string): boolean;
  /** Drop the person's wrap (password change, reset, recovery). New ones are made again at the next password unlock. */
  drop(personId: string): void;
  /** The person's own "Forget on this server": drop it and make no new one until they say Remember. */
  forget(personId: string): void;
  remember(personId: string): void;
  forgotten(personId: string): boolean;
  /** Drop every wrap when the owner has turned the policy off. Answers how many went. */
  enforce(): number;
}

export function createKeyWraps(w: { db: () => Db | null; space: () => string; secret: () => Uint8Array; enabled: () => boolean }): KeyWraps {
  // no Space database (a device daemon): nothing is kept and nothing opens
  const none: Db = { run: () => undefined, all: () => [] };
  const o = { ...w, get db(): Db { return w.db() ?? none; } };
  let ready = false;
  const table = (): void => {
    if (ready || w.db() === null) return;
    o.db.run("CREATE TABLE IF NOT EXISTS host_person_wrap (person_id TEXT PRIMARY KEY, box TEXT NOT NULL, made_at INTEGER NOT NULL)");
    o.db.run("CREATE TABLE IF NOT EXISTS host_person_wrap_off (person_id TEXT PRIMARY KEY, at INTEGER NOT NULL)");
    ready = true;
  };
  const aad = (personId: string): string => `vyre.person-wrap.v1:${o.space()}:${personId}`;
  const dropAll = (): number => { table(); const n = (o.db.all("SELECT count(*) AS n FROM host_person_wrap") as Array<{ n: number }>)[0]?.n ?? 0; o.db.run("DELETE FROM host_person_wrap"); return n; };
  const forgotten = (personId: string): boolean => { table(); return o.db.all("SELECT 1 AS x FROM host_person_wrap_off WHERE person_id = ?", personId).length > 0; };
  return {
    make(personId, key) {
      if (key.length !== 32 || w.db() === null || !o.enabled() || forgotten(personId)) return false;
      const box = aesWrap(o.secret(), key, aad(personId));
      o.db.run("INSERT INTO host_person_wrap (person_id, box, made_at) VALUES (?, ?, ?) ON CONFLICT(person_id) DO UPDATE SET box = excluded.box, made_at = excluded.made_at", personId, JSON.stringify(box), Date.now());
      return true;
    },
    open(personId) {
      table();
      if (!o.enabled()) { dropAll(); return null; }
      const row = (o.db.all("SELECT box FROM host_person_wrap WHERE person_id = ?", personId) as Array<{ box: string }>)[0];
      if (!row) return null;
      try {
        const key = aesUnwrap(o.secret(), JSON.parse(row.box) as Box, aad(personId));
        if (key.length !== 32) { key.fill(0); return null; }
        const out = Uint8Array.from(key);
        key.fill(0);
        return out;
      } catch { return null; }   // a wrap that does not open (another server's secret, a changed Space) is no wrap
    },
    has(personId) { table(); return o.enabled() && o.db.all("SELECT 1 AS x FROM host_person_wrap WHERE person_id = ?", personId).length > 0; },
    drop(personId) { table(); o.db.run("DELETE FROM host_person_wrap WHERE person_id = ?", personId); },
    forget(personId) { table(); o.db.run("DELETE FROM host_person_wrap WHERE person_id = ?", personId); o.db.run("INSERT OR REPLACE INTO host_person_wrap_off (person_id, at) VALUES (?, ?)", personId, Date.now()); },
    remember(personId) { table(); o.db.run("DELETE FROM host_person_wrap_off WHERE person_id = ?", personId); },
    forgotten,
    enforce() { return o.enabled() ? 0 : dropAll(); },
  };
}
