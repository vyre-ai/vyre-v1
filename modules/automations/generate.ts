// Draft actions from an OpenAPI 3 document already in memory. No HTTP.
// A generated action stays draft. This module does not record a test and does not call promote().
// Official servers are the only hosts a drafted request may name. A docs URL is not a server.

import { containsSecret } from "./trust.ts";
import type { ConnectorDraft } from "./trust.ts";

export interface JsonSchema {
  type?: string | string[];
  format?: string;
  enum?: unknown[];
  items?: JsonSchema;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  description?: string;
  nullable?: boolean;
  additionalProperties?: boolean | JsonSchema;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  oneOf?: JsonSchema[];
  anyOf?: JsonSchema[];
  allOf?: JsonSchema[];
  example?: unknown;
  default?: unknown;
}

export interface InputField {
  name: string;
  in: "path" | "query" | "header" | "body";
  required: boolean;
  schema: JsonSchema;
}

export interface ErrorMapping {
  status: string;
  code: string;
}

export interface GeneratedAction {
  key: string;
  level: "draft";
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD" | "OPTIONS" | "TRACE";
  path: string;
  fields: InputField[];
  inputSchema: JsonSchema;
  outputSchema?: JsonSchema;
  /** Typed body after secret examples and secret-named properties are removed. */
  body?: JsonSchema;
  effect: "read" | "outward";
  scopes?: string[];
  servers: string[];
  domains: string[];
  errors?: ErrorMapping[];
  connection?: { required: boolean };
  auth: ConnectorDraft["auth"];
  tested: false;
  reviewed: false;
  /** Stable admission fields this draft does not have. Any gap keeps the level at draft. */
  missing: string[];
}

/** One typed request bound to the document's servers. Not a client. */
export interface AuthenticatedRequest {
  method: GeneratedAction["method"];
  path: string;
  query: Record<string, JsonSchema>;
  headers: Record<string, JsonSchema>;
  body?: JsonSchema;
  outputSchema?: JsonSchema;
  effect: "read" | "outward";
  servers: string[];
  allowedDomains: string[];
}

export type HostCheck = { ok: true; host: string | null } | { ok: false; reason: string };

export interface OpenApiDocument {
  openapi?: string;
  info?: { title?: string; version?: string };
  servers?: unknown[];
  paths?: Record<string, unknown>;
  components?: Record<string, unknown>;
  security?: unknown[];
}

export interface GenerateOptions {
  docsUrl?: string;
}

export interface RefusedOperation {
  path: string;
  reason: string;
}

export type GenerateResult =
  | {
      ok: true;
      key: string;
      draft: ConnectorDraft;
      actions: GeneratedAction[];
      request: AuthenticatedRequest | null;
      refused: RefusedOperation[];
    }
  | { ok: false; reason: string };

const METHODS = ["get", "post", "put", "patch", "delete", "head", "options", "trace"] as const;
type MethodName = (typeof METHODS)[number];

const EMPTY = "This document has no servers and no paths, so there is nothing to draft.";
const NO_METHOD = "The operation has no HTTP method.";
const SERVER_CAP = 32;
const SCHEMA_DEPTH = 8;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function secretKey(name: string): boolean {
  return containsSecret({ [name]: true });
}

/** Drop a secret example or default. Keep a safe scalar. An object is kept only with its secret parts removed. */
function cleanValue(value: unknown): unknown {
  if (typeof value === "string") return containsSecret(value) ? undefined : value;
  if (value === null || typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) {
    const kept = value.map((item) => cleanValue(item)).filter((item) => item !== undefined);
    return kept.length ? kept : undefined;
  }
  if (!isRecord(value)) return undefined;
  if (!containsSecret(value)) return value;
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (secretKey(key) || key === "__proto__" || key === "constructor" || key === "prototype") continue;
    const cleaned = cleanValue(item);
    if (cleaned !== undefined) out[key] = cleaned;
  }
  return Object.keys(out).length ? out : undefined;
}

