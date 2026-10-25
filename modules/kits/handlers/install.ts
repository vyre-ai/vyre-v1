// kits core (spec 2.21, 4.16; ARCH 7.6): the Kit format, what a Kit shows before it installs, versions per channel, install, update and one-click rollback.
// A Kit is data: a list of items, each with an optional apply step and undo step that are ordinary capability calls, plus sandboxed scripts and tests.
// Installing runs the apply steps as the installing person, so the Gate, permissions and audit all apply to what a Kit does. The install sheet lists every
// capability a Kit will call, the record types, network domains and Vault handle names it names, and how many scripts it ships; nothing is hidden behind a name.
// What an install applied is kept in kits_applied (item, hash, undo step), so an update and a rollback are the same diff between what is applied and what the target version wants.
// Built-in and folder Kits come from the KitSource the host passes to configureKits; published versions are stored whole in kits_version.
// @reads ../migrations/0001_kits.sql

import type { Ctx } from "../../../packages/contracts/src/ctx.ts";
import type { ErrorCode } from "../../../packages/contracts/src/types.ts";
import { canonical } from "../../../lib/canonical.ts";
import { mintUuid } from "../../../lib/ids.ts";
import { fail as hostFail } from "../../../host/src/routes/errors.ts";
import { registry } from "../../../generated/registry.ts";
import { validate } from "../../../packages/contracts/src/jsonschema.ts";

export type KitChannel = "stable" | "beta";
export type ContentType = "ui" | "structure" | "steps" | "tools";

export interface KitStep {
  cap: string;
  input: Record<string, unknown>;
}

export interface KitItem {
  /** unique inside the Kit; the same key in a later version means the same item */
  key: string;
  content: ContentType;
  /** record_type, layout, words, tokens, automation, journey, agent, form, runbook, project, connector, mcp, ... */
  type: string;
  title: string;
  apply?: KitStep;
  undo?: KitStep;
  /** the record type name this item creates, shown on the install sheet */
  recordType?: string;
  /** capabilities an agent or connector in this item may use */
  tools?: string[];
  networkDomains?: string[];
  /** Vault handles (names only) this item needs */
  vaultNames?: string[];
}

export interface KitScript {
  name: string;
  source: string;
  /** the only capabilities api.call may reach from this script */
  caps: string[];
}

export interface ScriptTest {
  name: string;
  kind: "script";
  script: string;
  input?: unknown;
  expect: { value?: unknown; denied?: string[]; error?: string };
}

export interface SpaceTest {
  name: string;
  kind: "space";
  /** calls made after the Kit is applied to the fixture Space and before the checks */
  seed?: KitStep[];
  expect: { events?: { name: string; payload?: Record<string, unknown> }[]; views?: { cap: string; input?: Record<string, unknown>; rows?: number; contains?: Record<string, unknown> }[] };
}

export type KitTest = ScriptTest | SpaceTest;

export interface KitManifest {
  key: string;
  title: string;
  /** semver */
  version: string;
  channel: KitChannel;
  description?: string;
  items: KitItem[];
  scripts?: KitScript[];
  tests?: KitTest[];
}

export interface KitSource {
  /** every Kit shipped with this server (kits/<key>/ folders); each version is trusted because kits.yml tested it in CI */
  catalog(): Promise<unknown[]>;
  /** one published-or-pending version of a Kit from the Space's Kit folders */
  read(key: string, version: string): Promise<unknown | null>;
  /** the working copy a person or the builder agent is editing, for test runs */
  working(key: string): Promise<unknown | null>;
}

export interface FixtureSpace {
  call(cap: string, input: unknown): Promise<unknown>;
  events(): { name: string; payload: unknown }[];
  close(): Promise<void>;
}

export interface KitsConfig {
  source: KitSource;
  /** opens a fresh seeded fixture Space (the host builds it with the test kit); required to publish */
  fixture?: () => Promise<FixtureSpace>;
  /** the agent the Kit builder chat opens with */
  builderAgentId?: string;
  /**
   * The host makes a Kit a resource in the Space's access projection (type "kit"), which kits.get, kits.install_sheet, kits.install and the rest are authorized against. A module cannot
   * create resources itself; the host does it for it, idempotently (the same Kit is the same resource after a reboot). Omitted: nothing registers them (tests that fake access).
   */
  resources?: { ensure(kitId: string): Promise<void> };
}

let configured: KitsConfig | null = null;

/** The host calls this once at start. Tests pass fakes; null clears. */
export function configureKits(config: KitsConfig | null): void {
  configured = config;
  registered.clear();
}

export function kitsConfig(): KitsConfig | null {
  return configured;
}

export type Row = Record<string, unknown>;

// ---- helpers ------------------------------------------------------------------------------------------------

export function fail(ctx: Ctx, code: ErrorCode, message?: string, details?: Record<string, unknown>): never {
  throw hostFail(code, ctx.trace.traceId, { ...(message ? { message } : {}), ...(details ? { details } : {}) });
}

