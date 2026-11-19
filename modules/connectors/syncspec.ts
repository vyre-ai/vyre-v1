// SyncSpec (spec 2.10): the one document an agent fills to bring an app's records into Records. Nothing here knows an app. The platform parses it, checks it against a real sampled
// page, and compiles it into connector actions (the engine's list/create/update/delete, shaped by ActionDef.shape), record types (fields, choices, relations, stages) and bindings.
// The document holds a Vault handle, never a value, and a write is compiled only where the spec cites the docs that show it.
import { pointerGet } from "./projections.ts";
import type { ActionDef, ConnectorDef } from "./projections.ts";

export const FIELD_TYPES = [
  "text",
  "number",
  "money",
  "date",
  "bool",
  "choice",
  "multi",
  "email",
  "phone",
  "url",
  "relation",
  "json",
  "sealed",
] as const;
export type SpecFieldType = (typeof FIELD_TYPES)[number];
/** Names that mark a secret identifier: map these as sealed. A date of birth is not one of them. */
export const SECRET_ID =
  /(?<![a-z])(ssn|ein|tin)(?![a-z])|social[ _-]?security|tax[ _-]?id|account[ _-]?(number|no|num)(?![a-z])|routing|licen[cs]e[ _-]?(number|no|num)(?![a-z])|driver'?s?[ _-]?licen[cs]e|passport|card[ _-]?(number|no|num)(?![a-z])/i;
export const SSN_SHAPE = /^\d{3}-\d{2}-\d{4}$/;
export const AUTH_STYLES = ["bearer", "header", "basic", "query", "oauth", "oauth_refresh"] as const;
/** Token addresses that are known to belong to the provider of an OAuth app, whatever the app's own host is called. */
export const KNOWN_TOKEN_DOMAINS: readonly string[] = [
  "googleapis.com",
  "google.com",
  "microsoftonline.com",
  "microsoft.com",
  "clio.com",
  "salesforce.com",
  "hubspot.com",
  "zoho.com",
  "intuit.com",
  "xero.com",
  "dropbox.com",
  "box.com",
];
const TWO_PART_SUFFIX = new Set(["co.uk", "org.uk", "com.au", "co.nz", "com.br", "co.in", "co.jp"]);
/** The registrable domain of a host: its last two labels (three under a two-part suffix such as co.uk). */
export function registrable(host: string): string {
  const labels = host.toLowerCase().replace(/\.$/, "").split(".");
  const two = labels.slice(-2).join(".");
  return TWO_PART_SUFFIX.has(two) ? labels.slice(-3).join(".") : two;
}
export const CURSOR_KINDS = ["none", "page", "cursor", "offset", "link"] as const;
export const DIRECTIONS = ["both", "pull", "push", "off"] as const;

export interface SpecField {
  path: string;
  label: string;
  type: SpecFieldType;
  choices?: { value: string; label?: string }[];
  relationTo?: string;
  /** The name of the far end of a relation (on the target's records). Without it the first relation from a type to a target is named after the type; a further one after the type and this field. */
  inverseKey?: string;
  inverseTitle?: string;
  readOnly?: boolean;
  /** Names this field when several fields of one object share a path (the mapping's `field` is the same name). */
  key?: string;
  /** The field takes its value only when the other pointer of the same item has this value (compared without case or spaces); otherwise it is empty for that record. */
  onlyWhen?: { path: string; equals: string | string[] };
}
export interface SpecCursor {
  kind: (typeof CURSOR_KINDS)[number];
  param?: string;
  next?: string;
  size?: number;
  sizeParam?: string;
  start?: number;
}
export interface SpecList {
  path: string;
  query?: Record<string, string>;
  cursor?: SpecCursor;
  updatedSince?: { param: string; format?: string };
  filter?: { param: string; value: string };
  /** How often this object is read whole when the app cannot answer "changed since", in minutes. Without it a check is every 15 minutes (60 when idle). */
  checkEveryMinutes?: number;
  /** How often the whole list is read to find what the app deleted, in days (1 to 30; default 1). A large table can be swept weekly. */
  sweepEveryDays?: number;
}
export interface SpecWrite {
  path: string;
  method?: string;
  evidence: string;
  bodyAt?: string;
  idAt?: string;
}
export interface SpecObject {
  remote: string;
  label: string;
  count?: number;
  list: SpecList;
  get?: { path: string };
  create?: SpecWrite;
  update?: SpecWrite;
  delete?: SpecWrite;
  id: string;
  updatedAt?: string;
  itemsAt: string;
  openUrl?: string;
  fields: SpecField[];
  webhook?: {
    events: string[];
    subscribePath?: string;
    /** The docs page that shows the subscribe call (required with subscribePath). */ evidence?: string;
    manualUrl?: boolean;
    signature?: string;
  };
}
export interface SpecMappingField {
  path: string;
  field?: string;
  direction: (typeof DIRECTIONS)[number];
}
export interface SpecMapping {
  remote: string;
  recordType: string;
  title?: string;
  fields: SpecMappingField[];
  match?: string[];
  stagesFrom?: string;
  /** One pointer, or a list of pointers joined with a space (first and last name): empty parts are left out. */
  titleField?: string | string[];
  deletes?: "off" | "soft" | "travel";
  createAtSource?: boolean;
  /** A join object (who is on which deal): each row also relates two already-synced records through a many-to-many relation that apply makes. `at` is a pointer in the row to the other record's id in the app. */
  link?: {
    from: { recordType: string; at: string };
    to: { recordType: string; at: string };
    key: string;
    title: string;
    inverseKey: string;
    inverseTitle: string;
  };
}
export interface SyncSpec {
  app: {
    name: string;
    domain: string;
    docsUrl?: string;
    logoHint?: string;
    /** Which account of the app this is (a location, a workspace). Accounts of one app share record types; each record says which it came from. */ account?: string;
  };
  auth: {
    vaultHandle: string;
    style: (typeof AUTH_STYLES)[number];
    /** oauth_refresh: where the refresh token is traded for an access token. The Vault item at vaultHandle holds client_id, client_secret and refresh_token. */
    tokenUrl?: string;
    header?: string;
    prefix?: string;
    headers?: Record<string, string>;
  };
  objects: SpecObject[];
  mapping: SpecMapping[];
  plan: {
    firstPull: { words: string };
    backfill: "later" | "now";
    conflicts: "newest";
    /** The most calls to the app in a minute, for the whole connection (every object together). Without it Vyre allows 300 a minute. Set it from the app's documented limit, and leave room for the firm's own tools. */
    requestsPerMinute?: number;
    /** Who the new record types are open to: the whole Space (default), only people added, or only the person applying. */ audience?:
      | "space"
      | "added"
      | "me";
  };
}

