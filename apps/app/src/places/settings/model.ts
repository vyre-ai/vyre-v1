// The Settings model (spec 3.9, 2.24; ARCH 7.9): the ten pages in their two groups, which SettingDef sits in which section of which page, how a value is drawn (a switch, a choice,
// a number, text, hours or a summary) from its schema, and Cmd-F. Pure functions over the rows `settings.list` returns, so every row of the registry has a place and is found.
import type { CapMap } from "../../../../../generated/types.ts";

export type SettingRow = CapMap["settings.list"]["out"]["rows"][number];
export type PageInfo = CapMap["settings.pages"]["out"]["pages"][number];
export type PageKey = "profile" | "notifications" | "models" | "connections" | "privacy" | "signin" | "appearance" | "keyboard" | "computer" | "spaces";

export interface PageDef { key: PageKey; title: string; group: "space" | "everywhere"; icon: string; /** the `page` strings settings.list uses for this page's rows */ pages: readonly string[] }

export const PAGES: readonly PageDef[] = [
  { key: "profile", title: "Profile", group: "space", icon: "person", pages: ["profile", "Home"] },
  { key: "notifications", title: "Notifications", group: "space", icon: "bell", pages: ["Notifications"] },
  { key: "models", title: "Models and usage", group: "space", icon: "chip", pages: ["Models and usage"] },
  { key: "connections", title: "Connections", group: "space", icon: "link", pages: ["Connections"] },
  { key: "privacy", title: "Memory and privacy", group: "space", icon: "shield", pages: ["Memory and privacy"] },
  { key: "signin", title: "Sign-in and devices", group: "everywhere", icon: "key", pages: ["Sign-in and devices"] },
  { key: "appearance", title: "Appearance", group: "everywhere", icon: "palette", pages: ["appearance", "kit"] },
  { key: "keyboard", title: "Keyboard", group: "everywhere", icon: "keyboard", pages: ["keyboard", "Chats"] },
  { key: "computer", title: "This computer", group: "everywhere", icon: "laptop", pages: ["This computer"] },
  { key: "spaces", title: "Spaces", group: "everywhere", icon: "grid", pages: ["spaces"] },
];

export function pageByKey(key: string): PageDef {
  return PAGES.find((p) => p.key === key) ?? PAGES[0]!;
}

/** The page a row belongs to; rows from places the registry names other ways (Console pages, Space policy) belong to none. */
export function pageOfRow(row: SettingRow): PageDef | null {
  if (row.scope === "space" && row.page !== "Notifications") return null;
  return PAGES.find((p) => p.pages.includes(row.page)) ?? null;
}

// ---------------------------------------------------------------- sections: the headings a page's rows sit under

export interface SectionDef { title: string; note?: string; keys: readonly string[] }

/** Settings that a page draws itself (a card, a picker, a table) and so are not repeated as rows. */
export const DRAWN_BY_PAGE: Readonly<Record<string, readonly string[]>> = {
  profile: ["profile.photo", "profile.display_name", "profile.handle", "profile.title", "profile.contact"],
  appearance: ["appearance.skin", "appearance.mode", "kit.choice_person", "kit.person_choice"],
  keyboard: ["keyboard.overrides"],
};

export const SECTIONS: Readonly<Record<PageKey, readonly SectionDef[]>> = {
  profile: [
    { title: "About you", keys: ["profile.display_name", "profile.handle", "profile.title"] },
    { title: "Availability", keys: ["profile.timezone", "profile.working_hours"] },
    { title: "Contact", keys: ["profile.contact"] },
    { title: "Your day", keys: ["home.digest_schedule"] },
  ],
  notifications: [
    { title: "Delivery", keys: ["notifications.email_backstop", "notifications.working_hours", "notifications.push_idle_minutes"] },
  ],
  models: [
    { title: "Where work runs", keys: ["engine.subscription_share", "engine.runtime_opt_in", "chat.ask_agent"] },
  ],
  connections: [],
  privacy: [{ title: "Memory and privacy", keys: ["memory.weekly_nudge", "engine.runtime_opt_in"] }],
  signin: [],
  appearance: [{ title: "", keys: ["appearance.density", "appearance.text_size", "appearance.reduce_motion"] }],
  keyboard: [{ title: "Chats", keys: ["chat.agent_tabs"] }],
  computer: [
    { title: "Safety", keys: ["security.level", "security.terminal_mode", "security.chrome_mode"] },
    { title: "Agents on this computer", keys: ["engine.local_runs", "security.team_agents_on_my_computer", "chrome.agents_use_my_browser"] },
    { title: "Storage", keys: ["sync.blob_cache_mb"] },
  ],
  spaces: [],
};

