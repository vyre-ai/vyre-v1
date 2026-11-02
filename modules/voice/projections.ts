// voice store and the host's half. Rows hold a person's choices and the Space's key reference; a value never does. The host runs the provider's grant, so this module has no network and sees a key only on its way to the Vault.
import { fail } from "../../host/src/routes/errors.ts";
import { DEFAULT_VOICE_PROVIDER, VOICE_PROVIDERS, voiceProvider } from "../../lib/voice.ts";
import type { VoiceProvider } from "../../lib/voice.ts";

export interface VoiceDb {
  all(sql: string, ...args: unknown[]): unknown[];
  run(sql: string, ...args: unknown[]): { changes: number };
}
export interface VoiceCtx {
  space: string;
  principal: { kind: "person" | "agent" | "actor" | "service"; id: string };
  actingFor?: string | undefined;
  thread?: string | undefined;
  trace: { traceId: string };
  now(): number;
  db: VoiceDb;
  emit(name: string, subject: string, payload: unknown, opts?: { vis?: "space" | "participants" | "owner" | "private" }): unknown;
  call(cap: string, input: unknown): Promise<unknown>;
  authorize(action: { perm: string | null; level: "view" | "use" | "edit" | "manage" }, resource: { type: string; id: string }): { effect: string };
  log: { info(msg: string, attrs?: Record<string, unknown>): void; warn(msg: string, attrs?: Record<string, unknown>): void };
}

/** The host's half. Both calls end at the provider's grant address. `mint` opens the Vault value itself: the value does not pass through this module. */
export interface VoiceHost {
  /** Is this key good: a real, cheap grant that is then thrown away. Throws a plain refusal. */
  check(ctx: VoiceCtx, p: { provider: string; apiKey: string }): Promise<void>;
  /** A short-lived token from the key at a handle. `asker` opens that person's own Mine item; left out, only a Shared item. */
  mint(ctx: VoiceCtx, p: { provider: string; handle: string; asker?: string; own: boolean }): Promise<{ token: string; expiresIn: number }>;
}
let host: VoiceHost | null = null;
export function setVoiceHost(h: VoiceHost | null): void { host = h; }
export function needHost(ctx: Pick<VoiceCtx, "trace">): VoiceHost {
  if (!host) throw fail("internal.unavailable", ctx.trace.traceId, { message: "Talk is not set up on this server." });
  return host;
}

export interface Prefs { on: boolean; provider: string; language: string; model: string; keyItem: string | null }
export interface SpaceKey { on: boolean; provider: string; keyItem: string; handle: string; setBy: string; checkedAt: number; state: "ok" | "failing" }
type Row = Record<string, string | number | null>;
const SPACE_ROW = "space";

export function defaults(): Prefs {
  const p = voiceProvider(DEFAULT_VOICE_PROVIDER) as VoiceProvider;
  return { on: true, provider: p.key, language: p.defaultLanguage, model: p.defaultModel, keyItem: null };
}
export function prefsOf(ctx: Pick<VoiceCtx, "db">, person: string): Prefs {
  const r = ctx.db.all(`SELECT * FROM voice_prefs WHERE "person" = ?`, person)[0] as Row | undefined;
  if (!r) return defaults();
  return { on: r["enabled"] === 1, provider: String(r["provider"]), language: String(r["language"]), model: String(r["model"]), keyItem: r["keyItem"] === null ? null : String(r["keyItem"]) };
}
export function putPrefs(ctx: VoiceCtx, person: string, p: Prefs): void {
  ctx.db.run(`INSERT OR REPLACE INTO voice_prefs ("person", "enabled", "provider", "language", "model", "keyItem", "updatedAt") VALUES (?, ?, ?, ?, ?, ?, ?)`, person, p.on ? 1 : 0, p.provider, p.language, p.model, p.keyItem, ctx.now());
}
export function spaceOf(ctx: Pick<VoiceCtx, "db">): SpaceKey | null {
  const r = ctx.db.all(`SELECT * FROM voice_space WHERE "id" = ?`, SPACE_ROW)[0] as Row | undefined;
  if (!r) return null;
  return { on: r["enabled"] === 1, provider: String(r["provider"]), keyItem: String(r["keyItem"]), handle: String(r["handle"]), setBy: String(r["setBy"]), checkedAt: Number(r["checkedAt"]), state: r["state"] === "failing" ? "failing" : "ok" };
}
export function putSpace(ctx: VoiceCtx, s: SpaceKey): void {
  ctx.db.run(`INSERT OR REPLACE INTO voice_space ("id", "enabled", "provider", "keyItem", "handle", "setBy", "checkedAt", "state", "updatedAt") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, SPACE_ROW, s.on ? 1 : 0, s.provider, s.keyItem, s.handle, s.setBy, s.checkedAt, s.state, ctx.now());
}
export function dropSpace(ctx: VoiceCtx): void { ctx.db.run(`DELETE FROM voice_space WHERE "id" = ?`, SPACE_ROW); }
export function ownKeyCount(ctx: Pick<VoiceCtx, "db">): number {
  return (ctx.db.all(`SELECT * FROM voice_prefs`) as Row[]).filter((r) => r["keyItem"] !== null).length;
}
export const catalog = (): unknown[] => VOICE_PROVIDERS.map((p) => ({ key: p.key, name: p.name, keyUrl: p.keyUrl, models: p.models, languages: p.languages }));