export const str = (v: unknown): string => (typeof v === "string" ? v : "");
export const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
export const isNull = (v: unknown): boolean => v === null || v === undefined;
export const one = (ctx: Ctx, sql: string, ...args: unknown[]): Row | undefined => (ctx.db.all(sql, ...args) as Row[])[0];
export const many = (ctx: Ctx, sql: string, ...args: unknown[]): Row[] => ctx.db.all(sql, ...args) as Row[];
export const nid = (ctx: Ctx, prefix: string): string => `${prefix}_${mintUuid(ctx.now()).replaceAll("-", "")}`;

export function rec(ctx: Ctx, input: unknown): Record<string, unknown> {
  if (input === undefined || input === null) return {};
  if (typeof input !== "object" || Array.isArray(input)) fail(ctx, "validation.bad_input", "The input is not valid.");
  return input as Record<string, unknown>;
}

export function reqStr(ctx: Ctx, o: Record<string, unknown>, key: string): string {
  const v = o[key];
  if (typeof v !== "string" || v.length === 0) fail(ctx, "validation.bad_input", "The input is not valid.", { field: key });
  return v;
}

export function optStr(ctx: Ctx, o: Record<string, unknown>, key: string): string | undefined {
  const v = o[key];
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "string") fail(ctx, "validation.bad_input", "The input is not valid.", { field: key });
  return v;
}

