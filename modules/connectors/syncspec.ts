// SyncSpec (spec 2.10): the one document an agent fills to bring an app's records into Records. Nothing here knows an app. The platform parses it, checks it against a real sampled
// page, and compiles it into connector actions (the engine's list/create/update/delete, shaped by ActionDef.shape), record types (fields, choices, relations, stages) and bindings.
// The document holds a Vault handle, never a value, and a write is compiled only where the spec cites the docs that show it.
import { pointerGet } from "./projections.ts";
import type { ActionDef, ConnectorDef } from "./projections.ts";

export const FIELD_TYPES = ["text", "number", "money", "date", "bool", "choice", "multi", "email", "phone", "url", "relation", "json"] as const;
export type SpecFieldType = (typeof FIELD_TYPES)[number];
export const AUTH_STYLES = ["bearer", "header", "basic", "query", "oauth"] as const;
export const CURSOR_KINDS = ["none", "page", "cursor", "offset", "link"] as const;
export const DIRECTIONS = ["both", "pull", "push", "off"] as const;

export interface SpecField { path: string; label: string; type: SpecFieldType; choices?: { value: string; label?: string }[]; relationTo?: string; readOnly?: boolean }
export interface SpecCursor { kind: (typeof CURSOR_KINDS)[number]; param?: string; next?: string; size?: number; sizeParam?: string; start?: number }
export interface SpecList { path: string; query?: Record<string, string>; cursor?: SpecCursor; updatedSince?: { param: string; format?: string }; filter?: { param: string; value: string } }
export interface SpecWrite { path: string; method?: string; evidence: string; bodyAt?: string; idAt?: string }
export interface SpecObject {
  remote: string; label: string; count?: number; list: SpecList; get?: { path: string }; create?: SpecWrite; update?: SpecWrite; delete?: SpecWrite;
  id: string; updatedAt?: string; itemsAt: string; openUrl?: string; fields: SpecField[];
  webhook?: { events: string[]; subscribePath?: string; manualUrl?: boolean; signature?: string };
}
export interface SpecMappingField { path: string; field?: string; direction: (typeof DIRECTIONS)[number] }
export interface SpecMapping {
  remote: string; recordType: string; title?: string; fields: SpecMappingField[]; match?: string[]; stagesFrom?: string; titleField?: string;
  deletes?: "off" | "soft" | "travel"; createAtSource?: boolean;
}
export interface SyncSpec {
  app: { name: string; domain: string; docsUrl?: string; logoHint?: string; /** Which account of the app this is (a location, a workspace). Accounts of one app share record types; each record says which it came from. */ account?: string };
  auth: { vaultHandle: string; style: (typeof AUTH_STYLES)[number]; header?: string; prefix?: string; headers?: Record<string, string> };
  objects: SpecObject[];
  mapping: SpecMapping[];
  plan: { firstPull: { words: string }; backfill: "later" | "now"; conflicts: "newest" };
}