export interface Problem {
  level: "error" | "warn";
  at: string;
  message: string;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): v is string => typeof v === "string" && v !== "";
const KEY = /^[a-z][a-z0-9_]*$/;
const HANDLE = /^#[A-Za-z0-9_]+(\.[A-Za-z0-9_]+)?$/;
const HOST = /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/i;

/** A pointer into a JSON document: "" is the document, otherwise /a/b/0. */
const pointerOk = (v: unknown): v is string => typeof v === "string" && (v === "" || v.startsWith("/"));

// ---- parse ----

/** Read an untrusted document into a SyncSpec, or say what is wrong with its shape. Meaning (does the path exist on a real page) is the validator's job. */
export function parseSpec(raw: unknown): { spec?: SyncSpec; problems: Problem[] } {
  const problems: Problem[] = [];
  const bad = (at: string, message: string): void => {
    problems.push({ level: "error", at, message });
  };
  if (!isObj(raw)) return { problems: [{ level: "error", at: "spec", message: "The spec must be an object." }] };
  const app = raw["app"],
    auth = raw["auth"],
    plan = raw["plan"];
  if (!isObj(app) || !str(app["name"])) bad("app.name", "Name the app.");
  if (!isObj(app) || !str(app["domain"]) || !HOST.test(String(app["domain"])))
    bad("app.domain", "app.domain is the API host, such as api.example.com.");
  if (!isObj(auth) || !str(auth["vaultHandle"]) || !HANDLE.test(String(auth["vaultHandle"])))
    bad("auth.vaultHandle", "auth.vaultHandle is a Vault handle such as #Acme_API. Never a key value.");
  if (!isObj(auth) || !(AUTH_STYLES as readonly unknown[]).includes(auth["style"]))
    bad("auth.style", `auth.style is one of ${AUTH_STYLES.join(", ")}.`);
  if (isObj(auth) && auth["style"] === "query")
    bad("auth.style", "A key in the address is refused: use bearer or header.");
  if (isObj(auth) && auth["style"] === "oauth")
    bad("auth.style", "Sign in with OAuth in Console > Integrations first; the spec takes a key held in the Vault.");
  if (isObj(auth) && auth["style"] === "oauth_refresh") {
    const token = typeof auth["tokenUrl"] === "string" ? auth["tokenUrl"] : "";
    let ok = false;
    try {
      ok = token !== "" && new URL(token).protocol === "https:";
    } catch {
      ok = false;
    }
    if (!ok)
      bad(
        "auth.tokenUrl",
        "auth.tokenUrl is the https address that renews the sign-in, such as https://app.example.com/oauth/token.",
      );
    if (ok) {
      // a refresh token and a client secret are sent to this address: it is the app's own, or its provider's, or an admin has to say so
      const host = new URL(token).hostname;
      const appHost = isObj(app) && typeof app["domain"] === "string" ? app["domain"] : "";
      const own = appHost !== "" && registrable(host) === registrable(appHost);
      if (!own && !KNOWN_TOKEN_DOMAINS.includes(registrable(host)))
        bad(
          "auth.tokenUrl",
          `${host} is not on the same domain as ${appHost || "the app"} or a provider Vyre knows. The client secret and refresh token would be sent there, so an admin has to approve this address first.`,
        );
    }
    if (String(auth["vaultHandle"] ?? "").includes("."))
      bad(
        "auth.vaultHandle",
        "For oauth_refresh the handle names the whole Vault item (#Clio_App), which holds client_id, client_secret and refresh_token.",
      );
  }
  const objects = raw["objects"],
    mapping = raw["mapping"];
  if (!Array.isArray(objects) || !objects.length) bad("objects", "List at least one object.");
  if (!Array.isArray(mapping) || !mapping.length) bad("mapping", "Map at least one object to a record type.");
  if (!isObj(plan) || !isObj(plan["firstPull"]) || !str(plan["firstPull"]["words"]))
    bad("plan.firstPull.words", "Say in plain words what the first pull brings in.");
  if (isObj(plan) && plan["backfill"] !== "later" && plan["backfill"] !== "now")
    bad("plan.backfill", "plan.backfill is later or now.");
  if (
    isObj(plan) &&
    plan["audience"] !== undefined &&
    plan["audience"] !== "space" &&
    plan["audience"] !== "added" &&
    plan["audience"] !== "me"
  )
    bad("plan.audience", "plan.audience is space, added or me.");
  if (isObj(plan) && plan["conflicts"] !== "newest") bad("plan.conflicts", "plan.conflicts is newest.");
  if (
    isObj(plan) &&
    plan["requestsPerMinute"] !== undefined &&
    !(
      typeof plan["requestsPerMinute"] === "number" &&
      plan["requestsPerMinute"] >= 1 &&
      plan["requestsPerMinute"] <= 6000
    )
  )
    bad("plan.requestsPerMinute", "plan.requestsPerMinute is the most calls a minute, from 1 to 6000.");
  if (problems.length) return { problems };

  for (const [i, o] of (objects as unknown[]).entries()) {
    const at = `objects[${i}]`;
    if (!isObj(o)) {
      bad(at, "An object entry must be an object.");
      continue;
    }
    if (!str(o["remote"])) bad(`${at}.remote`, "Name the object as the app does.");
    if (!str(o["label"])) bad(`${at}.label`, "Give the object a label.");
    if (!pointerOk(o["id"]) || o["id"] === "") bad(`${at}.id`, "id is a pointer inside one item, such as /id.");
    if (!pointerOk(o["itemsAt"]))
      bad(`${at}.itemsAt`, "itemsAt is a pointer to the list of items in an answer (/ for the answer itself).");
    const list = o["list"];
    if (!isObj(list) || !str(list["path"]) || !String(list["path"]).startsWith("/"))
      bad(`${at}.list.path`, "list.path is the address path, starting with /.");
    if (
      isObj(list) &&
      list["checkEveryMinutes"] !== undefined &&
      !(
        typeof list["checkEveryMinutes"] === "number" &&
        Number.isInteger(list["checkEveryMinutes"]) &&
        list["checkEveryMinutes"] >= 1 &&
        list["checkEveryMinutes"] <= 10_080
      )
    )
      bad(`${at}.list.checkEveryMinutes`, "checkEveryMinutes is a whole number of minutes, from 1 to 10080.");
    if (
      isObj(list) &&
      list["sweepEveryDays"] !== undefined &&
      !(
        typeof list["sweepEveryDays"] === "number" &&
        Number.isInteger(list["sweepEveryDays"]) &&
        list["sweepEveryDays"] >= 1 &&
        list["sweepEveryDays"] <= 30
      )
    )
      bad(`${at}.list.sweepEveryDays`, "sweepEveryDays is a whole number of days, from 1 to 30.");
    if (isObj(list) && isObj(list["updatedSince"])) {
      const u = list["updatedSince"];
      if (!str(u["param"]))
        bad(
          `${at}.list.updatedSince.param`,
          "Name the query parameter that takes a time, so a poll reads only what changed.",
        );
      if (u["format"] !== undefined && u["format"] !== "iso" && u["format"] !== "epoch_ms" && u["format"] !== "epoch_s")
        bad(`${at}.list.updatedSince.format`, "updatedSince.format is iso, epoch_ms or epoch_s.");
    }
    if (isObj(list) && isObj(list["cursor"])) {
      const c = list["cursor"];
      if (!(CURSOR_KINDS as readonly unknown[]).includes(c["kind"]))
        bad(`${at}.list.cursor.kind`, `cursor.kind is one of ${CURSOR_KINDS.join(", ")}.`);
      else if ((c["kind"] === "page" || c["kind"] === "cursor" || c["kind"] === "offset") && !str(c["param"]))
        bad(`${at}.list.cursor.param`, "Name the query parameter that carries the page, cursor or offset.");
      if (c["kind"] === "cursor" && !pointerOk(c["next"]))
        bad(`${at}.list.cursor.next`, "A cursor needs next: the pointer to the next cursor in the answer.");
    }
    for (const [fi, fd] of (Array.isArray(o["fields"]) ? (o["fields"] as unknown[]) : []).entries()) {
      const ow = isObj(fd) ? fd["onlyWhen"] : undefined;
      if (ow === undefined) continue;
      const eq = isObj(ow) ? ow["equals"] : undefined;
      if (
        !isObj(ow) ||
        !pointerOk(ow["path"]) ||
        !(typeof eq === "string" || (Array.isArray(eq) && eq.length > 0 && eq.every((x) => typeof x === "string")))
      )
        bad(`${at}.fields[${fi}].onlyWhen`, "onlyWhen is { path: a pointer, equals: a value or a list of values }.");
    }
    const wh = o["webhook"];
    if (wh !== undefined) {
      if (!isObj(wh) || !Array.isArray(wh["events"]))
        bad(`${at}.webhook`, "webhook needs events: a list of event names.");
      else if (wh["subscribePath"] !== undefined && (!str(wh["subscribePath"]) || !str(wh["evidence"])))
        bad(
          `${at}.webhook.evidence`,
          "A subscribe call is refused without evidence: cite the docs page that shows it.",
        );
    }
    for (const w of ["create", "update", "delete"] as const) {
      const wr = o[w];
      if (wr === undefined) continue;
      if (!isObj(wr) || !str(wr["path"]) || !String(wr["path"]).startsWith("/"))
        bad(`${at}.${w}.path`, `${w}.path is the address path, starting with /.`);
      else if (!str(wr["evidence"]))
        bad(`${at}.${w}.evidence`, `${w} is refused without evidence: cite the docs page or quote that shows it.`);
      else if ((w === "update" || w === "delete") && !String(wr["path"]).includes("{id}"))
        bad(`${at}.${w}.path`, `${w}.path must contain {id}.`);
    }
    if (!Array.isArray(o["fields"])) bad(`${at}.fields`, "fields is a list.");
    else
      for (const [j, f] of (o["fields"] as unknown[]).entries()) {
        const fa = `${at}.fields[${j}]`;
        if (!isObj(f) || !pointerOk(f["path"]) || f["path"] === "")
          bad(`${fa}.path`, "A field path is a pointer inside one item, such as /email.");
        else {
          if (!str(f["label"])) bad(`${fa}.label`, "Give the field a label.");
          if (!(FIELD_TYPES as readonly unknown[]).includes(f["type"]))
            bad(`${fa}.type`, `type is one of ${FIELD_TYPES.join(", ")}.`);
          if (f["type"] === "relation" && !str(f["relationTo"]))
            bad(`${fa}.relationTo`, "A relation names the object it points to.");
          if (f["inverseKey"] !== undefined && (!str(f["inverseKey"]) || !KEY.test(String(f["inverseKey"]))))
            bad(`${fa}.inverseKey`, "inverseKey is lowercase letters, digits and underscores, starting with a letter.");
          if (f["inverseTitle"] !== undefined && !str(f["inverseTitle"]))
            bad(`${fa}.inverseTitle`, "inverseTitle is the name people read on the other record.");
        }
      }
  }
  for (const [i, m] of (mapping as unknown[]).entries()) {
    const at = `mapping[${i}]`;
    if (!isObj(m)) {
      bad(at, "A mapping entry must be an object.");
      continue;
    }
    if (!str(m["remote"])) bad(`${at}.remote`, "Name the object this maps.");
    if (!str(m["recordType"]) || !KEY.test(String(m["recordType"])))
      bad(`${at}.recordType`, "recordType is lowercase letters, digits and underscores, starting with a letter.");
    if (m["link"] !== undefined) {
      const l = m["link"];
      const end = (e: unknown): boolean =>
        isObj(e) && str(e["recordType"]) && KEY.test(String(e["recordType"])) && pointerOk(e["at"]) && e["at"] !== "";
      if (
        !isObj(l) ||
        !end(l["from"]) ||
        !end(l["to"]) ||
        !str(l["key"]) ||
        !KEY.test(String(l["key"])) ||
        !str(l["inverseKey"]) ||
        !KEY.test(String(l["inverseKey"])) ||
        !str(l["title"]) ||
        !str(l["inverseTitle"])
      )
        bad(
          `${at}.link`,
          "A link names both ends (from and to, each with a recordType and the pointer to its id in the row), the field key and title on the from records (key, title), and on the to records (inverseKey, inverseTitle).",
        );
    }
    if (!Array.isArray(m["fields"])) bad(`${at}.fields`, "fields is a list.");
    else
      for (const [j, f] of (m["fields"] as unknown[]).entries()) {
        if (!isObj(f) || !pointerOk(f["path"]) || !(DIRECTIONS as readonly unknown[]).includes(f["direction"]))
          bad(`${at}.fields[${j}]`, "Each mapped field has a path and a direction (both, pull, push, off).");
        else if (f["field"] !== undefined && (!str(f["field"]) || !KEY.test(String(f["field"]))))
          bad(`${at}.fields[${j}].field`, "A record field key is lowercase letters, digits and underscores.");
      }
  }
  if (problems.length) return { problems };
  return { spec: raw as unknown as SyncSpec, problems };
}

