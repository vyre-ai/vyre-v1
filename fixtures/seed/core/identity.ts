// The live identity module's own tables for the seed. identity reads identity_space and identity_accounts; the kernel fold never reaches them, so a seeded person could not sign in
// ("no such person", "this Space is not set up"). `fillIdentityTables` gives the Space its profile row and every seeded person an account: username is the id without `usr_`, the password is
// SEED_TEST_PASSWORD, the verifier is the module's own format at its lowest accepted cost, and the key bundle is opaque ciphertext-shaped base64 (the server never opens it).
// The bundle is not made with the client's key code (client/src/crypto is not on main yet), so a client cannot unwrap it; sign-in still returns it.
import { argon2id } from "../../../kernel/src/identity/stretch.ts";
import { SEED_TEST_PASSWORD } from "../../../testkit/src/seed-password.ts";
import type { AccessTableDb } from "./access.ts";

interface AnyEvent { type: string; payload: unknown }
const body = (e: AnyEvent): Record<string, unknown> => (e.payload instanceof Uint8Array ? (JSON.parse(new TextDecoder().decode(e.payload)) as Record<string, unknown>) : (e.payload as Record<string, unknown>));

/** Same shape as modules/identity makeVerifier, at the cost the module accepts as a minimum (8 KiB, one pass), so a seeded sign-in takes a few milliseconds. */
function verifier(secret: string, salt: Buffer): string {
  return `argon2id$8$1$${salt.toString("base64url")}$${argon2id(secret.normalize("NFKC"), salt, { memoryKiB: 8, passes: 1 }).toString("base64url")}`;
}
const b64 = (s: string): string => Buffer.from(s).toString("base64");

export function fillIdentityTables(db: AccessTableDb, space: string, events: readonly AnyEvent[]): void {
  for (const t of ["identity_accounts", "identity_space"]) db.run(`DELETE FROM ${t}`);
  db.run("INSERT INTO identity_space (id, name, logo_file_id, fingerprint, github, second_factor_required, sso_json) VALUES (?, ?, ?, ?, ?, ?, ?)", space, "Seed Space", null, "ab12 cd34 ef56 7890", 0, 0, "[]");
  let n = 0;
  for (const e of events) {
    if (e.type !== "principal.created") continue;
    const p = body(e);
    if (p["kind"] !== "person") continue;
    const id = String(p["id"]);
    const salt = Buffer.alloc(16, ++n);   // fixed salts: the same seed builds the same rows
    const keys = { personKeyByPassword: b64(`wrapped-${id}`), publicKey: b64(`public-${id}`), privateKeyWrapped: b64(`private-${id}`), spaceKeys: [{ epoch: 0, wrapped: b64(`space-${id}`) }] };
    db.run(
      "INSERT INTO identity_accounts (person_id, username, name, verifier, totp_secret, totp_last_step, github_id, github_login, keys_json, recovery_hash, fails, locked_until, epoch, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      id, id.replace(/^usr_/, ""), String(p["name"] ?? id), verifier(SEED_TEST_PASSWORD, salt), null, 0, null, null, JSON.stringify(keys), null, 0, 0, 0, 1_790_000_000_000);
  }
}