export interface Problem { level: "error" | "warn"; at: string; message: string }

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
  const bad = (at: string, message: string): void => { problems.push({ level: "error", at, message }); };
  if (!isObj(raw)) return { problems: [{ level: "error", at: "spec", message: "The spec must be an object." }] };
  const app = raw["app"], auth = raw["auth"], plan = raw["plan"];
  if (!isObj(app) || !str(app["name"])) bad("app.name", "Name the app.");
  if (!isObj(app) || !str(app["domain"]) || !HOST.test(String(app["domain"]))) bad("app.domain", "app.domain is the API host, such as api.example.com.");
  if (!isObj(auth) || !str(auth["vaultHandle"]) || !HANDLE.test(String(auth["vaultHandle"]))) bad("auth.vaultHandle", "auth.vaultHandle is a Vault handle such as #Acme_API. Never a key value.");
  if (!isObj(auth) || !(AUTH_STYLES as readonly unknown[]).includes(auth["style"])) bad("auth.style", `auth.style is one of ${AUTH_STYLES.join(", ")}.`);
  if (isObj(auth) && auth["style"] === "query") bad("auth.style", "A key in the address is refused: use bearer or header.");
  if (isObj(auth) && auth["style"] === "oauth") bad("auth.style", "Sign in with OAuth in Console > Integrations first; the spec takes a key held in the Vault.");
  const objects = raw["objects"], mapping = raw["mapping"];
  if (!Array.isArray(objects) || !objects.length) bad("objects", "List at least one object.");
  if (!Array.isArray(mapping) || !mapping.length) bad("mapping", "Map at least one object to a record type.");
  if (!isObj(plan) || !isObj(plan["firstPull"]) || !str(plan["firstPull"]["words"])) bad("plan.firstPull.words", "Say in plain words what the first pull brings in.");
  if (isObj(plan) && plan["backfill"] !== "later" && plan["backfill"] !== "now") bad("plan.backfill", "plan.backfill is later or now.");
  if (isObj(plan) && plan["conflicts"] !== "newest") bad("plan.conflicts", "plan.conflicts is newest.");
  if (problems.length) return { problems };

  for (const [i, o] of (objects as unknown[]).entries()) {
    const at = `objects[${i}]`;
    if (!isObj(o)) { bad(at, "An object entry must be an object."); continue; }
    if (!str(o["remote"])) bad(`${at}.remote`, "Name the object as the app does.");
    if (!str(o["label"])) bad(`${at}.label`, "Give the object a label.");
    if (!pointerOk(o["id"]) || o["id"] === "") bad(`${at}.id`, "id is a pointer inside one item, such as /id.");
    if (!pointerOk(o["itemsAt"])) bad(`${at}.itemsAt`, "itemsAt is a pointer to the list of items in an answer (/ for the answer itself).");
    const list = o["list"];
    if (!isObj(list) || !str(list["path"]) || !String(list["path"]).startsWith("/")) bad(`${at}.list.path`, "list.path is the address path, starting with /.");
    if (isObj(list) && isObj(list["cursor"])) {
      const c = list["cursor"];
      if (!(CURSOR_KINDS as readonly unknown[]).includes(c["kind"])) bad(`${at}.list.cursor.kind`, `cursor.kind is one of ${CURSOR_KINDS.join(", ")}.`);
      else if ((c["kind"] === "page" || c["kind"] === "cursor" || c["kind"] === "offset") && !str(c["param"])) bad(`${at}.list.cursor.param`, "Name the query parameter that carries the page, cursor or offset.");
      if (c["kind"] === "cursor" && !pointerOk(c["next"])) bad(`${at}.list.cursor.next`, "A cursor needs next: the pointer to the next cursor in the answer.");
    }
    for (const w of ["create", "update", "delete"] as const) {
      const wr = o[w];
      if (wr === undefined) continue;
      if (!isObj(wr) || !str(wr["path"]) || !String(wr["path"]).startsWith("/")) bad(`${at}.${w}.path`, `${w}.path is the address path, starting with /.`);
      else if (!str(wr["evidence"])) bad(`${at}.${w}.evidence`, `${w} is refused without evidence: cite the docs page or quote that shows it.`);
      else if ((w === "update" || w === "delete") && !String(wr["path"]).includes("{id}")) bad(`${at}.${w}.path`, `${w}.path must contain {id}.`);
    }
    if (!Array.isArray(o["fields"])) bad(`${at}.fields`, "fields is a list.");
    else for (const [j, f] of (o["fields"] as unknown[]).entries()) {
      const fa = `${at}.fields[${j}]`;
      if (!isObj(f) || !pointerOk(f["path"]) || f["path"] === "") bad(`${fa}.path`, "A field path is a pointer inside one item, such as /email.");
      else {
        if (!str(f["label"])) bad(`${fa}.label`, "Give the field a label.");
        if (!(FIELD_TYPES as readonly unknown[]).includes(f["type"])) bad(`${fa}.type`, `type is one of ${FIELD_TYPES.join(", ")}.`);
        if (f["type"] === "relation" && !str(f["relationTo"])) bad(`${fa}.relationTo`, "A relation names the object it points to.");
      }
    }
  }
  for (const [i, m] of (mapping as unknown[]).entries()) {
    const at = `mapping[${i}]`;
    if (!isObj(m)) { bad(at, "A mapping entry must be an object."); continue; }
    if (!str(m["remote"])) bad(`${at}.remote`, "Name the object this maps.");
    if (!str(m["recordType"]) || !KEY.test(String(m["recordType"]))) bad(`${at}.recordType`, "recordType is lowercase letters, digits and underscores, starting with a letter.");
    if (!Array.isArray(m["fields"])) bad(`${at}.fields`, "fields is a list.");
    else for (const [j, f] of (m["fields"] as unknown[]).entries()) {
      if (!isObj(f) || !pointerOk(f["path"]) || !(DIRECTIONS as readonly unknown[]).includes(f["direction"])) bad(`${at}.fields[${j}]`, "Each mapped field has a path and a direction (both, pull, push, off).");
      else if (f["field"] !== undefined && (!str(f["field"]) || !KEY.test(String(f["field"])))) bad(`${at}.fields[${j}].field`, "A record field key is lowercase letters, digits and underscores.");
    }
  }
  if (problems.length) return { problems };
  return { spec: raw as unknown as SyncSpec, problems };
}