// ---- values ----

const ISO = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})?)?$/;

/** One remote value as the record field takes it. `ok: false` means it does not fit and the field is left empty (the validator warns about it). */
export function coerceValue(
  v: unknown,
  type: SpecFieldType | "list",
  choices?: readonly string[],
): { ok: true; value: unknown } | { ok: false } {
  if (v === null || v === undefined || v === "") return { ok: true, value: null };
  const text = (): { ok: true; value: unknown } | { ok: false } =>
    typeof v === "string"
      ? { ok: true, value: v }
      : typeof v === "number" || typeof v === "boolean"
        ? { ok: true, value: String(v) }
        : { ok: false };
  switch (type) {
    case "text":
    case "email":
    case "phone":
    case "sealed":
      return text();
    case "relation":
      return text();
    case "json":
      return { ok: true, value: typeof v === "string" ? v : JSON.stringify(v) };
    case "number":
    case "money": {
      if (typeof v === "number" && Number.isFinite(v)) return { ok: true, value: v };
      if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return { ok: true, value: Number(v) };
      return { ok: false };
    }
    case "bool": {
      if (typeof v === "boolean") return { ok: true, value: v };
      if (v === 1 || v === "1" || v === "true" || v === "yes") return { ok: true, value: true };
      if (v === 0 || v === "0" || v === "false" || v === "no") return { ok: true, value: false };
      return { ok: false };
    }
    case "date": {
      if (typeof v === "string") {
        if (ISO.test(v)) return { ok: true, value: v };
        const at = Date.parse(v);
        return Number.isFinite(at) ? { ok: true, value: new Date(at).toISOString() } : { ok: false };
      }
      if (typeof v === "number" && Number.isFinite(v))
        return { ok: true, value: new Date(v > 1e11 ? v : v * 1000).toISOString() };
      return { ok: false };
    }
    case "url":
      return typeof v === "string" && /^https?:\/\//.test(v) ? { ok: true, value: v } : { ok: false };
    case "choice": {
      const s = typeof v === "string" ? v : typeof v === "number" ? String(v) : undefined;
      return s !== undefined && (!choices || choices.includes(s)) ? { ok: true, value: s } : { ok: false };
    }
    // a list with no declared choices is a text field here: its values are joined (the compiler asks for this type, a spec never does)
    case "list":
      return Array.isArray(v)
        ? { ok: true, value: v.filter((x) => typeof x === "string" || typeof x === "number").join(", ") }
        : typeof v === "string"
          ? { ok: true, value: v }
          : { ok: false };
    case "multi": {
      const list = Array.isArray(v) ? v : typeof v === "string" ? [v] : undefined;
      if (!list || !list.every((x) => typeof x === "string" || typeof x === "number")) return { ok: false };
      const out = list.map(String);
      return !choices || out.every((x) => choices.includes(x)) ? { ok: true, value: out } : { ok: false };
    }
  }
}

