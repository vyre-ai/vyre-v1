// Vault ItemEnv: the pure part. An item is a name plus KEY=value fields (spec 2.17). This file turns pasted text into fields (the Add sheet's "paste understanding", which runs on the
// client and sends fields, see manifests/vault.ts), makes the masked .env block, and works out the diff the Edit sheet shows before it saves. No React, no I/O.

export interface Field { key: string; value: string; secret: boolean }
export type ItemKind = "login" | "api_key" | "env" | "card" | "note" | "totp" | "ssh_key" | "ai_subscription" | "other";

export const KEY_PATTERN = /^[A-Za-z][A-Za-z0-9_]*$/;
/** What an unrevealed value looks like, and what the Edit sheet writes for a value it does not know. Leaving it keeps the stored value. */
export const MASK = "••••••••";

/** A field name the way the prototype types it: upper case, spaces and dashes become underscores. */
export function normalizeKey(raw: string): string {
  return raw.trim().replace(/[\s.-]+/g, "_").replace(/[^A-Za-z0-9_]/g, "").replace(/^[^A-Za-z]+/, "").toUpperCase();
}

const PLAIN_ENDINGS = /(_ID|_URL|_URI|_HOST|_PORT|_USER|_USERNAME|_EMAIL|_REGION|_NAME|_ADDRESS|_ENDPOINT)$/;
/** Plain (not secret) by the key's name: ids, hosts, users and the like. Everything else starts as a secret. */
export function guessSecret(key: string): boolean {
  const k = key.toUpperCase();
  if (/(PASSWORD|SECRET|TOKEN|PRIVATE|PIN|CVV|KEY)$/.test(k) && !/^(PUBLIC|PUBLISHABLE)_/.test(k)) return true;
  return !PLAIN_ENDINGS.test(k) && !/^(TYPE|HOST|PORT|URL|USERNAME|USER|EMAIL|REGION|LOCATION_ID)$/.test(k);
}

/* ---------- .env text ---------- */

export interface ParsedEnv { fields: Field[]; skipped: number }