export interface Section { title: string; rows: SettingRow[] }

/** Rows of one page, in sections. A row the table does not name goes in the last section, so no row of the registry is lost. */
export function sectionsFor(page: PageKey, rows: readonly SettingRow[]): Section[] {
  const mine = rows.filter((r) => pageOfRow(r)?.key === page);
  const drawn = new Set(DRAWN_BY_PAGE[page] ?? []);
  const left = mine.filter((r) => !drawn.has(r.key));
  const out: Section[] = [];
  const used = new Set<string>();
  for (const def of SECTIONS[page]) {
    const hit = def.keys.map((k) => left.find((r) => r.key === k)).filter((r): r is SettingRow => r !== undefined && !used.has(r.key));
    for (const r of hit) used.add(r.key);
    if (hit.length > 0) out.push({ title: def.title, rows: hit });
  }
  const rest = left.filter((r) => !used.has(r.key));
  if (rest.length > 0) out.push({ title: out.length === 0 ? pageByKey(page).title : "More", rows: rest });
  return out;
}

// ---------------------------------------------------------------- how a value is drawn

export type Control =
  | { kind: "switch" }
  | { kind: "choice"; options: readonly { value: string; label: string }[] }
  | { kind: "number"; min?: number; max?: number; step: number }
  | { kind: "text"; pattern?: string; mono?: boolean }
  | { kind: "hours" }
  | { kind: "mode" }
  | { kind: "list" }
  | { kind: "spacemap" }
  | { kind: "summary" };

export interface Schema { type?: string; enum?: readonly unknown[]; minimum?: number; maximum?: number; pattern?: string; properties?: Record<string, unknown>; items?: unknown; anyOf?: unknown[]; $ref?: string }

/** What the registry's schema says that the row itself does not: the choices of an enum and the range of a number. The shell may pass the real schema; this table covers the person rows. */
export const HINTS: Readonly<Record<string, Schema>> = {
  "appearance.mode": { enum: ["system", "light", "dark"] },
  "appearance.density": { enum: ["comfortable", "compact"] },
  "appearance.text_size": { type: "integer", minimum: 90, maximum: 120 },
  "security.level": { enum: ["relaxed", "standard", "strict"] },
  "sync.blob_cache_mb": { type: "integer", minimum: 100, maximum: 100000 },
  "notifications.push_idle_minutes": { type: "integer", minimum: 1, maximum: 60 },
};

/** The registry row carries no schema through `settings.list`, so the control is chosen from the value and the default together, with the hints above for choices and ranges. */
export const TIMEZONES: readonly { value: string; label: string }[] = [
  { value: "UTC", label: "UTC" },
  { value: "America/Los_Angeles", label: "Pacific Time, Los Angeles" },
  { value: "America/Denver", label: "Mountain Time, Denver" },
  { value: "America/Chicago", label: "Central Time, Chicago" },
  { value: "America/New_York", label: "Eastern Time, New York" },
  { value: "America/Sao_Paulo", label: "Brasilia Time, Sao Paulo" },
  { value: "Europe/London", label: "London" },
  { value: "Europe/Berlin", label: "Central European Time, Berlin" },
  { value: "Africa/Cairo", label: "Cairo" },
  { value: "Asia/Dubai", label: "Gulf Time, Dubai" },
  { value: "Asia/Karachi", label: "Pakistan Time, Karachi" },
  { value: "Asia/Kolkata", label: "India Time, Kolkata" },
  { value: "Asia/Kuala_Lumpur", label: "Malaysia Time, Kuala Lumpur" },
  { value: "Asia/Singapore", label: "Singapore" },
  { value: "Asia/Tokyo", label: "Japan Time, Tokyo" },
  { value: "Australia/Sydney", label: "Sydney" },
];