/** Nest flat values keyed by pointer: { "/a/b": 1 } becomes { a: { b: 1 } }. */
export function unflatten(flat: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [pointer, value] of Object.entries(flat)) {
    if (!pointer.startsWith("/")) {
      out[pointer] = value;
      continue;
    }
    const keys = pointer
      .slice(1)
      .split("/")
      .map((k) => k.replaceAll("~1", "/").replaceAll("~0", "~"));
    let cur = out;
    for (const [i, k] of keys.entries()) {
      if (i === keys.length - 1) cur[k] = value;
      else cur = (isObj(cur[k]) ? cur[k] : (cur[k] = {})) as Record<string, unknown>;
    }
  }
  return out;
}

// ---- names ----

const slug = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
export function fieldKeyOf(s: string): string {
  const k = s
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return /^[a-z]/.test(k) ? k.slice(0, 60) : `f_${k}`.slice(0, 60);
}
export const connectorKeyOf = (spec: SyncSpec): string =>
  `crm_${slug(spec.app.name) || "app"}${spec.app.account ? `_${slug(spec.app.account)}` : ""}`.slice(0, 40);
const actionName = (kind: string, remote: string): string => `${kind}_${slug(remote)}`;

/** The object's field a mapping entry points at: by path, and by key when several fields share the path. */
export function fieldOf(o: SpecObject | undefined, mf: { path: string; field?: string }): SpecField | undefined {
  const same = o?.fields.filter((x) => x.path === mf.path) ?? [];
  return same.length > 1 ? (same.find((x) => x.key !== undefined && x.key === mf.field) ?? same[0]) : same[0];
}
export const WHEN_PREFIX = "=when:";
/** The remote key of a conditional field: the value at `p`, only when `w` holds one of `e`. */
export const whenRemote = (p: string, w: { path: string; equals: string | string[] }): string =>
  `${WHEN_PREFIX}${JSON.stringify({ p, w: w.path, e: Array.isArray(w.equals) ? w.equals : [w.equals] })}`;