export async function sha256hex(text: string): Promise<string> {
  const d = new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
  return Array.from(d, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function pageOf(ctx: Ctx, o: Record<string, unknown>): { offset: number; limit: number } {
  const cursor = optStr(ctx, o, "cursor");
  const offset = cursor === undefined ? 0 : Number(cursor);
  if (!Number.isInteger(offset) || offset < 0) fail(ctx, "validation.bad_input", "That page cursor is not valid.", { field: "cursor" });
  const lim = o.limit;
  if (lim !== undefined && lim !== null && (typeof lim !== "number" || !Number.isInteger(lim) || lim < 1 || lim > 500)) fail(ctx, "validation.bad_input", "The input is not valid.", { field: "limit" });
  return { offset, limit: typeof lim === "number" ? lim : 100 };
}

// ---- semver -------------------------------------------------------------------------------------------------

const SEMVER = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/;

export function isSemver(v: string): boolean {
  return SEMVER.test(v);
}

/** Negative when a is older than b. A prerelease is older than its release; prerelease parts compare as numbers when both are numbers. */
export function compareSemver(a: string, b: string): number {
  const x = SEMVER.exec(a), y = SEMVER.exec(b);
  if (!x || !y) throw new TypeError("not a semver version");
  for (let i = 1; i <= 3; i++) {
    const d = Number(x[i]) - Number(y[i]);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  const pa = x[4], pb = y[4];
  if (pa === undefined && pb === undefined) return 0;
  if (pa === undefined) return 1;
  if (pb === undefined) return -1;
  const as = pa.split("."), bs = pb.split(".");
  for (let i = 0; i < Math.max(as.length, bs.length); i++) {
    const l = as[i], r = bs[i];
    if (l === undefined) return -1;
    if (r === undefined) return 1;
    const ln = /^\d+$/.test(l), rn = /^\d+$/.test(r);
    if (ln && rn) { const d = Number(l) - Number(r); if (d !== 0) return d < 0 ? -1 : 1; }
    else if (ln !== rn) return ln ? -1 : 1;
    else if (l !== r) return l < r ? -1 : 1;
  }
  return 0;
}

// ---- the Kit format -----------------------------------------------------------------------------------------

const KEY = /^[a-z][a-z0-9-]{1,40}$/;
const ITEM_KEY = /^[a-z][a-z0-9_.-]{0,60}$/;
const CAP = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*){1,3}$/;
const HOST = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/;
const HANDLE = /^#[A-Za-z0-9_]+(\.[A-Za-z0-9_]+)?$/;
const CONTENT: readonly ContentType[] = ["ui", "structure", "steps", "tools"];
/** A Kit never installs Kits and never reads secret values: those capabilities cannot appear in a step, tool list or script. */
const FORBIDDEN: readonly RegExp[] = [/^kits\./, /^vault\.(item\.get|export_env|export|use|fill)$/];
export const MAX_ITEMS = 500;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

export function forbiddenCap(cap: string): boolean {
  return FORBIDDEN.some((re) => re.test(cap));
}

/** Checks a manifest read from a Kit folder. Returns the Kit or every problem, each a sentence naming the path. */
export function checkKit(raw: unknown): { kit: KitManifest; problems: [] } | { kit: null; problems: string[] } {
  const problems: string[] = [];
  const bad = (path: string, message: string): void => { problems.push(`${path}: ${message}`); };
  if (!isObj(raw)) return { kit: null, problems: ["a Kit is an object"] };
  if (typeof raw.key !== "string" || !KEY.test(raw.key)) bad("key", "lowercase letters, digits and dashes, 2 to 41 characters");
  if (typeof raw.title !== "string" || raw.title.trim() === "" || raw.title.length > 80) bad("title", "a name of 1 to 80 characters");
  if (typeof raw.version !== "string" || !isSemver(raw.version)) bad("version", "a semver version such as 1.2.0");
  if (raw.channel !== undefined && raw.channel !== "stable" && raw.channel !== "beta") bad("channel", "stable or beta");
  if (raw.description !== undefined && (typeof raw.description !== "string" || raw.description.length > 300)) bad("description", "a sentence of at most 300 characters");

  const stepOf = (v: unknown, path: string): KitStep | undefined => {
    if (v === undefined) return undefined;
    if (!isObj(v) || typeof v.cap !== "string" || !CAP.test(v.cap) || (v.input !== undefined && !isObj(v.input))) { bad(path, "a step is { cap, input } with a capability name"); return undefined; }
    if (forbiddenCap(v.cap)) { bad(path, `${v.cap} cannot be used by a Kit`); return undefined; }
    return { cap: v.cap, input: (v.input ?? {}) as Record<string, unknown> };
  };
  const strings = (v: unknown, path: string, ok: (s: string) => boolean, what: string): string[] | undefined => {
    if (v === undefined) return undefined;
    if (!Array.isArray(v) || v.length > 100 || !v.every((s) => typeof s === "string" && ok(s))) { bad(path, `a list of ${what}`); return undefined; }
    return [...new Set(v as string[])];
  };

  const items: KitItem[] = [];
  if (!Array.isArray(raw.items) || raw.items.length === 0 || raw.items.length > MAX_ITEMS) bad("items", `1 to ${MAX_ITEMS} items`);
  else {
    const seen = new Set<string>();
    raw.items.forEach((it: unknown, i: number) => {
      const at = `items[${i}]`;
      if (!isObj(it)) { bad(at, "an item is an object"); return; }
      const key = it.key;
      if (typeof key !== "string" || !ITEM_KEY.test(key)) { bad(`${at}.key`, "lowercase letters, digits, dots, dashes and underscores"); return; }
      if (seen.has(key)) { bad(`${at}.key`, `${key} is used twice`); return; }
      seen.add(key);
      if (!CONTENT.includes(it.content as ContentType)) bad(`${at}.content`, "ui, structure, steps or tools");
      if (typeof it.type !== "string" || !/^[a-z][a-z0-9_]{0,39}$/.test(it.type)) bad(`${at}.type`, "a type such as record_type or automation");
      if (typeof it.title !== "string" || it.title.trim() === "" || it.title.length > 120) bad(`${at}.title`, "a title of 1 to 120 characters");
      const apply = stepOf(it.apply, `${at}.apply`), undo = stepOf(it.undo, `${at}.undo`);
      if (it.recordType !== undefined && (typeof it.recordType !== "string" || !/^[a-z][a-z0-9_]*$/.test(it.recordType))) bad(`${at}.recordType`, "a record type name such as contact");
      const tools = strings(it.tools, `${at}.tools`, (s) => CAP.test(s) && !forbiddenCap(s), "capability names a Kit may use");
      const networkDomains = strings(it.networkDomains, `${at}.networkDomains`, (s) => HOST.test(s), "host names");
      const vaultNames = strings(it.vaultNames, `${at}.vaultNames`, (s) => HANDLE.test(s), "Vault handles such as #Stripe_Key");
      items.push({
        key, content: it.content as ContentType, type: String(it.type), title: String(it.title),
        ...(apply ? { apply } : {}), ...(undo ? { undo } : {}), ...(typeof it.recordType === "string" ? { recordType: it.recordType } : {}),
        ...(tools ? { tools } : {}), ...(networkDomains ? { networkDomains } : {}), ...(vaultNames ? { vaultNames } : {}),
      });
    });
  }

  const scripts: KitScript[] = [];
  if (raw.scripts !== undefined) {
    if (!Array.isArray(raw.scripts) || raw.scripts.length > 50) bad("scripts", "at most 50 scripts");
    else {
      const seen = new Set<string>();
      raw.scripts.forEach((sc: unknown, i: number) => {
        const at = `scripts[${i}]`;
        if (!isObj(sc) || typeof sc.name !== "string" || !ITEM_KEY.test(sc.name) || typeof sc.source !== "string" || sc.source.trim() === "" || sc.source.length > 20_000) { bad(at, "a script has a name and source of at most 20000 characters"); return; }
        if (seen.has(sc.name)) { bad(at, `${sc.name} is used twice`); return; }
        seen.add(sc.name);
        const caps = strings(sc.caps ?? [], `${at}.caps`, (s) => CAP.test(s) && !forbiddenCap(s), "capability names a script may call") ?? [];
        scripts.push({ name: sc.name, source: sc.source, caps });
      });
    }
  }

  const tests: KitTest[] = [];
  if (raw.tests !== undefined) {
    if (!Array.isArray(raw.tests) || raw.tests.length > 200) bad("tests", "at most 200 tests");
    else {
      const names = new Set(scripts.map((s) => s.name));
      raw.tests.forEach((tt: unknown, i: number) => {
        const at = `tests[${i}]`;
        if (!isObj(tt) || typeof tt.name !== "string" || tt.name === "" || !isObj(tt.expect)) { bad(at, "a test has a name and an expect object"); return; }
        if (tt.kind === "script") {
          if (typeof tt.script !== "string" || !names.has(tt.script)) { bad(`${at}.script`, "names a script of this Kit"); return; }
          tests.push({ name: tt.name, kind: "script", script: tt.script, ...(tt.input !== undefined ? { input: tt.input } : {}), expect: tt.expect as ScriptTest["expect"] });
        } else if (tt.kind === "space") {
          const seed = tt.seed === undefined ? [] : Array.isArray(tt.seed) ? tt.seed.map((s, j) => stepOf(s, `${at}.seed[${j}]`)).filter((s): s is KitStep => s !== undefined) : (bad(`${at}.seed`, "a list of steps"), []);
          tests.push({ name: tt.name, kind: "space", ...(seed.length ? { seed } : {}), expect: tt.expect as SpaceTest["expect"] });
        } else bad(`${at}.kind`, "script or space");
      });
    }
  }

  if (problems.length > 0) return { kit: null, problems };
  const kit: KitManifest = {
    key: raw.key as string, title: raw.title as string, version: raw.version as string, channel: (raw.channel as KitChannel | undefined) ?? "stable",
    ...(typeof raw.description === "string" ? { description: raw.description } : {}), items, ...(scripts.length ? { scripts } : {}), ...(tests.length ? { tests } : {}),
  };
  return { kit, problems: [] };
}

export interface InstallSheet {
  tools: string[];
  recordTypes: string[];
  networkDomains: string[];
  vaultNames: string[];
  scripts: number;
  problems: SheetProblem[];
}

export interface SheetProblem { item: string; step: "apply" | "undo"; cap: string; input: Record<string, unknown>; message: string }

/** Everything the Kit will touch, from its own manifest. Sorted, so the sheet is the same every time. */
export function sheetOf(kit: KitManifest): InstallSheet {
  const tools = new Set<string>(), types = new Set<string>(), domains = new Set<string>(), vault = new Set<string>();
  for (const it of kit.items) {
    for (const t of it.tools ?? []) tools.add(t);
    if (it.apply) tools.add(it.apply.cap);
    if (it.undo) tools.add(it.undo.cap);
    if (it.type === "record_type") types.add(it.recordType ?? it.key);
    for (const d of it.networkDomains ?? []) domains.add(d);
    for (const v of it.vaultNames ?? []) vault.add(v);
  }
  for (const s of kit.scripts ?? []) for (const c of s.caps) tools.add(c);
  const sort = (s: Set<string>): string[] => [...s].sort();
  return { tools: sort(tools), recordTypes: sort(types), networkDomains: sort(domains), vaultNames: sort(vault), scripts: (kit.scripts ?? []).length, problems: [] };
}

export function contentsOf(kit: KitManifest): ContentType[] {
  return CONTENT.filter((c) => kit.items.some((it) => it.content === c));
}

// ---- storage ------------------------------------------------------------------------------------------------

export interface KitRow {
  id: string;
  key: string;
  title: string;
  channel: KitChannel;
  builtin: boolean;
  installedVersion: string | null;
  previousVersion: string | null;
}

export function kitOf(r: Row): KitRow {
  return {
    id: str(r.id), key: str(r.key), title: str(r.title), channel: str(r.channel) as KitChannel, builtin: num(r.builtin) === 1,
    installedVersion: isNull(r.installed_version) ? null : str(r.installed_version), previousVersion: isNull(r.previous_version) ? null : str(r.previous_version),
  };
}

export function mustKit(ctx: Ctx, kitId: string): KitRow {
  const r = one(ctx, "SELECT * FROM kits_kit WHERE id = ?", kitId);
  if (!r) fail(ctx, "validation.not_found", "That Kit does not exist.");
  return kitOf(r);
}

export function parseManifest(row: Row): KitManifest {
  return JSON.parse(str(row.content)) as KitManifest;
}

export function versionRow(ctx: Ctx, kitId: string, version: string): Row | undefined {
  return one(ctx, "SELECT * FROM kits_version WHERE kit_id = ? AND version = ?", kitId, version);
}

/** The newest published version on a channel: the head, which restore_version can move back. */
export function headOf(ctx: Ctx, kitId: string, channel: KitChannel): Row | undefined {
  const h = one(ctx, "SELECT * FROM kits_head WHERE kit_id = ? AND channel = ?", kitId, channel);
  return h ? one(ctx, "SELECT * FROM kits_version WHERE id = ?", h.version_id) : undefined;
}

export function setHead(ctx: Ctx, kitId: string, channel: KitChannel, versionId: string): void {
  if (one(ctx, "SELECT * FROM kits_head WHERE kit_id = ? AND channel = ?", kitId, channel)) ctx.db.run("UPDATE kits_head SET version_id = ? WHERE kit_id = ? AND channel = ?", versionId, kitId, channel);
  else ctx.db.run("INSERT INTO kits_head (kit_id, channel, version_id) VALUES (?, ?, ?)", kitId, channel, versionId);
}

export async function storeVersion(ctx: Ctx, kitId: string, kit: KitManifest, by: string): Promise<Row> {
  const content = JSON.stringify(kit);
  const id = nid(ctx, "ver");
  ctx.db.run(
    "INSERT INTO kits_version (id, kit_id, version, channel, content, hash, published_by, at, state) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    id, kitId, kit.version, kit.channel, content, await sha256hex(canonical(kit)), by, ctx.now(), "live",
  );
  return one(ctx, "SELECT * FROM kits_version WHERE id = ?", id) as Row;
}

/** Kits already registered as resources by this process; the host's ensure is idempotent, this only saves asking again. */
const registered = new Set<string>();
async function registerResource(kitId: string): Promise<void> {
  const r = configured?.resources;
  if (!r || registered.has(kitId)) return;
  await r.ensure(kitId);
  registered.add(kitId);
}

/** Makes sure every Kit the server ships has a row, a version row and a head. Idempotent; a Kit that fails its own check is skipped with a warning. */
export async function ensureCatalog(ctx: Ctx): Promise<void> {
  const src = configured?.source;
  if (!src) return;
  for (const raw of await src.catalog()) {
    const checked = checkKit(raw);
    if (!checked.kit) {
      ctx.log.warn("kits: a shipped Kit is not valid", { problems: checked.problems.slice(0, 3).join("; ") });
      continue;
    }
    const kit = checked.kit;
    let row = one(ctx, "SELECT * FROM kits_kit WHERE key = ?", kit.key);
    if (!row) {
      const id = nid(ctx, "kit"), now = ctx.now();
      ctx.db.run("INSERT INTO kits_kit (id, key, title, channel, builtin, installed_version, previous_version, installed_by, installed_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", id, kit.key, kit.title, kit.channel, 1, null, null, null, null, now, now);
      row = one(ctx, "SELECT * FROM kits_kit WHERE id = ?", id) as Row;
    }
    const kitId = str(row.id);
    await registerResource(kitId);
    let v = versionRow(ctx, kitId, kit.version);
    const isNew = !v;
    if (!v) v = await storeVersion(ctx, kitId, kit, "builtin");
    // only a version the server has not seen before can take the head, so a restore_version is not undone by the next list
    const head = headOf(ctx, kitId, kit.channel);
    if (!head || (isNew && compareSemver(kit.version, str(head.version)) > 0)) setHead(ctx, kitId, kit.channel, str(v.id));
  }
}

export interface KitOut {
  kitId: string;
  key: string;
  title: string;
  version: string;
  channel: KitChannel;
  installed: boolean;
  contents: ContentType[];
}

export function kitOut(ctx: Ctx, k: KitRow): KitOut {
  const head = headOf(ctx, k.id, k.channel);
  const version = k.installedVersion ?? (head ? str(head.version) : "");
  const vr = version ? versionRow(ctx, k.id, version) : undefined;
  return { kitId: k.id, key: k.key, title: k.title, version, channel: k.channel, installed: k.installedVersion !== null, contents: vr ? contentsOf(parseManifest(vr)) : [] };
}

/** The manifest the sheet and preview describe: what is installed, else the head of the Kit's channel. */
function describedVersion(ctx: Ctx, k: KitRow): Row {
  const r = k.installedVersion !== null ? versionRow(ctx, k.id, k.installedVersion) : headOf(ctx, k.id, k.channel);
  if (!r) fail(ctx, "validation.precondition_failed", "This Kit has no published version yet.");
  return r;
}

// ---- reads --------------------------------------------------------------------------------------------------

async function list(ctx: Ctx, input: unknown): Promise<{ kits: KitOut[]; next?: string; total: number }> {
  const o = rec(ctx, input);
  const { offset, limit } = pageOf(ctx, o);
  await ensureCatalog(ctx);
  const rows = many(ctx, "SELECT * FROM kits_kit").map(kitOf).sort((a, b) => a.title.localeCompare(b.title) || a.key.localeCompare(b.key));
  const out: { kits: KitOut[]; next?: string; total: number } = { kits: rows.slice(offset, offset + limit).map((k) => kitOut(ctx, k)), total: rows.length };
  if (offset + limit < rows.length) out.next = String(offset + limit);
  return out;
}

async function get(ctx: Ctx, input: unknown): Promise<{ kit: KitOut }> {
  await ensureCatalog(ctx);
  return { kit: kitOut(ctx, mustKit(ctx, reqStr(ctx, rec(ctx, input), "kitId"))) };
}

/**
 * The sheet check: every apply and undo step against the contract it will call, before anyone presses Install. A step is a problem when the capability does not exist, its input does not
 * fit the capability's input schema, or it creates a record type the Space already has (a Kit that was installed from the same source, or one the manifests seed).
 */
async function sheetProblems(ctx: Ctx, kit: KitManifest): Promise<SheetProblem[]> {
  const caps = new Map<string, (typeof registry.capabilities)[number]>();
  for (const c of registry.capabilities) { const old = caps.get(c.name); if (!old || c.v > old.v) caps.set(c.name, c); }
  const out: SheetProblem[] = [];
  const seenTypes = new Set<string>();
  for (const it of kit.items) {
    for (const which of ["apply", "undo"] as const) {
      const step = it[which];
      if (!step) continue;
      const def = caps.get(step.cap);
      const add = (message: string): void => { out.push({ item: it.key, step: which, cap: step.cap, input: step.input, message }); };
      if (!def) { add(`${step.cap} is not a capability on this server.`); continue; }
      const bad = validate(def.input, step.input, "", registry.$defs);
      if (bad.length) { add(`The input does not fit ${step.cap}: ${bad.slice(0, 3).join("; ")}`); continue; }
      if (which !== "apply" || step.cap !== "schema.apply") continue;
      for (const op of Array.isArray(step.input["ops"]) ? (step.input["ops"] as Record<string, unknown>[]) : []) {
        if (op["op"] !== "type.create" || typeof op["type"] !== "string") continue;
        const type = op["type"];
        if (seenTypes.has(type)) { add(`Record type ${type} is created twice in this Kit.`); continue; }
        seenTypes.add(type);
        let exists = false;
        try { await ctx.call("schema.types.get" as never, { type } as never); exists = true; } catch { /* not there, or the caller may not read it: the install will say */ }
        if (exists) add(`Record type ${type} already exists in this Space.`);
      }
    }
  }
  return out;
}

async function installSheet(ctx: Ctx, input: unknown): Promise<{ sheet: InstallSheet }> {
  await ensureCatalog(ctx);
  const k = mustKit(ctx, reqStr(ctx, rec(ctx, input), "kitId"));
  const manifest = parseManifest(describedVersion(ctx, k));
  return { sheet: { ...sheetOf(manifest), problems: await sheetProblems(ctx, manifest) } };
}

async function versions(ctx: Ctx, input: unknown): Promise<{ versions: { versionId: string; version: string; at: number; by: string; channel: KitChannel }[] }> {
  await ensureCatalog(ctx);
  const k = mustKit(ctx, reqStr(ctx, rec(ctx, input), "kitId"));
  const rows = many(ctx, "SELECT * FROM kits_version WHERE kit_id = ?", k.id).sort((a, b) => num(b.at) - num(a.at) || compareSemver(str(b.version), str(a.version)));
  return { versions: rows.map((r) => ({ versionId: str(r.id), version: str(r.version), at: num(r.at), by: str(r.published_by), channel: str(r.channel) as KitChannel })) };
}

async function restoreVersion(ctx: Ctx, input: unknown): Promise<{ kit: KitOut }> {
  const o = rec(ctx, input);
  const k = mustKit(ctx, reqStr(ctx, o, "kitId"));
  const v = one(ctx, "SELECT * FROM kits_version WHERE id = ? AND kit_id = ?", reqStr(ctx, o, "versionId"), k.id);
  if (!v) fail(ctx, "validation.not_found", "That version does not exist.");
  setHead(ctx, k.id, str(v.channel) as KitChannel, str(v.id));
  return { kit: kitOut(ctx, mustKit(ctx, k.id)) };
}

async function choose(ctx: Ctx, input: unknown): Promise<{ ok: true }> {
  const o = rec(ctx, input);
  const k = mustKit(ctx, reqStr(ctx, o, "kitId"));
  const scope = reqStr(ctx, o, "scope");
  if (scope !== "space" && scope !== "person") fail(ctx, "validation.bad_input", "Choose space or person.", { field: "scope" });
  if (k.installedVersion === null) fail(ctx, "validation.precondition_failed", "Install this Kit before choosing it.");
  await ctx.call(scope === "space" ? "settings.kit.set_space" : "settings.kit.set_mine", { kitId: k.id });
  return { ok: true };
}

async function builderOpen(ctx: Ctx, input: unknown): Promise<{ threadId: string }> {
  const o = rec(ctx, input);
  const agent = configured?.builderAgentId;
  if (!agent) fail(ctx, "validation.precondition_failed", "No agent is set up to build Kits on this server yet.");
  const kitId = optStr(ctx, o, "kitId");
  const brief = optStr(ctx, o, "brief");
  const k = kitId ? mustKit(ctx, kitId) : null;
  const made = (await ctx.call("chat.start", {
    kind: "chat", agentIds: [agent], title: k ? `Kit builder: ${k.title}` : "Kit builder", ...(k ? { scopeType: "kit", scopeId: k.id } : {}), ...(brief ? { first: brief } : {}),
  })) as { thread?: { threadId?: string } };
  const threadId = made.thread?.threadId;
  if (typeof threadId !== "string") fail(ctx, "internal.unexpected", "The builder chat was not created.");
  return { threadId };
}

// ---- diff, preview, install, update, rollback ---------------------------------------------------------------

export interface Change {
  op: "add" | "change" | "remove";
  item: KitItem;
}

interface Applied { key: string; hash: string; undo: KitStep | null }

function appliedOf(ctx: Ctx, kitId: string): Applied[] {
  return many(ctx, "SELECT * FROM kits_applied WHERE kit_id = ?", kitId)
    .sort((a, b) => num(a.at) - num(b.at) || str(a.item_key).localeCompare(str(b.item_key)))
    .map((r) => ({ key: str(r.item_key), hash: str(r.item_hash), undo: isNull(r.undo) ? null : (JSON.parse(str(r.undo)) as KitStep) }));
}

async function itemHash(it: KitItem): Promise<string> {
  return sha256hex(canonical(it));
}

/** What moving to `target` changes, from what is applied now (nothing applied means everything is an add). Removed items carry their stored undo. */
export async function diffTo(ctx: Ctx, kitId: string, target: KitManifest): Promise<{ changes: Change[]; hashes: Map<string, string> }> {
  const applied = appliedOf(ctx, kitId);
  const byKey = new Map(applied.map((a) => [a.key, a]));
  const changes: Change[] = [];
  const hashes = new Map<string, string>();
  for (const it of target.items) {
    const h = await itemHash(it);
    hashes.set(it.key, h);
    const have = byKey.get(it.key);
    if (!have) changes.push({ op: "add", item: it });
    else if (have.hash !== h) changes.push({ op: "change", item: it });
  }
  const wanted = new Set(target.items.map((i) => i.key));
  for (const a of [...applied].reverse()) {
    if (!wanted.has(a.key)) changes.push({ op: "remove", item: { key: a.key, content: "structure", type: "item", title: a.key, ...(a.undo ? { undo: a.undo } : {}) } });
  }
  return { changes, hashes };
}

const VERB = { add: "Add", change: "Change", remove: "Remove" } as const;

async function preview(ctx: Ctx, input: unknown): Promise<{ changes: { kind: string; title: string }[] }> {
  await ensureCatalog(ctx);
  const k = mustKit(ctx, reqStr(ctx, rec(ctx, input), "kitId"));
  const head = headOf(ctx, k.id, k.channel);
  if (!head) fail(ctx, "validation.precondition_failed", "This Kit has no published version yet.");
  const target = parseManifest(head);
  const { changes } = await diffTo(ctx, k.id, target);
  // a removed item is named by its title in the installed version when that is still stored
  const installed = k.installedVersion !== null ? versionRow(ctx, k.id, k.installedVersion) : undefined;
  const titles = new Map((installed ? parseManifest(installed).items : []).map((i) => [i.key, i] as const));
  return { changes: changes.map((c) => { const full = c.op === "remove" ? titles.get(c.item.key) ?? c.item : c.item; return { kind: full.type, title: `${VERB[c.op]} ${full.title}` }; }) };
}

async function runStep(ctx: Ctx, step: KitStep): Promise<void> {
  await ctx.call(step.cap as never, step.input);
}

/** Applies a diff. Adds and changes run in manifest order, removals after them in reverse order of installing. A failure undoes the items added in this run. */
async function applyChanges(ctx: Ctx, kitId: string, target: KitManifest, verb: string): Promise<void> {
  const { changes, hashes } = await diffTo(ctx, kitId, target);
  const done: Change[] = [];
  for (const c of changes) {
    try {
      if (c.op === "remove") {
        if (c.item.undo) await runStep(ctx, c.item.undo);
      } else if (c.item.apply) {
        await runStep(ctx, c.item.apply);
      }
      done.push(c);
    } catch (e) {
      for (const d of [...done].reverse()) {
        if (d.op !== "add" || !d.item.undo) continue;
        try { await runStep(ctx, d.item.undo); } catch (u) { ctx.log.warn("kits: undo after a failed install failed", { item: d.item.key, error: u instanceof Error ? u.message : String(u) }); }
      }
      // the ledger is written only after every step worked, so a failed run leaves it as it was: a retry re-applies what this run already did
      const msg = (e as { error?: { message?: unknown } } | null)?.error?.message ?? (e instanceof Error ? e.message : "The step failed.");
      const code = (e as { error?: { code?: unknown } } | null)?.error?.code;
      const why = (e as { error?: { details?: unknown } } | null)?.error?.details;
      ctx.log.warn(`kits: ${verb} failed`, { kitId, item: c.item.key, code: typeof code === "string" ? code : "" });
      fail(ctx, "validation.precondition_failed", `Could not ${verb} "${c.item.title}": ${String(msg).slice(0, 200)} Nothing was left half installed.`, { item: c.item.key, ...(why !== undefined ? { step: why } : {}) });
    }
  }
  const now = ctx.now();
  for (const c of changes) {
    if (c.op === "remove") { ctx.db.run("DELETE FROM kits_applied WHERE kit_id = ? AND item_key = ?", kitId, c.item.key); continue; }
    const undo = c.item.undo ? JSON.stringify(c.item.undo) : null;
    const hash = hashes.get(c.item.key) ?? "";
    if (c.op === "add") ctx.db.run("INSERT INTO kits_applied (kit_id, item_key, item_hash, undo, at) VALUES (?, ?, ?, ?, ?)", kitId, c.item.key, hash, undo, now);
    else ctx.db.run("UPDATE kits_applied SET item_hash = ?, undo = ?, at = ? WHERE kit_id = ? AND item_key = ?", hash, undo, now, kitId, c.item.key);
  }
}

async function install(ctx: Ctx, input: unknown): Promise<{ kit: KitOut }> {
  const o = rec(ctx, input);
  if (o.accepted !== true) fail(ctx, "validation.bad_input", "Confirm the install sheet first.", { field: "accepted" });
  await ensureCatalog(ctx);
  const k = mustKit(ctx, reqStr(ctx, o, "kitId"));
  if (k.installedVersion !== null) fail(ctx, "validation.precondition_failed", `${k.title} is already installed (${k.installedVersion}). Use update.`);
  const head = headOf(ctx, k.id, k.channel);
  if (!head) fail(ctx, "validation.precondition_failed", "This Kit has no published version yet.");
  const target = parseManifest(head);
  await applyChanges(ctx, k.id, target, "install");
  const now = ctx.now();
  ctx.db.run("UPDATE kits_kit SET installed_version = ?, previous_version = ?, installed_by = ?, installed_at = ?, updated_at = ? WHERE id = ?", target.version, null, ctx.principal.id, now, now, k.id);
  ctx.emit("kit.installed", `kit/${k.id}`, { kitId: k.id, version: target.version });
  return { kit: kitOut(ctx, mustKit(ctx, k.id)) };
}

async function update(ctx: Ctx, input: unknown): Promise<{ kit: KitOut }> {
  const o = rec(ctx, input);
  await ensureCatalog(ctx);
  const k = mustKit(ctx, reqStr(ctx, o, "kitId"));
  if (k.installedVersion === null) fail(ctx, "validation.precondition_failed", `${k.title} is not installed. Install it first.`);
  const wanted = optStr(ctx, o, "version");
  const row = wanted !== undefined ? versionRow(ctx, k.id, wanted) : headOf(ctx, k.id, k.channel);
  if (!row) fail(ctx, "validation.not_found", wanted !== undefined ? `Version ${wanted} of ${k.title} does not exist.` : "This Kit has no published version yet.");
  const target = parseManifest(row);
  if (compareSemver(target.version, k.installedVersion) <= 0) fail(ctx, "validation.precondition_failed", `${k.title} ${k.installedVersion} is already at or past ${target.version}. Use rollback to go back.`);
  const from = k.installedVersion;
  await applyChanges(ctx, k.id, target, "update");
  ctx.db.run("UPDATE kits_kit SET installed_version = ?, previous_version = ?, updated_at = ? WHERE id = ?", target.version, from, ctx.now(), k.id);
  ctx.emit("kit.updated", `kit/${k.id}`, { kitId: k.id, from, to: target.version });
  return { kit: kitOut(ctx, mustKit(ctx, k.id)) };
}

async function rollback(ctx: Ctx, input: unknown): Promise<{ kit: KitOut }> {
  const o = rec(ctx, input);
  const k = mustKit(ctx, reqStr(ctx, o, "kitId"));
  if (k.installedVersion === null) fail(ctx, "validation.precondition_failed", `${k.title} is not installed.`);
  const toVersion = optStr(ctx, o, "toVersion") ?? k.previousVersion;
  if (toVersion === null || toVersion === undefined) fail(ctx, "validation.precondition_failed", `${k.title} has no earlier version to go back to.`);
  if (toVersion === k.installedVersion) fail(ctx, "validation.precondition_failed", `${k.title} is already at ${toVersion}.`);
  const row = versionRow(ctx, k.id, toVersion);
  if (!row) fail(ctx, "validation.not_found", `Version ${toVersion} of ${k.title} is not stored.`);
  const from = k.installedVersion;
  await applyChanges(ctx, k.id, parseManifest(row), "roll back");
  ctx.db.run("UPDATE kits_kit SET installed_version = ?, previous_version = ?, updated_at = ? WHERE id = ?", toVersion, from, ctx.now(), k.id);
  ctx.emit("kit.rolled_back", `kit/${k.id}`, { kitId: k.id, to: toVersion });
  return { kit: kitOut(ctx, mustKit(ctx, k.id)) };
}

export const installHandlers = {
  "kits.list": (ctx: Ctx, input: unknown) => list(ctx, input),
  "kits.get": (ctx: Ctx, input: unknown) => get(ctx, input),
  "kits.install_sheet": (ctx: Ctx, input: unknown) => installSheet(ctx, input),
  "kits.preview": (ctx: Ctx, input: unknown) => preview(ctx, input),
  "kits.install": (ctx: Ctx, input: unknown) => install(ctx, input),
  "kits.update": (ctx: Ctx, input: unknown) => update(ctx, input),
  "kits.rollback": (ctx: Ctx, input: unknown) => rollback(ctx, input),
  "kits.choose": (ctx: Ctx, input: unknown) => choose(ctx, input),
  "kits.versions": (ctx: Ctx, input: unknown) => versions(ctx, input),
  "kits.restore_version": (ctx: Ctx, input: unknown) => restoreVersion(ctx, input),
  "kits.builder_open": (ctx: Ctx, input: unknown) => builderOpen(ctx, input),
};