/** "8:11 PM" in a time zone, at a moment. A zone the runtime does not know falls back to UTC. */
export function timeIn(at: number, tz: string): string {
  try { return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: tz }).format(new Date(at)); }
  catch { return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: "UTC" }).format(new Date(at)); }
}

export function controlFor(row: SettingRow, schema: Schema | undefined = HINTS[row.key]): Control {
  if (row.key === "profile.timezone") {
    const cur = typeof row.value === "string" ? row.value : "UTC";
    const options = TIMEZONES.some((z) => z.value === cur) ? TIMEZONES : [{ value: cur, label: cur }, ...TIMEZONES];
    return { kind: "choice", options };
  }
  if (row.key === "chrome.agents_use_my_browser" || row.key === "security.team_agents_on_my_computer") return { kind: "spacemap" };
  if (row.key.endsWith("working_hours")) return { kind: "hours" };
  if (row.key === "security.terminal_mode" || row.key === "security.chrome_mode") return { kind: "mode" };
  if (schema?.enum) return { kind: "choice", options: schema.enum.map((v) => ({ value: String(v), label: labelOf(String(v)) })) };
  const v = row.default;
  if (typeof v === "boolean") return { kind: "switch" };
  if (typeof v === "number") return { kind: "number", ...(schema?.minimum !== undefined ? { min: schema.minimum } : {}), ...(schema?.maximum !== undefined ? { max: schema.maximum } : {}), step: v >= 1000 ? 100 : 1 };
  if (typeof v === "string") return { kind: "text", ...(schema?.pattern ? { pattern: schema.pattern } : {}), ...(row.key.includes("handle") ? { mono: true } : {}) };
  if (Array.isArray(v)) return { kind: "list" };
  return { kind: "summary" };
}

/** The label a row shows when the registry's title carries a unit or a hint the page says with its control. */
export const ROW_LABELS: Readonly<Record<string, string>> = { "appearance.text_size": "Text size" };
export const rowLabel = (row: SettingRow): string => ROW_LABELS[row.key] ?? row.title;

export function labelOf(value: string): string {
  const words = value.replace(/[_-]+/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

export interface Hours { days: number[]; from: string; to: string; tz?: string }

/** "Mon to Fri, 9:00 AM to 5:30 PM": runs of days are joined, times are in the person's own clock style. */
export function hoursSummary(h: Hours | null | undefined): string {
  if (!h || h.days.length === 0) return "No set hours";
  const days = [...h.days].sort((a, b) => a - b);
  const runs: number[][] = [];
  for (const d of days) {
    const last = runs[runs.length - 1];
    if (last && d === last[last.length - 1]! + 1) last.push(d); else runs.push([d]);
  }
  const parts: string[] = [];
  for (const r of runs) parts.push(r.length >= 3 ? `${DAY_NAMES[r[0]!]} to ${DAY_NAMES[r[r.length - 1]!]}` : r.map((d) => DAY_NAMES[d]!).join(", "));
  return `${parts.join(", ")}, ${clock(h.from)} to ${clock(h.to)}`;
}

export function clock(hhmm: string): string {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm);
  if (!m) return hhmm;
  const h = Number(m[1]);
  return `${h % 12 === 0 ? 12 : h % 12}:${m[2]} ${h < 12 ? "AM" : "PM"}`;
}

/** The text a summary row shows for a structured value. */
export function summaryOf(value: unknown): string {
  if (value === null || value === undefined) return "Not set";
  if (typeof value === "boolean") return value ? "On" : "Off";
  if (typeof value === "number" || typeof value === "string") return String(value);
  if (Array.isArray(value)) return value.length === 0 ? "None" : value.length <= 3 ? value.map(String).join(", ") : `${value.length} items`;
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length === 0) return "Default";
  return entries.map(([k, v]) => `${labelOf(k)} ${typeof v === "object" ? "set" : String(v)}`).join(", ").slice(0, 60);
}