// ---- values ----

const ISO = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})?)?$/;

/** One remote value as the record field takes it. `ok: false` means it does not fit and the field is left empty (the validator warns about it). */
export function coerceValue(v: unknown, type: SpecFieldType | "list", choices?: readonly string[]): { ok: true; value: unknown } | { ok: false } {
  if (v === null || v === undefined || v === "") return { ok: true, value: null };
  const text = (): { ok: true; value: unknown } | { ok: false } => (typeof v === "string" ? { ok: true, value: v } : typeof v === "number" || typeof v === "boolean" ? { ok: true, value: String(v) } : { ok: false });
  switch (type) {
    case "text": case "email": case "phone": return text();
    case "relation": return text();
    case "json": return { ok: true, value: typeof v === "string" ? v : JSON.stringify(v) };
    case "number": case "money": {
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
      if (typeof v === "number" && Number.isFinite(v)) return { ok: true, value: new Date(v > 1e11 ? v : v * 1000).toISOString() };
      return { ok: false };
    }
    case "url": return typeof v === "string" && /^https?:\/\//.test(v) ? { ok: true, value: v } : { ok: false };
    case "choice": {
      const s = typeof v === "string" ? v : typeof v === "number" ? String(v) : undefined;
      return s !== undefined && (!choices || choices.includes(s)) ? { ok: true, value: s } : { ok: false };
    }
    // a list with no declared choices is a text field here: its values are joined (the compiler asks for this type, a spec never does)
    case "list": return Array.isArray(v) ? { ok: true, value: v.filter((x) => typeof x === "string" || typeof x === "number").join(", ") } : typeof v === "string" ? { ok: true, value: v } : { ok: false };
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
    if (!pointer.startsWith("/")) { out[pointer] = value; continue; }
    const keys = pointer.slice(1).split("/").map((k) => k.replaceAll("~1", "/").replaceAll("~0", "~"));
    let cur = out;
    for (const [i, k] of keys.entries()) {
      if (i === keys.length - 1) cur[k] = value;
      else cur = (isObj(cur[k]) ? cur[k] : (cur[k] = {})) as Record<string, unknown>;
    }
  }
  return out;
}

// ---- names ----

const slug = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
export function fieldKeyOf(s: string): string {
  const k = s.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return /^[a-z]/.test(k) ? k.slice(0, 60) : `f_${k}`.slice(0, 60);
}
export const connectorKeyOf = (spec: SyncSpec): string => `crm_${slug(spec.app.name) || "app"}${spec.app.account ? `_${slug(spec.app.account)}` : ""}`.slice(0, 40);
const actionName = (kind: string, remote: string): string => `${kind}_${slug(remote)}`;

