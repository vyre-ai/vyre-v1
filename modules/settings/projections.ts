// Settings projections (spec 3.9, ARCH 7.9): the registry of SettingDefs (generated from every module's settings[]), which of the ten pages a row belongs to, the value that applies to
// one person (their own, else the Space's, else the shipped default), the owner floor, and the search index. Handlers reach the tables only through ctx.db.
import type { Ctx } from "../../packages/contracts/src/ctx.ts";
import { validate } from "../../packages/contracts/src/jsonschema.ts";
import type { JsonSchema, SettingDef } from "../../packages/contracts/src/types.ts";
import { fail } from "../../host/src/routes/errors.ts";
import { registry } from "../../generated/registry.ts";

/** The part of the host Ctx these handlers use. The full Ctx satisfies it. */
export type SettingsCtx = Pick<Ctx, "space" | "principal" | "trace" | "now" | "db" | "emit" | "authorize">;
type Code = Parameters<typeof fail>[0];
export function raise(ctx: Pick<SettingsCtx, "trace">, code: Code, message?: string): never {
  throw fail(code, ctx.trace.traceId, message ? { message } : {});
}

// ---------------------------------------------------------------- the ten pages

export type PageKey = "profile" | "notifications" | "models" | "connections" | "privacy" | "signin" | "appearance" | "keyboard" | "computer" | "spaces";
export const PAGES: readonly { key: PageKey; title: string; group: "space" | "everywhere"; from: readonly string[] }[] = [
  { key: "profile", title: "Profile", group: "space", from: ["profile", "Home"] },
  { key: "notifications", title: "Notifications", group: "space", from: ["Notifications"] },
  { key: "models", title: "Models and usage", group: "space", from: ["Models and usage"] },
  { key: "connections", title: "Connections", group: "space", from: ["Connections"] },
  { key: "privacy", title: "Memory and privacy", group: "space", from: ["Memory and privacy"] },
  { key: "signin", title: "Sign-in and devices", group: "everywhere", from: ["Sign-in and devices"] },
  { key: "appearance", title: "Appearance", group: "everywhere", from: ["appearance", "kit"] },
  { key: "keyboard", title: "Keyboard", group: "everywhere", from: ["keyboard", "Chats"] },
  { key: "computer", title: "This computer", group: "everywhere", from: ["This computer"] },
  { key: "spaces", title: "Spaces", group: "everywhere", from: [] },
];

/** The ten-page key for a definition, or null when it belongs to a Console page: Space-wide values are set in the Console, except the one idle-minutes row Notifications shows. */
export function pageOf(def: SettingDef): PageKey | null {
  if (def.scope === "space" && def.page !== "Notifications") return null;
  return PAGES.find((p) => p.from.includes(def.page))?.key ?? null;
}

export const defs: readonly SettingDef[] = registry.settings as unknown as SettingDef[];
const byKey = new Map(defs.map((d) => [d.key, d] as const));
const $defs = registry.$defs as Record<string, JsonSchema>;

export function defOf(ctx: Pick<SettingsCtx, "trace">, key: string): SettingDef {
  const d = byKey.get(key);
  if (!d) raise(ctx, "validation.not_found", `no setting called ${key}`);
  return d;
}

/** The error text for a value the setting's schema refuses, or null. */
export function refusal(def: SettingDef, value: unknown): string | null {
  const errs = validate(def.schema as unknown as JsonSchema, value, "", $defs);
  return errs.length === 0 ? null : `${def.title}: ${errs[0]}`;
}

// ---------------------------------------------------------------- who is asking

export function me(ctx: SettingsCtx): string {
  if (!ctx.principal || ctx.principal.kind !== "person") raise(ctx, "auth.unauthenticated");
  return ctx.principal.id;
}
export const byOf = (ctx: SettingsCtx): string => ctx.principal?.id ?? "system";

// ---------------------------------------------------------------- stored values

interface ValueRec { setting: string; scope: string; person: string; value: string; changed_by: string | null; updated_at: number }
const parse = (s: string): unknown => JSON.parse(s) as unknown;

export function stored(ctx: SettingsCtx, key: string, scope: "space" | "person", person: string): { value: unknown } | undefined {
  const r = ctx.db.all(`SELECT * FROM settings_value WHERE setting = ? AND scope = ? AND person = ?`, key, scope, scope === "space" ? "" : person)[0] as ValueRec | undefined;
  return r ? { value: parse(r.value) } : undefined;
}
export function put(ctx: SettingsCtx, key: string, scope: "space" | "person", person: string, value: unknown): void {
  ctx.db.run(`INSERT OR REPLACE INTO settings_value (setting, scope, person, value, changed_by, updated_at) VALUES (?, ?, ?, ?, ?, ?)`, key, scope, scope === "space" ? "" : person, JSON.stringify(value), byOf(ctx), ctx.now());
}
export function drop(ctx: SettingsCtx, key: string, scope: "space" | "person", person: string): void {
  ctx.db.run(`DELETE FROM settings_value WHERE setting = ? AND scope = ? AND person = ?`, key, scope, scope === "space" ? "" : person);
}

