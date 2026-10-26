// Identity module (lane L7a). The manifest stays `stub` until the lead regenerates the registry with status live (needs gen, which only CI runs).
import { handlers } from "./handlers/index.ts";
import { claimIssue } from "./handlers/claim.ts";
import { configureSessionTokens, sessionOfToken } from "./projections.ts";
import type { IdentityCtx } from "./projections.ts";

export { handlers, sessionOfToken };
/** The host hands identity its session-token seam (mint a gateway token for a devices session, end a session at the gateway) through this setter at boot. */
export const hostSeams = { setSessionTokens: configureSessionTokens };
export const projections = {};
export const codecs = {};

/**
 * The Space row sign-in options and the join page read (name, fingerprint, which sign-in methods are on), made once at boot by the host. The fingerprint is the Space key's; the server holds no Space key
 * (the admin's device wraps it), so until a device sets it this is a stable placeholder derived from the Space id, which devices must not pin.
 * DECISION: the fingerprint is a placeholder (see host/src/seams/spaceadmin.ts).
 */
export const hostCalls = {
  /** ruling 71: a fresh one-time claim link for an owner who has no account yet (null once they have one) */
  "identity.claim_issue": (ctx: unknown, i: { personId: string }): { code: string; expiresAt: number } | null => claimIssue(ctx as IdentityCtx, i),
  "identity.ensure_space": (ctx: { space: string; db: { run(sql: string, ...a: unknown[]): unknown } }, i: { name: string; github: boolean }): void => {
    ctx.db.run(`CREATE TABLE IF NOT EXISTS "identity_space" ("id" TEXT PRIMARY KEY, "name" TEXT NOT NULL, "logo_file_id" TEXT, "fingerprint" TEXT NOT NULL, "github" INTEGER NOT NULL DEFAULT 0, "second_factor_required" INTEGER NOT NULL DEFAULT 0, "sso_json" TEXT NOT NULL DEFAULT '[]')`);
    let h = 0x811c9dc5;
    const hex = Array.from(ctx.space).map((c) => { h = Math.imul(h ^ c.charCodeAt(0), 0x01000193) >>> 0; return h.toString(16).padStart(8, "0"); }).join("").slice(-16).padStart(16, "0");
    ctx.db.run(`INSERT OR IGNORE INTO identity_space (id, name, logo_file_id, fingerprint, github, second_factor_required, sso_json) VALUES (?, ?, NULL, ?, ?, 0, '[]')`,
      ctx.space, i.name, hex.replace(/(.{4})(?=.)/g, "$1 "), i.github ? 1 : 0);
  },
};