/** The value of a pulled row's remote key, which may be a conditional one. */
export function valueOfRemote(data: Record<string, unknown>, remote: string): unknown {
  if (!remote.startsWith(WHEN_PREFIX)) return data[remote];
  const c = JSON.parse(remote.slice(WHEN_PREFIX.length)) as { p: string; w: string; e: string[] };
  const have = data[c.w];
  const norm = (x: unknown): string => String(x).trim().toLowerCase();
  return have !== undefined && have !== null && c.e.some((v) => norm(v) === norm(have)) ? (data[c.p] ?? null) : null;
}

/** The record field key for each mapped path of one mapping: the explicit one, else from the label, made unique. */
export function fieldKeys(obj: SpecObject, m: SpecMapping): Map<string, string> {
  const out = new Map<string, string>();
  for (const [i, k] of fieldKeyList(obj, m).entries()) if (!out.has(m.fields[i]!.path)) out.set(m.fields[i]!.path, k);
  return out;
}
/** One key per mapping entry, in order (entries sharing a path each have their own). */
export function fieldKeyList(obj: SpecObject, m: SpecMapping): string[] {
  const out: string[] = [];
  const used = new Set<string>();
  for (const f of m.fields) {
    const spec = fieldOf(obj, f);
    let key = f.field ?? fieldKeyOf(spec?.label ?? f.path.split("/").pop() ?? "field");
    const base = key;
    for (let n = 2; used.has(key); n++) key = `${base}_${n}`.slice(0, 63);
    used.add(key);
    out.push(key);
  }
  return out;
}

// ---- compile ----

/** The remote key of a title made from several pointers. */
export const JOIN_PREFIX = "=join:";
/** The pointers a mapping's titleField names (one or several). */
export const titlePaths = (m: Pick<SpecMapping, "titleField">): string[] =>
  m.titleField === undefined ? [] : Array.isArray(m.titleField) ? m.titleField : [m.titleField];
/** The parts of a title (keys of a pulled row, which are the spec's pointers), joined with one space, empty parts left out; null when every part is empty. */
export function joinTitle(data: unknown, parts: readonly string[]): string | null {
  const out: string[] = [];
  for (const p of parts) {
    const v = isObj(data) ? data[p] : undefined;
    const t = typeof v === "string" ? v.trim() : typeof v === "number" || typeof v === "boolean" ? String(v) : "";
    if (t !== "") out.push(t);
  }
  return out.length ? out.join(" ") : null;
}

export interface FieldMapOut {
  key: string;
  remote: string;
  dir: "pull" | "push" | "both" | "off";
  relation?: string;
  inverse?: string;
  constant?: string;
  /** Kept out of the sync's own tables: the value is sealed in the Vault the moment it is read, and never travels with the record's other values. */
  sealed?: true;
}
export interface CompiledType {
  remote: string;
  recordType: string;
  title: string;
  fields: FieldMapOut[];
  match: string[];
  createAtSource: boolean;
  deletes: "off" | "soft" | "travel";
  /** Field definitions for schema.apply; relations are made separately (relation.add) once both types exist. */
  defs: { key: string; type: string; title: string; options?: Record<string, unknown> }[];
  relations: { field: string; title: string; to: string; inverse: string; inverseTitle: string; on?: string }[];
  /** A join object that also relates two records of other types (the relation is on `from`, listed in `relations` with `on`). */
  link?: { from: { type: string; at: string }; to: { type: string; at: string }; key: string; inverseKey: string };
  titleField: string;
  statusField?: string;
}
export interface Compiled {
  connector: ConnectorDef;
  types: CompiledType[];
  secretSlot: string;
}

const LOCAL_TYPE: Record<SpecFieldType, string> = {
  text: "text",
  number: "number",
  money: "number",
  date: "datetime",
  bool: "checkbox",
  choice: "choice",
  multi: "multichoice",
  email: "email",
  phone: "phone",
  url: "url",
  relation: "relation",
  json: "longtext",
  sealed: "sealed",
};

const titleOf = (key: string): string => key.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());

/** A push of a field the spec marks read-only, or a relation, never leaves: direction is capped here so the binding cannot be asked to write it. */
export function directionOf(
  f: SpecMappingField,
  spec: SpecField | undefined,
  writable: boolean,
): "pull" | "push" | "both" | "off" {
  if (f.direction === "off") return "off";
  if (spec?.type === "relation" || spec?.readOnly === true || !writable) return f.direction === "push" ? "off" : "pull";
  return f.direction;
}