function pointer(doc: Record<string, unknown>, ref: string): unknown {
  if (!ref.startsWith("#/")) return undefined;
  let cur: unknown = doc;
  for (const raw of ref.slice(2).split("/")) {
    if (raw === "") continue;
    let key = raw;
    try { key = decodeURIComponent(raw); } catch { /* keep the raw token */ }
    key = key.replace(/~1/g, "/").replace(/~0/g, "~");
    if (Array.isArray(cur)) {
      if (!/^\d+$/.test(key)) return undefined;
      cur = cur[Number(key)];
    } else if (isRecord(cur)) cur = cur[key];
    else return undefined;
  }
  return cur;
}

function deref(doc: Record<string, unknown>, node: unknown, seen: Set<string>): Record<string, unknown> | undefined {
  if (!isRecord(node)) return undefined;
  const ref = node.$ref;
  if (typeof ref !== "string") return node;
  if (!ref.startsWith("#/") || seen.has(ref)) return undefined;
  seen.add(ref);
  return deref(doc, pointer(doc, ref), seen);
}

function strings(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out = value.filter((item): item is string => typeof item === "string");
  return out.length ? out : undefined;
}

function finite(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function copySchema(doc: Record<string, unknown>, node: unknown, depth: number): JsonSchema | undefined {
  if (depth > SCHEMA_DEPTH) return undefined;
  const schema = deref(doc, node, new Set());
  if (!schema) return undefined;
  const out: JsonSchema = {};
  if (typeof schema.type === "string") out.type = schema.type;
  else {
    const types = strings(schema.type);
    if (types) out.type = types;
  }
  if (typeof schema.format === "string" && !containsSecret(schema.format)) out.format = schema.format;
  if (typeof schema.description === "string" && schema.description && !containsSecret(schema.description)) out.description = schema.description;
  if (typeof schema.pattern === "string" && !containsSecret(schema.pattern)) out.pattern = schema.pattern;
  if (schema.nullable === true || schema.nullable === false) out.nullable = schema.nullable;
  const minimum = finite(schema.minimum);
  const maximum = finite(schema.maximum);
  const minLength = finite(schema.minLength);
  const maxLength = finite(schema.maxLength);
  if (minimum !== undefined) out.minimum = minimum;
  if (maximum !== undefined) out.maximum = maximum;
  if (minLength !== undefined) out.minLength = minLength;
  if (maxLength !== undefined) out.maxLength = maxLength;
  if (Array.isArray(schema.enum)) {
    const kept = schema.enum.map((item) => cleanValue(item)).filter((item) => item !== undefined);
    if (kept.length) out.enum = kept;
  }
  const example = cleanValue(schema.example);
  const fallback = cleanValue(schema.default);
  if (example !== undefined) out.example = example;
  if (fallback !== undefined) out.default = fallback;
  if (schema.items !== undefined) {
    const items = copySchema(doc, schema.items, depth + 1);
    if (items) out.items = items;
  }
  if (isRecord(schema.properties)) {
    const properties: Record<string, JsonSchema> = {};
    for (const [name, value] of Object.entries(schema.properties)) {
      if (secretKey(name) || name === "__proto__" || name === "constructor" || name === "prototype") continue;
      const copied = copySchema(doc, value, depth + 1);
      if (copied) properties[name] = copied;
    }
    out.properties = properties;
    const required = strings(schema.required)?.filter((name) => !secretKey(name) && name in properties);
    if (required?.length) out.required = required;
  }
  if (typeof schema.additionalProperties === "boolean") out.additionalProperties = schema.additionalProperties;
  else if (schema.additionalProperties !== undefined) {
    const extra = copySchema(doc, schema.additionalProperties, depth + 1);
    if (extra) out.additionalProperties = extra;
  }
  for (const key of ["oneOf", "anyOf", "allOf"] as const) {
    if (!Array.isArray(schema[key])) continue;
    const list: JsonSchema[] = [];
    for (const item of schema[key] as unknown[]) {
      const copied = copySchema(doc, item, depth + 1);
      if (copied) list.push(copied);
    }
    if (list.length) out[key] = list;
  }
  return out;
}

function applyExample(schema: JsonSchema, example: unknown): JsonSchema {
  const cleaned = cleanValue(example);
  if (cleaned === undefined || schema.example !== undefined) return schema;
  return { ...schema, example: cleaned };
}

function slug(value: string, limit = 48): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase()
    .slice(0, limit);
}

