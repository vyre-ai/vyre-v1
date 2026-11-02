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

/** A name that is the Space's own: not empty and never an id (spc_...). */
const ownName = (name: string): boolean => name !== "" && name.slice(0, 4).toLowerCase() !== "spc_";

export const consumers = {
  /**
   * The sign-in page names the Space by what it is called now (3 Nov: the owner named the Space in setup and every sign-in page went on showing its id until the server restarted, because the row
   * sign-in options reads was refreshed only at boot). A rename is copied here when it is committed; the profile is the spaces module's, read through spaces.get.
   */
  "identity.space_name": {
    on: ["space.updated"],
    async run(ctx: { space: string; db: { run(sql: string, ...a: unknown[]): unknown }; call(cap: string, input: unknown): Promise<unknown> }, event: { payload: { fields?: unknown } }): Promise<void> {
      if (!Array.isArray(event.payload.fields) || !event.payload.fields.includes("name")) return;
      const name = String(((await ctx.call("spaces.get", {})) as { space?: { name?: unknown } }).space?.name ?? "").trim();
      if (ownName(name)) ctx.db.run(`UPDATE identity_space SET name = ? WHERE id = ?`, name, ctx.space);
    },
  },
};

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
    // the name is the Space's own, refreshed at each boot (a rename since, or a row first made with only the id); an id never replaces a name the row already has
    ctx.db.run(`INSERT OR IGNORE INTO identity_space (id, name, logo_file_id, fingerprint, github, second_factor_required, sso_json) VALUES (?, ?, NULL, ?, ?, 0, '[]') ON CONFLICT(id) DO UPDATE SET github = excluded.github, name = CASE WHEN excluded.name <> '' AND lower(substr(excluded.name, 1, 4)) <> 'spc_' THEN excluded.name ELSE identity_space.name END`,
      ctx.space, i.name, hex.replace(/(.{4})(?=.)/g, "$1 "), i.github ? 1 : 0);
  },
  /** whether the server has a GitHub app now (the environment's, or the one an admin saved in the app) */
  "identity.set_github": (ctx: { space: string; db: { run(sql: string, ...a: unknown[]): unknown } }, i: { on: boolean }): void => {
    try { ctx.db.run(`UPDATE identity_space SET github = ? WHERE id = ?`, i.on ? 1 : 0, ctx.space); } catch { /* the Space row is made at boot */ }
  },
};
