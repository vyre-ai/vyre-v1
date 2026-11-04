// talk store and the host's half. Rows hold a person's choices and the Space's key reference; a value never does. The host runs the provider's grant, so this module has no network and sees a key only on its way to the Vault.
import { fail } from "../../host/src/routes/errors.ts";
import { DEFAULT_TALK_PROVIDER, TALK_PROVIDERS, talkProvider } from "../../lib/talk.ts";
import type { TalkProvider } from "../../lib/talk.ts";

export interface TalkDb {
  all(sql: string, ...args: unknown[]): unknown[];
  run(sql: string, ...args: unknown[]): { changes: number };
}
export interface TalkCtx {
  space: string;
  principal: { kind: "person" | "agent" | "actor" | "service"; id: string };
  actingFor?: string | undefined;
  thread?: string | undefined;
  trace: { traceId: string };
  now(): number;
  db: TalkDb;
  emit(name: string, subject: string, payload: unknown, opts?: { vis?: "space" | "participants" | "owner" | "private" }): unknown;
  call(cap: string, input: unknown): Promise<unknown>;
  authorize(action: { perm: string | null; level: "view" | "use" | "edit" | "manage" }, resource: { type: string; id: string }): { effect: string };
  log: { info(msg: string, attrs?: Record<string, unknown>): void; warn(msg: string, attrs?: Record<string, unknown>): void };
}

/** The host's half. Both calls end at the provider's grant address. `mint` opens the Vault value itself: the value does not pass through this module. */
export interface TalkHost {
  /** Is this key good: a real, cheap grant that is then thrown away. Throws a plain refusal. */
  check(ctx: TalkCtx, p: { provider: string; apiKey: string }): Promise<void>;
  /** A short-lived token from the key at a handle. `asker` opens that person's own Mine item; left out, only a Shared item. */
  mint(ctx: TalkCtx, p: { provider: string; handle: string; asker?: string; own: boolean; /** seconds the token should live; the check asks for 1 */ ttl?: number }): Promise<{ token: string; expiresIn: number }>;
}
let host: TalkHost | null = null;
export function setTalkHost(h: TalkHost | null): void { host = h; }
export function needHost(ctx: Pick<TalkCtx, "trace">): TalkHost {
  if (!host) throw fail("internal.unavailable", ctx.trace.traceId, { message: "Talk is not set up on this server." });
  return host;
}

export interface Prefs { on: boolean; provider: string; language: string; model: string; keyItem: string | null }
export interface SpaceKey { on: boolean; provider: string; keyItem: string; handle: string; setBy: string; checkedAt: number; state: "ok" | "failing" }
type Row = Record<string, string | number | null>;
const PICK = "space";

export function defaults(): Prefs {
  const p = talkProvider(DEFAULT_TALK_PROVIDER) as TalkProvider;
  return { on: true, provider: p.key, language: p.defaultLanguage, model: p.defaultModel, keyItem: null };
}
export function prefsOf(ctx: Pick<TalkCtx, "db">, person: string): Prefs {
  const r = ctx.db.all(`SELECT * FROM talk_prefs WHERE "person" = ?`, person)[0] as Row | undefined;
  if (!r) return defaults();
  return { on: r["enabled"] === 1, provider: String(r["provider"]), language: String(r["language"]), model: String(r["model"]), keyItem: r["keyItem"] === null ? null : String(r["keyItem"]) };
}
export function putPrefs(ctx: TalkCtx, person: string, p: Prefs): void {
  ctx.db.run(`INSERT OR REPLACE INTO talk_prefs ("person", "enabled", "provider", "language", "model", "keyItem", "updatedAt") VALUES (?, ?, ?, ?, ?, ?, ?)`, person, p.on ? 1 : 0, p.provider, p.language, p.model, p.keyItem, ctx.now());
}
/** The Space's key for the provider it picked, or for `provider` when asked. `on` is the Space switch: it lives with the pick. */
export function spaceOf(ctx: Pick<TalkCtx, "db">, provider?: string): SpaceKey | null {
  const pick = ctx.db.all(`SELECT * FROM talk_space_pick WHERE "id" = ?`, PICK)[0] as Row | undefined;
  const want = provider ?? (pick ? String(pick["provider"]) : undefined);
  if (want === undefined) return null;
  const r = ctx.db.all(`SELECT * FROM talk_space WHERE "id" = ?`, want)[0] as Row | undefined;
  if (!r) return null;
  return { on: pick ? pick["enabled"] === 1 : r["enabled"] === 1, provider: String(r["provider"]), keyItem: String(r["keyItem"]), handle: String(r["handle"]), setBy: String(r["setBy"]), checkedAt: Number(r["checkedAt"]), state: r["state"] === "failing" ? "failing" : "ok" };
}
/** Keep this provider's key and make it the one that covers people. */
export function putSpace(ctx: TalkCtx, s: SpaceKey): void {
  ctx.db.run(`INSERT OR REPLACE INTO talk_space ("id", "enabled", "provider", "keyItem", "handle", "setBy", "checkedAt", "state", "updatedAt") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, s.provider, s.on ? 1 : 0, s.provider, s.keyItem, s.handle, s.setBy, s.checkedAt, s.state, ctx.now());
  putPick(ctx, s.provider, s.on);
}
/** Change only which provider covers people (its key must be there), or only the switch. */
export function putPick(ctx: Pick<TalkCtx, "db">, provider: string, on: boolean): void {
  ctx.db.run(`INSERT OR REPLACE INTO talk_space_pick ("id", "provider", "enabled") VALUES (?, ?, ?)`, PICK, provider, on ? 1 : 0);
}
/** The providers the Space has a key for. */
export function spaceProviders(ctx: Pick<TalkCtx, "db">): string[] {
  return (ctx.db.all(`SELECT * FROM talk_space`) as Row[]).map((r) => String(r["provider"])).sort();
}
/** Remove one provider's key. If it was the pick, the pick moves to another key, or goes. */
export function dropSpace(ctx: Pick<TalkCtx, "db">, provider: string): void {
  ctx.db.run(`DELETE FROM talk_space WHERE "id" = ?`, provider);
  const pick = ctx.db.all(`SELECT * FROM talk_space_pick WHERE "id" = ?`, PICK)[0] as Row | undefined;
  if (!pick || pick["provider"] !== provider) return;
  const next = spaceProviders(ctx)[0];
  if (next) putPick(ctx, next, pick["enabled"] === 1);
  else ctx.db.run(`DELETE FROM talk_space_pick WHERE "id" = ?`, PICK);
}
export function ownKeyCount(ctx: Pick<TalkCtx, "db">): number {
  return (ctx.db.all(`SELECT * FROM talk_prefs`) as Row[]).filter((r) => r["keyItem"] !== null).length;
}
export const catalog = (): unknown[] => TALK_PROVIDERS.map((p) => ({ key: p.key, name: p.name, keyUrl: p.keyUrl, models: p.models, languages: p.languages }));