function uniqueKey(base: string, used: Set<string>): string {
  const root = base || "action";
  if (!used.has(root)) {
    used.add(root);
    return root;
  }
  let n = 2;
  while (used.has(`${root}_${n}`)) n += 1;
  const next = `${root}_${n}`.slice(0, 48);
  used.add(next);
  return next;
}

function variableValues(spec: unknown): string[] | undefined {
  if (!isRecord(spec)) return undefined;
  const values: string[] = [];
  if (Array.isArray(spec.enum)) {
    for (const item of spec.enum) {
      if (typeof item === "string" && item && !containsSecret(item) && !values.includes(item)) values.push(item);
    }
  }
  if (values.length === 0 && typeof spec.default === "string" && spec.default && !containsSecret(spec.default)) values.push(spec.default);
  return values.length ? values : undefined;
}

function expandTemplate(template: string, variables: Record<string, unknown>): string[] {
  const names = [...template.matchAll(/\{([^}]+)\}/g)].map((match) => match[1] ?? "").filter((name) => name.length > 0);
  if (names.length === 0) return [template.trim()];
  let combos: string[][] = [[]];
  for (const name of names) {
    const values = variableValues(variables[name]);
    if (!values) return [];
    const next: string[][] = [];
    for (const combo of combos) {
      for (const value of values) {
        next.push([...combo, value]);
        if (next.length >= SERVER_CAP) return applyCombos(template, next);
      }
    }
    combos = next;
  }
  return applyCombos(template, combos);
}

function applyCombos(template: string, combos: string[][]): string[] {
  const urls: string[] = [];
  for (const combo of combos) {
    let index = 0;
    const url = template.replace(/\{[^}]+\}/g, () => combo[index++] ?? "").trim();
    if (url && !urls.includes(url)) urls.push(url);
  }
  return urls;
}

function hostOf(url: string): string | undefined {
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/\.$/, "");
    return host || undefined;
  } catch {
    return undefined;
  }
}

function expandServers(list: unknown): { servers: string[]; domains: string[] } {
  const servers: string[] = [];
  const domains: string[] = [];
  if (!Array.isArray(list)) return { servers, domains };
  for (const item of list) {
    if (!isRecord(item) || typeof item.url !== "string" || !item.url.trim()) continue;
    const variables = isRecord(item.variables) ? item.variables : {};
    for (const url of expandTemplate(item.url.trim(), variables)) {
      if (!servers.includes(url)) servers.push(url);
      const host = hostOf(url);
      if (host && !host.includes("{") && !domains.includes(host)) domains.push(host);
    }
  }
  return { servers, domains };
}

function serversFor(operation: Record<string, unknown>, pathItem: Record<string, unknown>, doc: Record<string, unknown>): { servers: string[]; domains: string[] } {
  if (Array.isArray(operation.servers)) return expandServers(operation.servers);
  if (Array.isArray(pathItem.servers)) return expandServers(pathItem.servers);
  return expandServers(doc.servers);
}

function jsonContent(content: Record<string, unknown>): Record<string, unknown> | undefined {
  const preferred = content["application/json"];
  if (isRecord(preferred)) return preferred;
  for (const [type, value] of Object.entries(content)) {
    if (isRecord(value) && /^\s*application\/(?:[\w.+-]+\+)?json\s*$/i.test(type)) return value;
  }
  for (const value of Object.values(content)) if (isRecord(value) && "schema" in value) return value;
  return undefined;
}