export type Source = "default" | "space" | "person";
/** The value that applies to this person: their own, else the Space's, else the shipped default. */
export function effective(ctx: SettingsCtx, def: SettingDef, person: string): { value: unknown; source: Source } {
  if (def.scope === "person") {
    const mine = stored(ctx, def.key, "person", person);
    if (mine) return { value: mine.value, source: "person" };
  }
  const space = stored(ctx, def.key, "space", "");
  if (space) return { value: space.value, source: "space" };
  return { value: def.default, source: "default" };
}

// ---------------------------------------------------------------- the owner floor

/** Strictest first. A floor is the least strict value anyone may choose, so a value must sit at or before it in this order. Settings with no order here cannot have a floor. */
export const STRICTNESS: Readonly<Record<string, readonly unknown[]>> = {
  "security.level": ["strict", "standard", "relaxed"],
  "security.chrome_mode": ["ask", "allow", "auto"],
  "security.terminal_mode": ["ask", "allow", "auto"],
  "engine.allowed_accounts": ["company", "any"],
  "space.allowed_ai_accounts": ["company", "any"],
  "sharing.public_links": ["off", "admins", "members"],
  "signin.second_factor": ["required", "off"],
  "sync.phone_label_ceiling": ["public", "internal", "confidential"],
  "vault.export_expiry_max": ["1h", "1d", "7d"],
  "changesets.different_person": [true, false],
  "signin.require_sso": [true, false],
  "tasks.require_human_approver": [true, false],
};
/** Whole numbers where a smaller one is stricter. */
export const LOWER_IS_STRICTER: ReadonlySet<string> = new Set(["engine.agent_hops", "engine.ci_fix_loops", "engine.review_loops", "gate.email_backstop_hours"]);

export function comparable(key: string): boolean {
  return key in STRICTNESS || LOWER_IS_STRICTER.has(key);
}
const choiceOf = (key: string, v: unknown): unknown => ((key === "security.chrome_mode" || key === "security.terminal_mode") && v && typeof v === "object" ? (v as { base?: unknown }).base : v);

/** Is `value` at least as strict as `floor`? Values the order does not know are not refused. */
export function meetsFloor(key: string, value: unknown, floor: unknown): boolean {
  if (LOWER_IS_STRICTER.has(key)) return typeof value === "number" && typeof floor === "number" ? value <= floor : true;
  const order = STRICTNESS[key];
  if (!order) return true;
  const v = order.indexOf(choiceOf(key, value));
  const f = order.indexOf(choiceOf(key, floor));
  if (v < 0 || f < 0) return true;
  if (v > f) return false;
  // per-Space overrides of a mode are held to the floor as well
  const spaces = (key === "security.chrome_mode" || key === "security.terminal_mode") && value && typeof value === "object" ? (value as { spaces?: Record<string, unknown> }).spaces : undefined;
  if (spaces) for (const s of Object.values(spaces)) { const i = order.indexOf(s); if (i > f) return false; }
  return true;
}

export function floorOf(ctx: SettingsCtx, key: string): unknown | undefined {
  const r = ctx.db.all(`SELECT * FROM settings_floor WHERE setting = ?`, key)[0] as { floor: string } | undefined;
  return r ? parse(r.floor) : undefined;
}

// ---------------------------------------------------------------- rows

export interface RowOut {
  key: string; scope: "space" | "person"; page: string; title: string; value: unknown; default: unknown; source: Source; floorable: boolean; floor?: unknown;
}
export function rowOut(ctx: SettingsCtx, def: SettingDef, person: string): RowOut {
  const eff = effective(ctx, def, person);
  const floorable = comparable(def.key) && def.floorable === true;
  const floor = floorable ? floorOf(ctx, def.key) : undefined;
  return { key: def.key, scope: def.scope, page: pageOf(def) ?? def.page, title: def.title, value: eff.value, default: def.default, source: eff.source, floorable, ...(floor !== undefined ? { floor } : {}) };
}

// ---------------------------------------------------------------- search

export interface Hit { key: string; page: string; title: string; score: number }

/** Every row with a Settings page whose title, key or page name holds every word; a title that starts with the first word ranks above one that only contains it. */
export function search(q: string): Hit[] {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const out: Hit[] = [];
  for (const d of defs) {
    const page = pageOf(d);
    if (!page) continue;
    const pageTitle = PAGES.find((p) => p.key === page)!.title;
    const hay = `${d.title} ${d.key.replace(/[._]/g, " ")} ${pageTitle}`.toLowerCase();
    if (!words.every((w) => hay.includes(w))) continue;
    out.push({ key: d.key, page, title: d.title, score: d.title.toLowerCase().startsWith(words[0]!) ? 2 : 1 });
  }
  return out.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));
}

// ---------------------------------------------------------------- the profile Copy from another Space carries

export type CopyField = "photo" | "name" | "handle" | "timezone" | "hours" | "contact";
/** The profile setting each copyable field lives in. The title is deliberately not here: it is never copied. */
export const COPY_KEY: Readonly<Record<CopyField, string>> = {
  photo: "profile.photo", name: "profile.display_name", handle: "profile.handle", timezone: "profile.timezone", hours: "profile.working_hours", contact: "profile.contact",
};

export const DEFAULT_KIT = "kit_default";
