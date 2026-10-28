// Paste guide for a connector draft. Ask Vyre sees the field shape. Vault keeps the value.
// A read may be tried later with the saved connection. An outward call is not tried from here.

import { askBundle } from "./ask-vyre.ts";
import type { AskBundle } from "./ask-vyre.ts";
import { containsSecret } from "./trust.ts";

export type PasteIn = "header" | "query" | "body";

export interface PasteField {
  name: string;
  secret: boolean;
  in: PasteIn;
  headerName?: string;
  hint: string;
}

export interface DraftTrigger {
  key: string;
  level: "draft";
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD" | "OPTIONS" | "TRACE";
  path: string;
  effect: "read" | "outward";
  check: "dry_run" | "hold";
}

export interface ActionCheck {
  key: string;
  effect: "read" | "outward";
  check: "dry_run" | "hold";
  reason: string;
}

export interface ConnectorSetup {
  fields: PasteField[];
  triggers: DraftTrigger[];
  checks: ActionCheck[];
  scopes: string[];
  ask: AskBundle;
}

const METHODS = ["get", "post", "put", "patch", "delete", "head", "options", "trace"] as const;
type MethodName = (typeof METHODS)[number];

const SECRET_HINT = "Paste this into Vault. Ask Vyre does not see the value.";
const PLAIN_HINT = "Paste this value. It is not a secret.";
const READ_REASON = "A read can be tried with the saved connection.";
const HOLD_REASON = "An outward call waits until you run it.";
const SIGN_IN = "This document does not say how to sign in.";
const PASTE = "Paste each value into Vault. Secret fields stay in Vault.";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function schemesOf(doc: Record<string, unknown>): Record<string, unknown> {
  const components = isRecord(doc.components) ? doc.components : {};
  const raw = isRecord(components.securitySchemes) ? components.securitySchemes : {};
  const out: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(raw)) {
    const scheme = deref(raw, value);
    if (scheme) out[name] = scheme;
  }
  return out;
}

function deref(schemes: Record<string, unknown>, value: unknown): Record<string, unknown> | undefined {
  if (!isRecord(value)) return undefined;
  const ref = value.$ref;
  if (typeof ref !== "string") return value;
  const name = ref.startsWith("#/components/securitySchemes/") ? ref.slice("#/components/securitySchemes/".length) : "";
  return name && isRecord(schemes[name]) ? schemes[name] as Record<string, unknown> : undefined;
}

function cleanName(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const name = value.trim();
  if (!name || containsSecret(name)) return fallback;
  return name;
}

function placement(value: unknown): PasteIn {
  if (value === "query") return "query";
  if (value === "body") return "body";
  return "header";
}

function pushField(fields: PasteField[], field: PasteField): void {
  if (fields.some((have) => have.name === field.name && have.in === field.in)) return;
  fields.push(field);
}

function fieldsFromScheme(name: string, scheme: Record<string, unknown>): PasteField[] {
  const type = typeof scheme.type === "string" ? scheme.type : "";
  if (type === "apiKey") {
    const headerName = cleanName(scheme.name, name);
    const where = placement(scheme.in);
    return [{
      name: headerName,
      secret: true,
      in: where,
      ...(where === "header" ? { headerName } : {}),
      hint: SECRET_HINT,
    }];
  }
  if (type === "http") {
    const http = typeof scheme.scheme === "string" ? scheme.scheme.toLowerCase() : "";
    if (http === "basic") {
      return [
        { name: "Username", secret: false, in: "header", headerName: "Authorization", hint: PLAIN_HINT },
        { name: "Password", secret: true, in: "header", headerName: "Authorization", hint: SECRET_HINT },
      ];
    }
    return [{ name: "Bearer token", secret: true, in: "header", headerName: "Authorization", hint: SECRET_HINT }];
  }
  if (type === "oauth2" || type === "openIdConnect") {
    return [
      { name: "Client id", secret: false, in: "body", hint: PLAIN_HINT },
      { name: "Client secret", secret: true, in: "body", hint: SECRET_HINT },
    ];
  }
  return [];
}

function scopesOf(scheme: Record<string, unknown>): string[] {
  const flows = isRecord(scheme.flows) ? scheme.flows : {};
  const scopes: string[] = [];
  for (const flow of Object.values(flows)) {
    if (!isRecord(flow) || !isRecord(flow.scopes)) continue;
    for (const scope of Object.keys(flow.scopes)) {
      if (!scope || containsSecret(scope) || scopes.includes(scope)) continue;
      scopes.push(scope);
    }
  }
  return scopes;
}

export function pasteFields(doc: unknown): { fields: PasteField[]; scopes: string[] } {
  if (!isRecord(doc)) return { fields: [], scopes: [] };
  const fields: PasteField[] = [];
  const scopes: string[] = [];
  for (const [name, scheme] of Object.entries(schemesOf(doc))) {
    if (!isRecord(scheme)) continue;
    for (const field of fieldsFromScheme(name, scheme)) pushField(fields, field);
    for (const scope of scopesOf(scheme)) if (!scopes.includes(scope)) scopes.push(scope);
  }
  return { fields, scopes };
}

function effectOf(method: DraftTrigger["method"]): "read" | "outward" {
  return method === "GET" || method === "HEAD" || method === "OPTIONS" ? "read" : "outward";
}

function checkOf(effect: "read" | "outward"): "dry_run" | "hold" {
  return effect === "read" ? "dry_run" : "hold";
}

function methodOf(name: string): DraftTrigger["method"] | undefined {
  const hit = METHODS.find((method) => method === name.toLowerCase());
  if (!hit) return undefined;
  return hit.toUpperCase() as DraftTrigger["method"];
}

export function draftTriggers(doc: unknown): DraftTrigger[] {
  if (!isRecord(doc) || !isRecord(doc.webhooks)) return [];
  const triggers: DraftTrigger[] = [];
  for (const [name, hook] of Object.entries(doc.webhooks)) {
    if (!isRecord(hook) || containsSecret(name)) continue;
    for (const [raw, operation] of Object.entries(hook)) {
      const method = methodOf(raw);
      if (!method || !isRecord(operation)) continue;
      const effect = effectOf(method);
      const key = `wh_${name}_${method.toLowerCase()}`.replace(/[^a-z0-9_]+/gi, "_");
      triggers.push({ key, level: "draft", method, path: `/${name}`, effect, check: checkOf(effect) });
    }
  }
  return triggers;
}

export function actionChecks(actions: readonly { key: string; effect: "read" | "outward" }[]): ActionCheck[] {
  return actions.map((action) => ({
    key: action.key,
    effect: action.effect,
    check: checkOf(action.effect),
    reason: action.effect === "read" ? READ_REASON : HOLD_REASON,
  }));
}

export function setupFrom(doc: unknown, actions: readonly { key: string; effect: "read" | "outward" }[], docsUrl?: string): ConnectorSetup {
  const { fields, scopes } = pasteFields(doc);
  const docs = docsUrl && !containsSecret(docsUrl) ? [docsUrl] : undefined;
  const ask = askBundle({
    resource: "connection",
    message: fields.length > 0 ? PASTE : SIGN_IN,
    fields: fields.map((field) => ({ name: field.name, valueType: field.secret ? "secret" : "string", presence: "missing" })),
    ...(docs ? { docs } : {}),
  });
  return { fields, triggers: draftTriggers(doc), checks: actionChecks(actions), scopes, ask };
}