function unquote(v: string): string {
  const t = v.trim();
  if (t.length >= 2 && ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'")))) return t.slice(1, -1);
  // an unquoted value ends at a trailing comment: KEY=value # note
  const hash = t.search(/\s#/);
  return hash >= 0 ? t.slice(0, hash).trim() : t;
}

/** One field per KEY=value line. Blank lines and # comments are ignored; `export ` is allowed; a later line with the same key wins. */
export function parseEnv(text: string): ParsedEnv {
  const byKey = new Map<string, Field>();
  let skipped = 0;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const m = /^(?:export\s+)?([^=\s]+)\s*=\s*(.*)$/.exec(line);
    if (!m) { skipped++; continue; }
    const key = m[1]!;
    if (!KEY_PATTERN.test(key)) { skipped++; continue; }
    const value = unquote(m[2]!);
    byKey.set(key, { key, value, secret: guessSecret(key) || /:\/\/[^/\s:]*:[^/\s@]*@/.test(value) });
  }
  return { fields: [...byKey.values()], skipped };
}

/** The .env block text. With `values` a field shows its value, otherwise the mask (so nothing unrevealed is ever printed). */
export function formatEnv(fields: readonly { key: string }[], values: ReadonlyMap<string, string> = new Map()): string {
  return fields.map((f) => `${f.key}=${values.get(f.key) ?? MASK}`).join("\n");
}

export interface EnvDiff { added: string[]; changed: string[]; removed: string[] }

/** What saving the edited text would do against the keys the item has now. A value left as the mask keeps the stored value. */
export function diffEnv(currentKeys: readonly string[], text: string): EnvDiff {
  const next = parseEnv(text).fields;
  const nextKeys = new Set(next.map((f) => f.key));
  const had = new Set(currentKeys);
  return {
    added: next.filter((f) => !had.has(f.key)).map((f) => f.key),
    changed: next.filter((f) => had.has(f.key) && f.value !== MASK).map((f) => f.key),
    removed: currentKeys.filter((k) => !nextKeys.has(k)),
  };
}

export const diffIsEmpty = (d: EnvDiff): boolean => d.added.length + d.changed.length + d.removed.length === 0;

export interface UpdateInput { fieldsSet: { key: string; value: string; secret: boolean }[]; fieldsRemove: string[] }

/** The vault.item.update input for an edit: added and changed fields (with their secret flag) and removed keys. */
export function updateFromText(current: readonly { key: string; secret: boolean }[], text: string): UpdateInput {
  const secretOf = new Map(current.map((f) => [f.key, f.secret] as const));
  const diff = diffEnv(current.map((f) => f.key), text);
  const parsed = new Map(parseEnv(text).fields.map((f) => [f.key, f] as const));
  const set = [...diff.added, ...diff.changed].map((k) => ({ key: k, value: parsed.get(k)!.value === MASK ? "" : parsed.get(k)!.value, secret: secretOf.get(k) ?? parsed.get(k)!.secret }));
  return { fieldsSet: set, fieldsRemove: diff.removed };
}

/** "Add 2, change 1, remove GHL_OLD" for the line under the editor. */
export function diffWords(d: EnvDiff): string {
  const bits: string[] = [];
  if (d.added.length) bits.push(`Add ${d.added.join(", ")}`);
  if (d.changed.length) bits.push(`Change ${d.changed.join(", ")}`);
  if (d.removed.length) bits.push(`Remove ${d.removed.join(", ")}`);
  return bits.join(" · ") || "No changes";
}

/* ---------- app templates (the Add sheet's reel) ---------- */

export interface Template { id: string; name: string; kind: ItemKind; keys: { key: string; secret: boolean }[]; hue: number }

const T = (id: string, name: string, kind: ItemKind, keys: [string, boolean][], hue: number): Template => ({ id, name, kind, keys: keys.map(([key, secret]) => ({ key, secret })), hue });

export const CUSTOM: Template = T("custom", "Custom", "env", [], 220);
export const TEMPLATES: readonly Template[] = [
  CUSTOM,
  T("stripe", "Stripe", "api_key", [["STRIPE_SECRET_KEY", true], ["STRIPE_WEBHOOK_SECRET", true]], 250),
  T("github", "GitHub", "api_key", [["GITHUB_TOKEN", true]], 210),
  T("openai", "OpenAI", "api_key", [["OPENAI_API_KEY", true]], 160),
  T("anthropic", "Anthropic", "api_key", [["ANTHROPIC_API_KEY", true]], 20),
  T("highlevel", "GoHighLevel", "api_key", [["GHL_PIT", true], ["GHL_LOCATION_ID", false]], 140),
  T("twilio", "Twilio", "api_key", [["TWILIO_ACCOUNT_SID", false], ["TWILIO_AUTH_TOKEN", true]], 350),
  T("slack", "Slack", "api_key", [["SLACK_BOT_TOKEN", true]], 300),
  T("postgres", "Postgres", "env", [["DATABASE_URL", true]], 200),
  T("lawmatics", "Lawmatics", "api_key", [["LAWMATICS_API_KEY", true]], 110),
  T("login", "Login", "login", [["URL", false], ["USERNAME", false], ["PASSWORD", true]], 40),
  T("card", "Card", "card", [["CARD_NUMBER", true], ["EXPIRY", false], ["CVV", true]], 70),
];

export const templateById = (id: string): Template | undefined => TEMPLATES.find((t) => t.id === id);

/** The reel, narrowed by what was typed (a name or part of one). Custom stays first. */
export function filterTemplates(query: string): Template[] {
  const q = query.trim().toLowerCase();
  return q ? TEMPLATES.filter((t) => t.id === "custom" || t.name.toLowerCase().includes(q)) : [...TEMPLATES];
}

/** An empty form for a template: its own keys, no values. */
export function fieldsFor(t: Template): Field[] {
  return t.keys.map((k) => ({ key: k.key, value: "", secret: k.secret }));
}

/* ---------- paste understanding ---------- */

export interface Understood {
  /** What the paste looked like. `none` means nothing could be read. */
  shape: "env" | "key" | "json" | "url" | "text" | "none";
  template?: string;
  itemKind: ItemKind;
  name?: string;
  fields: Field[];
  /** The one-line status: what was understood. */
  note: string;
}

const KEY_SHAPES: { re: RegExp; template: string; key: string; name: string }[] = [
  { re: /^sk-ant-/, template: "anthropic", key: "ANTHROPIC_API_KEY", name: "Anthropic" },
  { re: /^(sk|rk)_(live|test)_/, template: "stripe", key: "STRIPE_SECRET_KEY", name: "Stripe" },
  { re: /^(ghp_|github_pat_|gho_)/, template: "github", key: "GITHUB_TOKEN", name: "GitHub" },
  { re: /^sk-(proj-)?[A-Za-z0-9_-]{20,}/, template: "openai", key: "OPENAI_API_KEY", name: "OpenAI" },
  { re: /^xox[bp]-/, template: "slack", key: "SLACK_BOT_TOKEN", name: "Slack" },
  { re: /^pit-[0-9a-f-]{20,}/i, template: "highlevel", key: "GHL_PIT", name: "GoHighLevel" },
  { re: /^AC[0-9a-f]{32}$/, template: "twilio", key: "TWILIO_ACCOUNT_SID", name: "Twilio" },
  { re: /^AKIA[0-9A-Z]{16}$/, template: "custom", key: "AWS_ACCESS_KEY_ID", name: "AWS" },
];

const host = (url: string): string => {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return ""; }
};
const titleCase = (h: string): string => { const base = h.split(".")[0] ?? h; return base ? base[0]!.toUpperCase() + base.slice(1) : h; };