function parameterSchema(param: Record<string, unknown>): unknown {
  if ("schema" in param) return param.schema;
  if (!isRecord(param.content)) return undefined;
  return jsonContent(param.content)?.schema;
}

function fieldFromParameter(doc: Record<string, unknown>, param: Record<string, unknown>): InputField | undefined {
  const location = param.in;
  if (location !== "path" && location !== "query" && location !== "header") return undefined;
  if (typeof param.name !== "string" || !param.name.trim() || secretKey(param.name.trim())) return undefined;
  const copied = copySchema(doc, parameterSchema(param), 0) ?? {};
  return {
    name: param.name.trim(),
    in: location,
    required: location === "path" ? true : param.required === true,
    schema: applyExample(copied, param.example),
  };
}

function parametersOf(pathItem: Record<string, unknown>, operation: Record<string, unknown>, doc: Record<string, unknown>): InputField[] {
  const merged = new Map<string, InputField>();
  for (const list of [pathItem.parameters, operation.parameters]) {
    if (!Array.isArray(list)) continue;
    for (const raw of list) {
      const param = deref(doc, raw, new Set());
      if (!param) continue;
      const field = fieldFromParameter(doc, param);
      if (!field) continue;
      merged.set(`${field.in}:${field.name}`, field);
    }
  }
  return [...merged.values()];
}

function bodyOf(operation: Record<string, unknown>, doc: Record<string, unknown>): { schema?: JsonSchema; required: boolean } {
  const body = deref(doc, operation.requestBody, new Set());
  if (!body || !isRecord(body.content)) return { required: body?.required === true };
  const media = jsonContent(body.content);
  if (!media || !("schema" in media)) return { required: body.required === true };
  const schema = copySchema(doc, media.schema, 0);
  return schema ? { schema, required: body.required === true } : { required: body.required === true };
}

function fieldsFromBody(schema: JsonSchema | undefined, bodyRequired: boolean): InputField[] {
  if (!schema) return [];
  const objectLike = schema.properties && (schema.type === undefined || schema.type === "object" || (Array.isArray(schema.type) && schema.type.includes("object")));
  if (objectLike && schema.properties) {
    const required = new Set(schema.required ?? []);
    return Object.entries(schema.properties).map(([name, prop]) => ({ name, in: "body" as const, required: required.has(name), schema: prop }));
  }
  return [{ name: "body", in: "body", required: bodyRequired, schema }];
}

function inputSchemaOf(fields: InputField[]): JsonSchema {
  const properties: Record<string, JsonSchema> = {};
  const required: string[] = [];
  for (const field of fields) {
    const name = field.name in properties ? `${field.in}_${field.name}` : field.name;
    properties[name] = field.schema;
    if (field.required) required.push(name);
  }
  return { type: "object", properties, ...(required.length ? { required } : {}) };
}

const SUCCESS = ["200", "201", "202", "203", "204", "205", "206"];

function outputOf(operation: Record<string, unknown>, doc: Record<string, unknown>): JsonSchema | undefined {
  if (!isRecord(operation.responses)) return undefined;
  const codes = Object.keys(operation.responses);
  const status = SUCCESS.find((code) => code in operation.responses!) ?? codes.filter((code) => /^2\d\d$/.test(code)).sort()[0];
  if (!status) return undefined;
  const response = deref(doc, operation.responses[status], new Set());
  if (!response || !isRecord(response.content)) return undefined;
  const media = jsonContent(response.content);
  if (!media || !("schema" in media)) return undefined;
  return copySchema(doc, media.schema, 0);
}