/** The far end of every relation of a spec, by "<recordType>|<position of the field in the mapping>". The first relation from a type to a target keeps the old name (the type and an s), a further one is named after its field so it cannot collide; a name the spec gives wins. */
export function relationEnds(spec: SyncSpec): Map<string, { key: string; title: string; to: string; field: string }> {
  const out = new Map<string, { key: string; title: string; to: string; field: string }>();
  const byRemote = new Map(spec.objects.map((o) => [o.remote, o]));
  const seen = new Map<string, number>();
  for (const m of spec.mapping) {
    const o = byRemote.get(m.remote);
    if (!o) continue;
    const keyList = fieldKeyList(o, m);
    for (const [mi, f] of m.fields.entries()) {
      if (f.direction === "off") continue;
      const sf = fieldOf(o, f);
      const target = sf?.type === "relation" ? spec.mapping.find((x) => x.remote === sf.relationTo) : undefined;
      if (!sf || !target) continue;
      const pair = `${m.recordType}>${target.recordType}`;
      const n = seen.get(pair) ?? 0;
      seen.set(pair, n + 1);
      const field = keyList[mi]!;
      out.set(`${m.recordType}|${field}`, {
        key: (sf.inverseKey ?? (n === 0 ? `${m.recordType}s` : `${m.recordType}_${field}s`)).slice(0, 60),
        title: sf.inverseTitle ?? (n === 0 ? `${o.label}s` : `${o.label}s (${sf.label.toLowerCase()})`),
        to: target.recordType,
        field,
      });
    }
  }
  return out;
}

/** Two relations that would put the same name on one record type, said in plain words (empty when none). */
export function relationClashes(spec: SyncSpec): string[] {
  const names = new Map<string, string>();
  const said: string[] = [];
  for (const [at, e] of relationEnds(spec)) {
    const near = at.split("|")[0]!;
    const k = `${e.to}|${e.key}`;
    const was = names.get(k);
    if (was !== undefined)
      said.push(`${was} and ${near}.${e.field} both put ${e.key} on ${e.to}. Give one of them its own inverseKey.`);
    else names.set(k, `${near}.${e.field}`);
  }
  return said;
}

