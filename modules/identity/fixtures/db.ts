// A real SQLite database for identity tests (node:sqlite), loaded from the module's own migration.
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import type { Db, IdentityCtx } from "../projections.ts";

export const NOW = 1_760_000_000_000;
export const SPACE = "spc_test";

export class SqliteDb implements Db {
  readonly raw = new DatabaseSync(":memory:");
  constructor() { this.raw.exec(readFileSync(new URL("../migrations/0001_identity.sql", import.meta.url), "utf8")); }
  all(sql: string, ...args: unknown[]): unknown[] { return this.raw.prepare(sql).all(...(args as never[])); }
  run(sql: string, ...args: unknown[]): { changes: number } { return { changes: Number(this.raw.prepare(sql).run(...(args as never[])).changes) }; }
}

export function harness(now = NOW) {
  const db = new SqliteDb();
  const events: { name: string; subject: string; payload: unknown }[] = [];
  let clock = now;
  const base = {
    space: SPACE,
    trace: { traceId: "0123456789abcdef0123456789abcdef" },
    now: () => clock,
    db,
    emit(name: string, subject: string, payload: unknown) { events.push({ name, subject, payload }); },
  };
  db.run(`INSERT INTO identity_space (id, name, logo_file_id, fingerprint, github, second_factor_required, sso_json) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    SPACE, "Maya Studio", null, "ab12 cd34 ef56 7890", 1, 0, "[]");
  /** The context of a signed-in call as person `id` on a session. */
  const as = (id: string, session?: { id: string; deviceId: string }): IdentityCtx => ({ ...base, principal: { kind: "person", id }, ...(session ? { session } : {}) });
  const anon: IdentityCtx = { ...base };
  return { db, events, anon, as, base, advance(ms: number) { clock += ms; } };
}

export const DEVICE = { deviceName: "Maya's Mac", deviceClass: "desktop" as const };
export const KEYS = {
  personKeyByPassword: "cGVyc29uLWJ5LXBhc3N3b3Jk",
  publicKey: "cHVibGljLWtleQ==",
  privateKeyWrapped: "cHJpdmF0ZS13cmFwcGVk",
  spaceKeys: [{ epoch: 1, wrapped: "c3BhY2Uta2V5LTE=" }],
};

export function codeOf(e: unknown): string | undefined {
  if (!e || typeof e !== "object" || !("error" in e)) return undefined;
  return (e as { error?: { code?: string } }).error?.code;
}