function fromJson(obj: Record<string, unknown>): Understood {
  const fields: Field[] = [];
  for (const [k, v] of Object.entries(obj)) {
    if (v === null || typeof v === "object") continue;
    const key = normalizeKey(k);
    if (!key) continue;
    const secret = /(PRIVATE|SECRET|TOKEN|PASSWORD|KEY)/.test(key) && key !== "PRIVATE_KEY_ID" ? true : key === "PRIVATE_KEY_ID" ? false : guessSecret(key);
    fields.push({ key, value: String(v), secret });
  }
  const name = typeof obj.project_id === "string" ? `${titleCase(obj.project_id)} service account` : undefined;
  return { shape: "json", itemKind: "other", ...(name ? { name } : {}), fields, note: fields.length ? `Read a JSON file: ${fields.length} ${fields.length === 1 ? "field" : "fields"} from its top level` : "That JSON has no top-level values to keep" };
}

/**
 * What a paste means: a .env (a field per line), one bare key (matched to its app by shape, named from its guessed type), JSON (fields from its top-level keys),
 * a link (URL, username, password) or plain text (one secret field). Nothing is stored here; the Add sheet shows the result and an Undo.
 */
export function understandPaste(raw: string): Understood {
  const text = raw.trim();
  if (!text) return { shape: "none", itemKind: "env", fields: [], note: "" };
  if (text.startsWith("{") && text.endsWith("}")) {
    try { const o = JSON.parse(text) as unknown; if (o && typeof o === "object" && !Array.isArray(o)) return fromJson(o as Record<string, unknown>); } catch { /* not JSON, fall through */ }
  }
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
  if (lines.length > 0 && lines.every((l) => /^(?:export\s+)?[A-Za-z][A-Za-z0-9_]*\s*=/.test(l))) {
    const { fields } = parseEnv(text);
    const prefix = commonPrefix(fields.map((f) => f.key));
    return { shape: "env", itemKind: "env", ...(prefix ? { name: titleCase(prefix.toLowerCase()) } : {}), fields, note: `Read a .env: ${fields.length} ${fields.length === 1 ? "key" : "keys"}` };
  }
  if (lines.length === 1 && /^[a-z][a-z0-9+.-]*:\/\/\S+$/i.test(text)) {
    const scheme = text.split(":")[0]!.toLowerCase();
    if (scheme === "postgres" || scheme === "postgresql" || scheme === "mysql" || scheme === "mongodb" || scheme === "redis") {
      return { shape: "url", template: "postgres", itemKind: "env", name: `${titleCase(host(text) || scheme)} database`, fields: [{ key: "DATABASE_URL", value: text, secret: true }], note: "Read a database link as DATABASE_URL" };
    }
    let user = "", pass = "";
    try { const u = new URL(text); user = decodeURIComponent(u.username); pass = decodeURIComponent(u.password); } catch { /* keep blank */ }
    const h = host(text);
    return {
      shape: "url", template: "login", itemKind: "login", ...(h ? { name: titleCase(h) } : {}),
      fields: [{ key: "URL", value: text.replace(/\/\/[^/@]*@/, "//"), secret: false }, { key: "USERNAME", value: user, secret: false }, { key: "PASSWORD", value: pass, secret: true }],
      note: `Read a link: URL, username and password for ${h || "the site"}`,
    };
  }
  if (lines.length === 1 && !/\s/.test(text)) {
    for (const s of KEY_SHAPES) {
      if (s.re.test(text)) return { shape: "key", template: s.template, itemKind: s.template === "custom" ? "api_key" : (templateById(s.template)?.kind ?? "api_key"), name: s.name, fields: [{ key: s.key, value: text, secret: true }], note: `Read one key, matched to ${s.name} by its shape` };
    }
    return { shape: "key", itemKind: "api_key", fields: [{ key: "API_KEY", value: text, secret: true }], note: "Read one key as API_KEY. Rename it if it is something else" };
  }
  return { shape: "text", itemKind: "note", fields: [{ key: "NOTE", value: text, secret: true }], note: "Kept as one secret note" };
}