export const MODES = [{ value: "ask", label: "Ask each time" }, { value: "allow", label: "Allow" }, { value: "never", label: "Never" }] as const;

// ---------------------------------------------------------------- search (Cmd-F)

export interface Hit { key: string; page: PageKey; title: string; score: number; sub?: string }

/** The line under a search hit and extra words that find it, for rows whose registry title says too little. */
export const HIT_HELP: Readonly<Record<string, { sub?: string; words?: string }>> = {
  "appearance.density": { sub: "Comfortable or compact", words: "compact spacing" },
  "appearance.text_size": { words: "font larger smaller zoom" },
  "appearance.reduce_motion": { words: "animation accessibility" },
  "appearance.skin": { words: "theme dark light colour color" },
};

/** Rows a page draws itself (the sign-in cards) that Cmd-F still finds. */
export const DRAWN_ROWS: readonly { key: string; page: PageKey; title: string; sub: string; words: string }[] = [
  { key: "signin.password", page: "signin", title: "Password", sub: "Change your password", words: "sign in login" },
  { key: "signin.github", page: "signin", title: "GitHub", sub: "Sign in with one click", words: "sign in login" },
  { key: "signin.totp", page: "signin", title: "Authenticator app", sub: "One-time codes on your phone", words: "second factor 2fa totp" },
  { key: "signin.passkey", page: "signin", title: "Passkeys", sub: "Touch ID and security keys", words: "second factor biometric" },
  { key: "signin.floor", page: "signin", title: "Second factor required", sub: "Set by your Space", words: "2fa floor" },
  { key: "signin.sso", page: "signin", title: "Single sign-on", sub: "Your admin signs you in", words: "sso google okta" },
  { key: "signin.devs", page: "signin", title: "Devices", sub: "Where you are signed in", words: "computers sign out" },
];

/** Words in any order; a title that starts with the first word ranks above one that only contains it. */
export function searchRows(rows: readonly SettingRow[], q: string): Hit[] {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const out: Hit[] = [];
  for (const r of rows) {
    const page = pageOfRow(r);
    if (!page) continue;
    const help = HIT_HELP[r.key];
    const label = rowLabel(r);
    const hay = `${label} ${r.key.replace(/[._]/g, " ")} ${page.title} ${help?.sub ?? ""} ${help?.words ?? ""}`.toLowerCase();
    if (!words.every((w) => hay.includes(w))) continue;
    out.push({ key: r.key, page: page.key, title: label, score: label.toLowerCase().startsWith(words[0]!) ? 2 : 1, ...(help?.sub ? { sub: help.sub } : {}) });
  }
  for (const d of DRAWN_ROWS) {
    const hay = `${d.title} ${d.sub} ${d.words} ${pageByKey(d.page).title}`.toLowerCase();
    if (!words.every((w) => hay.includes(w))) continue;
    out.push({ key: d.key, page: d.page, title: d.title, score: d.title.toLowerCase().startsWith(words[0]!) ? 2 : 1, sub: d.sub });
  }
  return out.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));
}

export function bytesLabel(mb: number): string {
  return mb >= 1024 ? `${Math.round((mb / 1024) * 10) / 10} GB` : `${mb} MB`;
}

export function moneyLabel(micros: number): string {
  return `$${(micros / 1_000_000).toFixed(2)}`;
}

/** "a, b ,c" as a list: trimmed, no empties. */
export function splitList(text: string): string[] {
  const out: string[] = [];
  for (const part of text.split(",")) if (part.trim()) out.push(part.trim());
  return out;
}