/** Statuses the document lists, mapped to catalogue codes. Success codes and unlisted statuses are not invented. */
function codeForStatus(status: string): string | undefined {
  if (status === "default" || status === "4XX") return "provider.bad_response";
  if (status === "5XX") return "provider.unavailable";
  if (!/^\d{3}$/.test(status)) return undefined;
  const n = Number(status);
  if (n < 400) return undefined;
  if (n === 400 || n === 422) return "validation.bad_input";
  if (n === 401 || n === 403) return "provider.auth_failed";
  if (n === 402 || n === 409 || n === 412) return "validation.precondition_failed";
  if (n === 404 || n === 410) return "validation.not_found";
  if (n === 408) return "provider.network";
  if (n === 429) return "provider.rate_limited";
  if (n >= 500) return "provider.unavailable";
  return "provider.bad_response";
}

function errorsOf(operation: Record<string, unknown>): ErrorMapping[] {
  if (!isRecord(operation.responses)) return [];
  const errors: ErrorMapping[] = [];
  for (const status of Object.keys(operation.responses).sort()) {
    const code = codeForStatus(status);
    if (code) errors.push({ status, code });
  }
  return errors;
}

function securityList(operation: Record<string, unknown>, doc: Record<string, unknown>): unknown[] | undefined {
  const security = operation.security ?? doc.security;
  return Array.isArray(security) ? security : undefined;
}

function scopesOf(operation: Record<string, unknown>, doc: Record<string, unknown>): string[] | undefined {
  if (operation.security === undefined && doc.security === undefined) return undefined;
  const requirements = securityList(operation, doc);
  if (!requirements) return undefined;
  const scopes: string[] = [];
  for (const requirement of requirements) {
    if (!isRecord(requirement)) continue;
    for (const list of Object.values(requirement)) {
      if (!Array.isArray(list)) continue;
      for (const scope of list) {
        if (typeof scope !== "string" || !scope || secretKey(scope) || containsSecret(scope) || scopes.includes(scope)) continue;
        scopes.push(scope);
      }
    }
  }
  return scopes;
}

function schemeKind(scheme: Record<string, unknown> | undefined): ConnectorDraft["auth"] {
  if (!scheme || typeof scheme.type !== "string") return "unknown";
  if (scheme.type === "oauth2" || scheme.type === "openIdConnect") return "oauth";
  if (scheme.type === "apiKey") return "api_key";
  if (scheme.type === "http") {
    const http = typeof scheme.scheme === "string" ? scheme.scheme.toLowerCase() : "";
    if (http === "bearer" || http === "basic") return "api_key";
  }
  return "unknown";
}

function authOf(operation: Record<string, unknown>, doc: Record<string, unknown>): ConnectorDraft["auth"] {
  if (operation.security === undefined && doc.security === undefined) return "unknown";
  const requirements = securityList(operation, doc);
  if (!requirements) return "unknown";
  if (requirements.length === 0) return "none";
  const components = isRecord(doc.components) ? doc.components : {};
  const schemes = isRecord(components.securitySchemes) ? components.securitySchemes : {};
  const kinds = new Set<ConnectorDraft["auth"]>();
  for (const requirement of requirements) {
    if (!isRecord(requirement)) {
      kinds.add("unknown");
      continue;
    }
    for (const name of Object.keys(requirement)) kinds.add(schemeKind(deref(doc, schemes[name], new Set())));
  }
  if (kinds.size === 1) return [...kinds][0] ?? "unknown";
  return "unknown";
}

function connectionOf(auth: ConnectorDraft["auth"]): { required: boolean } | undefined {
  if (auth === "unknown") return undefined;
  return { required: auth !== "none" };
}

function effectOf(method: GeneratedAction["method"]): "read" | "outward" {
  return method === "GET" || method === "HEAD" || method === "OPTIONS" ? "read" : "outward";
}

function admissionGaps(action: Pick<GeneratedAction, "inputSchema" | "outputSchema" | "effect" | "connection" | "errors">): string[] {
  const missing: string[] = [];
  if (action.inputSchema == null) missing.push("input");
  if (action.outputSchema == null) missing.push("output");
  if (action.effect !== "read" && action.effect !== "outward") missing.push("effects");
  if (!action.connection) missing.push("connection");
  if (!action.errors || action.errors.length === 0) missing.push("errors");
  // A recorded test, an idempotency choice, and a live executor are not inferred from the document.
  missing.push("test", "idempotency", "executor", "availability");
  return missing;
}