/** The record field key for each mapped path of one mapping: the explicit one, else from the label, made unique. */
export function fieldKeys(obj: SpecObject, m: SpecMapping): Map<string, string> {
  const out = new Map<string, string>();
  const used = new Set<string>();
  for (const f of m.fields) {
    const spec = obj.fields.find((x) => x.path === f.path);
    let key = f.field ?? fieldKeyOf(spec?.label ?? f.path.split("/").pop() ?? "field");
    const base = key;
    for (let n = 2; used.has(key); n++) key = `${base}_${n}`.slice(0, 63);
    used.add(key);
    out.set(f.path, key);
  }
  return out;
}

// ---- compile ----

export interface FieldMapOut { key: string; remote: string; dir: "pull" | "push" | "both" | "off"; relation?: string; inverse?: string; constant?: string }
export interface CompiledType {
  remote: string; recordType: string; title: string; fields: FieldMapOut[]; match: string[]; createAtSource: boolean; deletes: "off" | "soft" | "travel";
  /** Field definitions for schema.apply; relations are made separately (relation.add) once both types exist. */
  defs: { key: string; type: string; title: string; options?: Record<string, unknown> }[];
  relations: { field: string; title: string; to: string; inverse: string; inverseTitle: string }[];
  titleField: string; statusField?: string;
}
export interface Compiled { connector: ConnectorDef; types: CompiledType[]; secretSlot: string }

const LOCAL_TYPE: Record<SpecFieldType, string> = {
  text: "text", number: "number", money: "number", date: "datetime", bool: "checkbox", choice: "choice", multi: "multichoice", email: "email", phone: "phone", url: "url", relation: "relation", json: "longtext",
};

const titleOf = (key: string): string => key.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());

/** A push of a field the spec marks read-only, or a relation, never leaves: direction is capped here so the binding cannot be asked to write it. */
export function directionOf(f: SpecMappingField, spec: SpecField | undefined, writable: boolean): "pull" | "push" | "both" | "off" {
  if (f.direction === "off") return "off";
  if (spec?.type === "relation" || spec?.readOnly === true || !writable) return f.direction === "push" ? "off" : "pull";
  return f.direction;
}