function commonPrefix(keys: readonly string[]): string {
  if (keys.length < 2) return "";
  const parts = keys.map((k) => k.split("_")[0]!);
  const first = parts[0]!;
  return parts.every((p) => p === first) && first.length > 1 ? first : "";
}

/** Merge understood fields into the form: a key already there takes the new value, new keys are added, blank starter rows are dropped. */
export function mergeFields(current: readonly Field[], add: readonly Field[]): Field[] {
  const out = new Map<string, Field>();
  for (const f of current) if (f.key) out.set(f.key, f);
  for (const f of add) out.set(f.key, f);
  return [...out.values()];
}

/* ---------- the Edit sheet's two views of one list ---------- */

/** The rows as .env text. A value the person has not typed is the mask. */
export function rowsToText(rows: readonly Field[]): string {
  return rows.filter((r) => r.key).map((r) => `${r.key}=${r.value === "" ? MASK : r.value}`).join("\n");
}

/** The .env text as rows. A key the item already had keeps its secret flag; a new key guesses it. */
export function textToRows(text: string, current: readonly Field[]): Field[] {
  const had = new Map(current.map((f) => [f.key, f.secret] as const));
  return parseEnv(text).fields.map((f) => ({ ...f, secret: had.get(f.key) ?? f.secret }));
}

/** Row i with some fields changed. Kept here, away from the JSX, so the field editors stay plain handlers. */
export function patchAt<T>(rows: readonly T[], i: number, patch: Partial<T>): T[] {
  const out = rows.slice();
  const cur = out[i];
  if (cur !== undefined) out[i] = { ...cur, ...patch };
  return out;
}

export const keysOf = (rows: readonly { key: string }[]): string[] => rows.map((r) => r.key);

/** Rows with a typed secret flag applied by key. */
export function withFlags<T extends { key: string; secret: boolean }>(rows: readonly T[], flags: ReadonlyMap<string, boolean>): T[] {
  return rows.map((r) => ({ ...r, secret: flags.get(r.key) ?? r.secret }));
}