export function compileSpec(spec: SyncSpec): Compiled {
  const secretSlot = "Key";
  const types: CompiledType[] = [];
  const actions: ActionDef[] = [];
  const objects: NonNullable<ConnectorDef["objects"]> = {};
  const baseHeaders: Record<string, string> = { Accept: "application/json", ...(spec.auth.headers ?? {}) };
  const byRemote = new Map(spec.objects.map((o) => [o.remote, o]));
  const ends = relationEnds(spec);

  for (const m of spec.mapping) {
    const o = byRemote.get(m.remote);
    if (!o) continue;
    const keys = fieldKeys(o, m);
    const keyList = fieldKeyList(o, m);
    const cursor = o.list.cursor ?? { kind: "none" as const };
    const filter = spec.plan.backfill === "now" ? undefined : o.list.filter;
    const query: Record<string, string> = {
      ...(o.list.query ?? {}),
      ...(filter ? { [filter.param]: filter.value } : {}),
    };
    if (cursor.size && cursor.sizeParam) query[cursor.sizeParam] = String(cursor.size);
    if (cursor.kind === "page" && cursor.param) query[cursor.param] = String(cursor.start ?? 1);
    if (cursor.kind === "offset" && cursor.param) query[cursor.param] = String(cursor.start ?? 0);

    const mapped = m.fields.filter((f) => f.direction !== "off");
    const titleParts = Array.isArray(m.titleField) ? m.titleField : [];
    const whenPaths = mapped.flatMap((f) => {
      const w = fieldOf(o, f)?.onlyWhen;
      return w ? [w.path] : [];
    });
    const shapeFields = [
      ...new Set([
        ...mapped.map((f) => f.path),
        ...titleParts,
        ...whenPaths,
        ...(m.link ? [m.link.from.at, m.link.to.at] : []),
      ]),
    ];
    const types_: Record<string, string> = {};
    const choices: Record<string, string[]> = {};
    for (const p of shapeFields) {
      const sf = o.fields.find((x) => x.path === p);
      if (!sf) {
        if (titleParts.includes(p) || whenPaths.includes(p)) types_[p] = "text";
        continue;
      }
      // a pick-list or a multi-pick with no choices listed becomes plain text locally; the sync reads it the same way
      // a sealed value is read as text and sealed by the engine the moment it leaves the answer
      types_[p] = sf.type === "multi" && !sf.choices?.length ? "list" : sf.type === "sealed" ? "text" : sf.type;
      if (sf.choices?.length) choices[p] = sf.choices.map((c) => c.value);
    }
    const listShape = {
      items: o.itemsAt,
      id: o.id,
      ...(o.updatedAt ? { updatedAt: o.updatedAt } : {}),
      fields: shapeFields,
      types: types_,
      choices,
      cursor: {
        kind: cursor.kind,
        ...(cursor.param ? { param: cursor.param } : {}),
        ...(cursor.next ? { next: cursor.next } : {}),
        ...(cursor.size ? { size: cursor.size } : {}),
        ...(cursor.start !== undefined ? { start: cursor.start } : {}),
      },
    };
    const sinceShape = o.list.updatedSince
      ? {
          since: {
            param: o.list.updatedSince.param,
            ...(o.list.updatedSince.format ? { format: o.list.updatedSince.format } : {}),
          },
        }
      : {};
    Object.assign(listShape, sinceShape);
    const names = {
      list: actionName("list", o.remote),
      listAfter: `${actionName("list", o.remote)}_after`,
      create: actionName("create", o.remote),
      update: actionName("update", o.remote),
      delete: actionName("delete", o.remote),
    };
    const headers = { ...baseHeaders };
    actions.push({
      name: names.list,
      method: "GET",
      url: `https://${spec.app.domain}${o.list.path}`,
      headers,
      query,
      shape: listShape,
    });
    actions.push({
      name: names.listAfter,
      method: "GET",
      url: `https://${spec.app.domain}${o.list.path}`,
      headers,
      query,
      shape: listShape,
    });
    const nest = (w: SpecWrite): unknown => {
      const at = w.bodyAt ?? "";
      if (at === "") return "{input.properties}";
      let body: unknown = "{input.properties}";
      for (const k of at.slice(1).split("/").reverse()) body = { [k]: body };
      return body;
    };
    const writable = { create: o.create !== undefined, update: o.update !== undefined };
    const entry: NonNullable<ConnectorDef["objects"]>[string] = {
      list: names.list,
      listAfter: names.listAfter,
      ...(o.list.updatedSince ? { since: true } : {}),
    };
    if (o.create && (m.createAtSource ?? false)) {
      actions.push({
        name: names.create,
        method: (o.create.method ?? "POST") as ActionDef["method"],
        url: `https://${spec.app.domain}${o.create.path}`,
        headers,
        body: nest(o.create),
        write: true,
        shape: { unflatten: true, ...(o.create.idAt ? { idAt: o.create.idAt } : {}) },
      });
      entry.create = names.create;
    }
    if (o.update) {
      actions.push({
        name: names.update,
        method: (o.update.method ?? "PATCH") as ActionDef["method"],
        url: `https://${spec.app.domain}${o.update.path.replaceAll("{id}", "{input.id}")}`,
        headers,
        body: nest(o.update),
        write: true,
        shape: { unflatten: true },
      });
      entry.update = names.update;
    }
    if (o.delete && (m.deletes ?? "off") !== "off") {
      actions.push({
        name: names.delete,
        method: (o.delete.method ?? "DELETE") as ActionDef["method"],
        url: `https://${spec.app.domain}${o.delete.path.replaceAll("{id}", "{input.id}")}`,
        headers,
        write: true,
      });
      entry.delete = names.delete;
    }
    if (o.webhook?.subscribePath) {
      actions.push({
        name: actionName("subscribe", o.remote),
        method: "POST",
        url: `https://${spec.app.domain}${o.webhook.subscribePath}`,
        headers,
        body: { url: "{input.url}", events: o.webhook.events },
        write: true,
      });
    }
    if (m.link)
      entry.link = {
        from: { type: m.link.from.recordType, at: m.link.from.at },
        to: { type: m.link.to.recordType, at: m.link.to.at },
        key: m.link.key,
        inverseKey: m.link.inverseKey,
      };
    objects[o.remote] = entry;

    // record type: fields, choices, stages
    const defs: CompiledType["defs"] = [];
    const relations: CompiledType["relations"] = [];
    const fields: FieldMapOut[] = [];
    let statusField: string | undefined;
    for (const [mi, f] of m.fields.entries()) {
      if (f.direction === "off") continue;
      const sf = fieldOf(o, f);
      const key = keyList[mi]!;
      // a field that takes its value only when another pointer says so is read, never written back
      const when = sf?.onlyWhen;
      const remoteKey = when ? whenRemote(f.path, when) : f.path;
      const dir = when ? "pull" : directionOf(f, sf, writable.update);
      if (sf?.type === "sealed") {
        fields.push({ key, remote: remoteKey, dir: "pull", sealed: true });
        defs.push({ key, type: "sealed", title: sf.label });
        continue;
      }
      const target = sf?.type === "relation" ? spec.mapping.find((x) => x.remote === sf.relationTo) : undefined;
      const end = target ? ends.get(`${m.recordType}|${key}`) : undefined;
      const inverse = end?.key;
      fields.push({
        key,
        remote: remoteKey,
        dir,
        ...(sf?.type === "relation" ? { relation: sf.relationTo! } : {}),
        ...(inverse ? { inverse } : {}),
      });
      if (!sf) {
        defs.push({ key, type: "text", title: titleOf(key) });
        continue;
      }
      if (sf.type === "relation") {
        if (target)
          relations.push({
            field: key,
            title: sf.label,
            to: target.recordType,
            inverse: inverse!,
            inverseTitle: end!.title,
          });
        continue;
      }
      const options = sf.choices?.length
        ? sf.choices.map((c) => ({ key: c.value, title: c.label ?? c.value }))
        : undefined;
      if (f.path === m.stagesFrom && options) {
        defs.push({ key, type: "status", title: sf.label, options: { stages: options } });
        statusField = key;
        continue;
      }
      const type = (sf.type === "choice" || sf.type === "multi") && !options ? "text" : LOCAL_TYPE[sf.type];
      defs.push({ key, type, title: sf.label, ...(options ? { options: { choices: options } } : {}) });
    }
    if (m.link)
      relations.push({
        field: m.link.key,
        title: m.link.title,
        to: m.link.to.recordType,
        inverse: m.link.inverseKey,
        inverseTitle: m.link.inverseTitle,
        on: m.link.from.recordType,
      });
    // relation fields are mapped with their pointer; the target record type's synced binding resolves the remote id to a record
    const textKeys = defs.filter((d) => d.type === "text" || d.type === "email").map((d) => d.key);
    // a title made from several pointers is its own text field, read apart from the others: first and last name joined with a space
    let joinedKey: string | undefined;
    if (Array.isArray(m.titleField)) {
      const taken = new Set(defs.map((d) => d.key));
      joinedKey = ["name", "title", "full_title"].find((k) => !taken.has(k)) ?? "full_title_2";
      fields.push({ key: joinedKey, remote: `${JOIN_PREFIX}${m.titleField.join("|")}`, dir: "pull" });
      defs.unshift({ key: joinedKey, type: "text", title: "Name" });
    }
    const wanted =
      joinedKey ?? (m.titleField ? (keys.get(m.titleField as string) ?? (m.titleField as string)) : undefined);
    const titleField =
      wanted && defs.some((d) => d.key === wanted && d.type !== "sealed")
        ? wanted
        : (textKeys.find((k) => /name|title/.test(k)) ?? textKeys[0] ?? defs[0]?.key ?? "name");
    if (!defs.some((d) => d.key === titleField))
      defs.unshift({ key: titleField, type: "text", title: titleOf(titleField) });
    // an account stamps its name on every record it pulls, so accounts of one app can share a type and be told apart
    if (spec.app.account) {
      fields.push({ key: "from", remote: "=from", dir: "pull", constant: spec.app.account });
      defs.push({ key: "from", type: "text", title: "From" });
    }
    types.push({
      remote: o.remote,
      recordType: m.recordType,
      title: m.title ?? o.label,
      fields,
      defs,
      relations,
      ...(m.link
        ? {
            link: {
              from: { type: m.link.from.recordType, at: m.link.from.at },
              to: { type: m.link.to.recordType, at: m.link.to.at },
              key: m.link.key,
              inverseKey: m.link.inverseKey,
            },
          }
        : {}),
      match: (m.match ?? []).map((p) => keys.get(p) ?? p).filter((k) => fields.some((f) => f.key === k)),
      createAtSource: (m.createAtSource ?? false) && o.create !== undefined,
      deletes: o.delete ? (m.deletes ?? "off") : "off",
      titleField,
      ...(statusField ? { statusField } : {}),
    });
  }

  const refreshing = spec.auth.style === "oauth_refresh";
  const refreshSlots = { id: "Client_id", secret: "Client_secret", refresh: "Refresh_token" };
  const auth: ConnectorDef["auth"] = refreshing
    ? {
        type: "oauth_refresh",
        tokenUrl: spec.auth.tokenUrl ?? "",
        clientIdSecret: refreshSlots.id,
        clientSecret: refreshSlots.secret,
        refreshSecret: refreshSlots.refresh,
      }
    : spec.auth.style === "bearer"
      ? { type: "bearer", secret: secretSlot }
      : {
          type: "api_key",
          secret: secretSlot,
          header: spec.auth.header ?? "Authorization",
          prefix: spec.auth.style === "basic" ? "Basic " : (spec.auth.prefix ?? ""),
        };
  const connector: ConnectorDef = {
    key: connectorKeyOf(spec),
    title: spec.app.name,
    mode: "api",
    scope: "space",
    version: "0.0.0",
    auth,
    domains: [
      ...new Set([
        spec.app.domain,
        ...(refreshing && spec.auth.tokenUrl ? [new URL(spec.auth.tokenUrl).hostname] : []),
      ]),
    ],
    secrets: refreshing
      ? [
          { name: refreshSlots.id, description: `Client id of the ${spec.app.name} app` },
          { name: refreshSlots.secret, description: `Client secret of the ${spec.app.name} app` },
          { name: refreshSlots.refresh, description: `Refresh token for ${spec.app.name}` },
        ]
      : [{ name: secretSlot, description: `Key for ${spec.app.name}` }],
    actions,
    objects,
    syncedTypes: spec.mapping.map((m) => m.remote),
    rate: rateOf(spec),
    ...(sealedPaths(spec).length ? { sealed: sealedPaths(spec) } : {}),
    // a first page of the first list: what "test the connection" reads, so a replaced key brings a connection back
    ...(actions[0] ? { health: actions[0].name } : {}),
  };
  return { connector, types, secretSlot };
}