function looksLikeOperation(pathItem: Record<string, unknown>): boolean {
  return "operationId" in pathItem || "responses" in pathItem || "requestBody" in pathItem;
}

function hasAbsoluteHost(path: string): boolean {
  return path.startsWith("//") || /^[a-z][a-z0-9+.-]*:/i.test(path);
}

function cleanDocsUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed || containsSecret(trimmed)) return undefined;
  return trimmed;
}

function noServersAndNoPaths(doc: Record<string, unknown>): boolean {
  const servers = Array.isArray(doc.servers) ? doc.servers.length : 0;
  const paths = isRecord(doc.paths) ? Object.keys(doc.paths).length : 0;
  return servers === 0 && paths === 0;
}

function buildAction(doc: Record<string, unknown>, pathItem: Record<string, unknown>, path: string, methodName: MethodName, operation: Record<string, unknown>, used: Set<string>): { ok: true; action: GeneratedAction } | { ok: false; reason: string } {
  const method = methodName.toUpperCase() as GeneratedAction["method"];
  const { servers, domains } = serversFor(operation, pathItem, doc);
  if (hasAbsoluteHost(path)) {
    const check = rejectForeignHost(path, domains);
    if (!check.ok) return check;
  }
  const fields = parametersOf(pathItem, operation, doc);
  const body = bodyOf(operation, doc);
  fields.push(...fieldsFromBody(body.schema, body.required));
  const outputSchema = outputOf(operation, doc);
  const errors = errorsOf(operation);
  const scopes = scopesOf(operation, doc);
  const auth = authOf(operation, doc);
  const connection = connectionOf(auth);
  const action: GeneratedAction = {
    key: uniqueKey(slug(typeof operation.operationId === "string" && operation.operationId.trim() ? operation.operationId : `${method} ${path.replace(/[{}]/g, "")}`), used),
    level: "draft",
    method,
    path,
    fields,
    inputSchema: inputSchemaOf(fields),
    ...(outputSchema ? { outputSchema } : {}),
    ...(body.schema ? { body: body.schema } : {}),
    effect: effectOf(method),
    ...(scopes !== undefined ? { scopes } : {}),
    servers,
    domains,
    ...(errors.length ? { errors } : {}),
    ...(connection ? { connection } : {}),
    auth,
    tested: false,
    reviewed: false,
    missing: [],
  };
  action.missing = admissionGaps(action);
  return { ok: true, action };
}

function requestScore(action: GeneratedAction): number {
  let score = 0;
  if (action.body) score += 4;
  if (action.fields.some((field) => field.in === "query")) score += 2;
  if (action.fields.some((field) => field.in === "header")) score += 2;
  if (action.outputSchema) score += 2;
  if (action.errors && action.errors.length > 0) score += 1;
  if (action.effect === "outward") score += 1;
  return score;
}

function requestOf(action: GeneratedAction): AuthenticatedRequest {
  const query: Record<string, JsonSchema> = {};
  const headers: Record<string, JsonSchema> = {};
  for (const field of action.fields) {
    if (field.in === "query") query[field.name] = field.schema;
    if (field.in === "header") headers[field.name] = field.schema;
  }
  return {
    method: action.method,
    path: action.path,
    query,
    headers,
    ...(action.body ? { body: action.body } : {}),
    ...(action.outputSchema ? { outputSchema: action.outputSchema } : {}),
    effect: action.effect,
    servers: action.servers,
    allowedDomains: action.domains,
  };
}

function connectorKey(doc: Record<string, unknown>): string {
  const info = isRecord(doc.info) ? doc.info : undefined;
  const title = info && typeof info.title === "string" ? slug(info.title, 40) : "";
  return title || "api";
}