export function compileSpec(spec: SyncSpec): Compiled {
  const secretSlot = "Key";
  const types: CompiledType[] = [];
  const actions: ActionDef[] = [];
  const objects: NonNullable<ConnectorDef["objects"]> = {};
  const baseHeaders: Record<string, string> = { Accept: "application/json", ...(spec.auth.headers ?? {}) };
  const byRemote = new Map(spec.objects.map((o) => [o.remote, o]));

  for (const m of spec.mapping) {
    const o = byRemote.get(m.remote);
    if (!o) continue;
    const keys = fieldKeys(o, m);
    const cursor = o.list.cursor ?? { kind: "none" as const };
    const filter = spec.plan.backfill === "now" ? undefined : o.list.filter;
    const query: Record<string, string> = { ...(o.list.query ?? {}), ...(filter ? { [filter.param]: filter.value } : {}) };
    if (cursor.size && cursor.sizeParam) query[cursor.sizeParam] = String(cursor.size);
    if (cursor.kind === "page" && cursor.param) query[cursor.param] = String(cursor.start ?? 1);
    if (cursor.kind === "offset" && cursor.param) query[cursor.param] = String(cursor.start ?? 0);

    const mapped = m.fields.filter((f) => f.direction !== "off");
    const shapeFields = [...new Set(mapped.map((f) => f.path))];
    const types_: Record<string, string> = {};
    const choices: Record<string, string[]> = {};
    for (const p of shapeFields) {
      const sf = o.fields.find((x) => x.path === p);
      if (!sf) continue;
      // a pick-list or a multi-pick with no choices listed becomes plain text locally; the sync reads it the same way
      types_[p] = sf.type === "multi" && !sf.choices?.length ? "list" : sf.type;
      if (sf.choices?.length) choices[p] = sf.choices.map((c) => c.value);
    }
    const listShape = {
      items: o.itemsAt, id: o.id, ...(o.updatedAt ? { updatedAt: o.updatedAt } : {}), fields: shapeFields, types: types_, choices,
      cursor: { kind: cursor.kind, ...(cursor.param ? { param: cursor.param } : {}), ...(cursor.next ? { next: cursor.next } : {}), ...(cursor.size ? { size: cursor.size } : {}), ...(cursor.start !== undefined ? { start: cursor.start } : {}) },
    };
    const names = { list: actionName("list", o.remote), listAfter: `${actionName("list", o.remote)}_after`, create: actionName("create", o.remote), update: actionName("update", o.remote), delete: actionName("delete", o.remote) };
    const headers = { ...baseHeaders };
    actions.push({ name: names.list, method: "GET", url: `https://${spec.app.domain}${o.list.path}`, headers, query, shape: listShape });
    actions.push({ name: names.listAfter, method: "GET", url: `https://${spec.app.domain}${o.list.path}`, headers, query, shape: listShape });
    const nest = (w: SpecWrite): unknown => {
      const at = w.bodyAt ?? "";
      if (at === "") return "{input.properties}";
      let body: unknown = "{input.properties}";
      for (const k of at.slice(1).split("/").reverse()) body = { [k]: body };
      return body;
    };
    const writable = { create: o.create !== undefined, update: o.update !== undefined };
    const entry: NonNullable<ConnectorDef["objects"]>[string] = { list: names.list, listAfter: names.listAfter };
    if (o.create && (m.createAtSource ?? false)) {
      actions.push({ name: names.create, method: (o.create.method ?? "POST") as ActionDef["method"], url: `https://${spec.app.domain}${o.create.path}`, headers, body: nest(o.create), write: true, shape: { unflatten: true, ...(o.create.idAt ? { idAt: o.create.idAt } : {}) } });
      entry.create = names.create;
    }
    if (o.update) {
      actions.push({ name: names.update, method: (o.update.method ?? "PATCH") as ActionDef["method"], url: `https://${spec.app.domain}${o.update.path.replaceAll("{id}", "{input.id}")}`, headers, body: nest(o.update), write: true, shape: { unflatten: true } });
      entry.update = names.update;
    }
    if (o.delete && (m.deletes ?? "off") !== "off") {
      actions.push({ name: names.delete, method: (o.delete.method ?? "DELETE") as ActionDef["method"], url: `https://${spec.app.domain}${o.delete.path.replaceAll("{id}", "{input.id}")}`, headers, write: true });
      entry.delete = names.delete;
    }
    objects[o.remote] = entry;

    // record type: fields, choices, stages
    const defs: CompiledType["defs"] = [];
    const relations: CompiledType["relations"] = [];
    const fields: FieldMapOut[] = [];
    let statusField: string | undefined;
    for (const f of mapped) {
      const sf = o.fields.find((x) => x.path === f.path);
      const key = keys.get(f.path)!;
      const dir = directionOf(f, sf, writable.update);
      const target = sf?.type === "relation" ? spec.mapping.find((x) => x.remote === sf.relationTo) : undefined;
      const inverse = target ? `${m.recordType}s`.slice(0, 60) : undefined;
      fields.push({ key, remote: f.path, dir, ...(sf?.type === "relation" ? { relation: sf.relationTo! } : {}), ...(inverse ? { inverse } : {}) });
      if (!sf) { defs.push({ key, type: "text", title: titleOf(key) }); continue; }
      if (sf.type === "relation") {
        if (target) relations.push({ field: key, title: sf.label, to: target.recordType, inverse: inverse!, inverseTitle: `${o.label}s` });
        continue;
      }
      const options = sf.choices?.length ? sf.choices.map((c) => ({ key: c.value, title: c.label ?? c.value })) : undefined;
      if (f.path === m.stagesFrom && options) { defs.push({ key, type: "status", title: sf.label, options: { stages: options } }); statusField = key; continue; }
      const type = (sf.type === "choice" || sf.type === "multi") && !options ? "text" : LOCAL_TYPE[sf.type];
      defs.push({ key, type, title: sf.label, ...(options ? { options: { choices: options } } : {}) });
    }
    // relation fields are mapped with their pointer; the target record type's synced binding resolves the remote id to a record
    const textKeys = defs.filter((d) => d.type === "text" || d.type === "email").map((d) => d.key);
    const wanted = m.titleField ? keys.get(m.titleField) ?? m.titleField : undefined;
    const titleField = wanted && defs.some((d) => d.key === wanted) ? wanted : (textKeys.find((k) => /name|title/.test(k)) ?? textKeys[0] ?? defs[0]?.key ?? "name");
    if (!defs.some((d) => d.key === titleField)) defs.unshift({ key: titleField, type: "text", title: titleOf(titleField) });
    // an account stamps its name on every record it pulls, so accounts of one app can share a type and be told apart
    if (spec.app.account) {
      fields.push({ key: "from", remote: "=from", dir: "pull", constant: spec.app.account });
      defs.push({ key: "from", type: "text", title: "From" });
    }
    types.push({
      remote: o.remote, recordType: m.recordType, title: m.title ?? o.label, fields, defs, relations,
      match: (m.match ?? []).map((p) => keys.get(p) ?? p).filter((k) => fields.some((f) => f.key === k)),
      createAtSource: (m.createAtSource ?? false) && o.create !== undefined, deletes: o.delete ? (m.deletes ?? "off") : "off", titleField, ...(statusField ? { statusField } : {}),
    });
  }

  const auth: ConnectorDef["auth"] = spec.auth.style === "bearer"
    ? { type: "bearer", secret: secretSlot }
    : { type: "api_key", secret: secretSlot, header: spec.auth.header ?? "Authorization", prefix: spec.auth.style === "basic" ? "Basic " : (spec.auth.prefix ?? "") };
  const connector: ConnectorDef = {
    key: connectorKeyOf(spec), title: spec.app.name, mode: "api", scope: "space", version: "0.0.0", auth, domains: [spec.app.domain],
    secrets: [{ name: secretSlot, description: `Key for ${spec.app.name}` }], actions, objects, syncedTypes: spec.mapping.map((m) => m.remote), rate: { rps: 5, burst: 10 },
  };
  return { connector, types, secretSlot };
}