/** The pointers of every sealed field of a spec's mapped objects. */
export function sealedPaths(spec: SyncSpec): string[] {
  const out = new Set<string>();
  for (const m of spec.mapping) {
    const o = spec.objects.find((x) => x.remote === m.remote);
    for (const f of m.fields) if (f.direction !== "off" && fieldOf(o, f)?.type === "sealed") out.add(f.path);
  }
  return [...out];
}

/** The connection's budget: what the spec says in calls a minute (one call at a time, spaced evenly, so no minute holds more than that), else the old default. */
export function rateOf(spec: SyncSpec): { rps: number; burst: number } {
  const rpm = spec.plan.requestsPerMinute;
  return rpm === undefined ? { rps: 5, burst: 10 } : { rps: rpm / 60, burst: 1 };
}

/** The request a list action makes for a sampled page, as the validator and the compiled action build it. */
export function firstPageRequest(spec: SyncSpec, o: SpecObject): { path: string; query: Record<string, string> } {
  const c = o.list.cursor ?? { kind: "none" as const };
  const query: Record<string, string> = {
    ...(o.list.query ?? {}),
    ...(o.list.filter ? { [o.list.filter.param]: o.list.filter.value } : {}),
  };
  if (c.size && c.sizeParam) query[c.sizeParam] = String(Math.min(c.size, 25));
  if (c.kind === "page" && c.param) query[c.param] = String(c.start ?? 1);
  if (c.kind === "offset" && c.param) query[c.param] = String(c.start ?? 0);
  void spec;
  return { path: o.list.path, query };
}

/** Items and the next-page token out of one answer, by the object's own pointers. The same function the runtime uses, so validation proves what the sync will do. */
export function readPage(
  body: unknown,
  link: string | undefined,
  o: Pick<SpecObject, "itemsAt" | "id" | "updatedAt">,
  cursor: SpecCursor,
  after: string | undefined,
): { items: unknown[]; next?: string } | undefined {
  const items = pointerGet(body, o.itemsAt);
  if (!Array.isArray(items)) return undefined;
  let next: string | undefined;
  const sized = cursor.size !== undefined && items.length < cursor.size;
  if (cursor.kind === "cursor" && cursor.next !== undefined) {
    const v = pointerGet(body, cursor.next);
    if (typeof v === "string" && v !== "") next = v;
    else if (typeof v === "number") next = String(v);
  } else if (cursor.kind === "page" && items.length > 0 && !sized)
    next = String((after !== undefined ? Number(after) : (cursor.start ?? 1)) + 1);
  else if (cursor.kind === "offset" && items.length > 0 && !sized)
    next = String((after !== undefined ? Number(after) : (cursor.start ?? 0)) + items.length);
  else if (cursor.kind === "link") {
    // the next address is in the answer when the spec says where (cursor.next), otherwise in the Link header
    const v = cursor.next !== undefined ? pointerGet(body, cursor.next) : link ? nextLink(link) : undefined;
    if (typeof v === "string" && v !== "") next = v;
  }
  if (next !== undefined && next === after) next = undefined;
  return { items, ...(next !== undefined ? { next } : {}) };
}

/** The rel="next" target of a Link header. */
export function nextLink(header: string): string | undefined {
  for (const part of header.split(/,(?=\s*<)/)) {
    const m = /<([^>]+)>\s*;(.*)/.exec(part.trim());
    if (m && /rel\s*=\s*"?([^";]*\s)?next(\s[^";]*)?"?/i.test(m[2]!)) return m[1];
  }
  return undefined;
}