function sharedAuth(actions: GeneratedAction[]): ConnectorDraft["auth"] {
  const first = actions[0]?.auth;
  if (!first) return "unknown";
  return actions.every((action) => action.auth === first) ? first : "unknown";
}

/** A path with a host is allowed only when that host is one of the document's servers. A relative path stays on those servers. */
export function rejectForeignHost(target: string, allowedDomains: readonly string[]): HostCheck {
  const raw = target.trim();
  if (!raw) return { ok: false, reason: "The request has no path." };
  const domains = allowedDomains.map((domain) => domain.toLowerCase().replace(/\.$/, "")).filter((domain) => domain.length > 0);
  if (domains.length === 0) return { ok: false, reason: "The document names no servers, so no host is allowed." };

  let url: URL | undefined;
  if (raw.startsWith("//")) {
    try { url = new URL(`https:${raw}`); } catch { return { ok: false, reason: "The request path is not an address this document allows." }; }
  } else if (/^[a-z][a-z0-9+.-]*:/i.test(raw)) {
    try { url = new URL(raw); } catch { return { ok: false, reason: "The request path is not an address this document allows." }; }
  } else if (raw.startsWith("/")) {
    return { ok: true, host: null };
  } else {
    return { ok: false, reason: "The request path is not bound to the documentation servers." };
  }

  if (url.username || url.password) return { ok: false, reason: "The request address carries a secret." };
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (!host) return { ok: false, reason: "The request has no host." };
  if (!domains.includes(host)) return { ok: false, reason: `${host} is not one of the documentation servers.` };
  return { ok: true, host };
}

export function generate(doc: OpenApiDocument, options?: GenerateOptions): GenerateResult {
  if (!isRecord(doc) || noServersAndNoPaths(doc)) return { ok: false, reason: EMPTY };
  const docsUrl = cleanDocsUrl(options?.docsUrl);
  const actions: GeneratedAction[] = [];
  const refused: RefusedOperation[] = [];
  const used = new Set<string>();
  const paths = isRecord(doc.paths) ? doc.paths : {};
  for (const [path, rawItem] of Object.entries(paths)) {
    const pathItem = deref(doc, rawItem, new Set());
    if (!pathItem) {
      refused.push({ path, reason: "The path has no operation." });
      continue;
    }
    let sawMethod = false;
    for (const methodName of METHODS) {
      const raw = pathItem[methodName];
      if (raw == null) continue;
      if (!isRecord(raw)) {
        refused.push({ path, reason: NO_METHOD });
        continue;
      }
      sawMethod = true;
      const built = buildAction(doc, pathItem, path, methodName, raw, used);
      if (built.ok) actions.push(built.action);
      else refused.push({ path, reason: built.reason });
    }
    if (!sawMethod && looksLikeOperation(pathItem)) refused.push({ path, reason: NO_METHOD });
    for (const [key, value] of Object.entries(pathItem)) {
      if (key.startsWith("x-") || METHODS.includes(key as MethodName)) continue;
      if (key === "$ref" || key === "summary" || key === "description" || key === "servers" || key === "parameters") continue;
      if (isRecord(value) && ("responses" in value || "operationId" in value || "requestBody" in value)) refused.push({ path, reason: NO_METHOD });
    }
  }

  const key = connectorKey(doc);
  let best: GeneratedAction | undefined;
  let bestScore = -1;
  for (const action of actions) {
    const score = requestScore(action);
    if (score > bestScore) {
      best = action;
      bestScore = score;
    }
  }
  return {
    ok: true,
    key,
    draft: {
      key,
      level: "draft",
      tested: false,
      reviewed: false,
      auth: sharedAuth(actions),
      ...(docsUrl ? { docsUrl } : {}),
    },
    actions,
    request: best ? requestOf(best) : null,
    refused,
  };
}

export function authenticatedRequest(doc: OpenApiDocument, options?: GenerateOptions): AuthenticatedRequest | null {
  const result = generate(doc, options);
  return result.ok ? result.request : null;
}