/** The request a list action makes for a sampled page, as the validator and the compiled action build it. */
export function firstPageRequest(spec: SyncSpec, o: SpecObject): { path: string; query: Record<string, string> } {
  const c = o.list.cursor ?? { kind: "none" as const };
  const query: Record<string, string> = { ...(o.list.query ?? {}), ...(o.list.filter ? { [o.list.filter.param]: o.list.filter.value } : {}) };
  if (c.size && c.sizeParam) query[c.sizeParam] = String(Math.min(c.size, 25));
  if (c.kind === "page" && c.param) query[c.param] = String(c.start ?? 1);
  if (c.kind === "offset" && c.param) query[c.param] = String(c.start ?? 0);
  void spec;
  return { path: o.list.path, query };
}

/** Items and the next-page token out of one answer, by the object's own pointers. The same function the runtime uses, so validation proves what the sync will do. */
export function readPage(body: unknown, link: string | undefined, o: Pick<SpecObject, "itemsAt" | "id" | "updatedAt">, cursor: SpecCursor, after: string | undefined): { items: unknown[]; next?: string } | undefined {
  const items = pointerGet(body, o.itemsAt);
  if (!Array.isArray(items)) return undefined;
  let next: string | undefined;
  const sized = cursor.size !== undefined && items.length < cursor.size;
  if (cursor.kind === "cursor" && cursor.next !== undefined) {
    const v = pointerGet(body, cursor.next);
    if (typeof v === "string" && v !== "") next = v; else if (typeof v === "number") next = String(v);
  } else if (cursor.kind === "page" && items.length > 0 && !sized) next = String((after !== undefined ? Number(after) : (cursor.start ?? 1)) + 1);
  else if (cursor.kind === "offset" && items.length > 0 && !sized) next = String((after !== undefined ? Number(after) : (cursor.start ?? 0)) + items.length);
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
