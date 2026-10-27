// Typed Automation values. Numbers stay numbers, booleans stay booleans, and a reference stores a node id plus a path.
export type JsonValue = null | boolean | number | string | JsonValue[] | { [k: string]: JsonValue };

export type TypeRef = "string" | "number" | "boolean" | "object" | "array" | "unknown";

export type ValueExpr =
  | { kind: "literal"; value: JsonValue; valueType: TypeRef }
  | { kind: "ref"; nodeId: string; path: string; valueType: TypeRef }
  | { kind: "resource"; resourceType: string; id: string; label?: string }
  | { kind: "expression"; language: "cel"; source: string; valueType: TypeRef }
  | { kind: "template"; parts: Array<string | ValueExpr> };

export type Presence = "missing" | "null" | "empty" | "value";

export function typeOf(value: unknown): TypeRef {
  if (typeof value === "number" && Number.isFinite(value)) return "number";
  if (typeof value === "boolean") return "boolean";
  if (typeof value === "string") return "string";
  if (Array.isArray(value)) return "array";
  if (value && typeof value === "object") return "object";
  return "unknown";
}

export function presenceOf(hasKey: boolean, value: unknown): Presence {
  if (!hasKey) return "missing";
  if (value === null) return "null";
  if (value === "") return "empty";
  return "value";
}

/** What the editor writes back. Missing, null, and empty are not collapsed into one another. */
export function literalFromEditor(presence: Presence, text: string, valueType: TypeRef): unknown {
  if (presence === "missing") return undefined;
  if (presence === "null") return null;
  if (presence === "empty") return "";
  if (valueType === "number") {
    const n = Number(text);
    return Number.isFinite(n) ? n : text;
  }
  if (valueType === "boolean") return text === "true";
  if (valueType === "object" || valueType === "array") {
    try {
      const parsed: unknown = JSON.parse(text);
      if (valueType === "array" && Array.isArray(parsed)) return parsed;
      if (valueType === "object" && parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
    } catch {
      return text;
    }
  }
  return text;
}

export function refValue(nodeId: string, path: string, valueType: TypeRef = "unknown"): ValueExpr {
  return { kind: "ref", nodeId, path, valueType };
}

export interface MappingIssue {
  nodeId: string;
  path: string;
  reason: "missing" | "type";
  field?: string;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

/** A reference whose node is gone, or whose declared type does not match the field. Display names are not references. */
export function mappingIssues(nodeIds: ReadonlySet<string>, value: unknown, fieldType?: string, field?: string): MappingIssue[] {
  const out: MappingIssue[] = [];
  const visit = (v: unknown): void => {
    if (Array.isArray(v)) {
      for (const item of v) visit(item);
      return;
    }
    if (!isRecord(v)) return;
    if (v["kind"] === "ref" && typeof v["nodeId"] === "string" && typeof v["path"] === "string") {
      const nodeId = v["nodeId"];
      const path = v["path"];
      if (nodeId !== "trigger" && !nodeIds.has(nodeId)) out.push({ nodeId, path, reason: "missing", ...(field ? { field } : {}) });
      else if (fieldType && fieldType !== "unknown" && typeof v["valueType"] === "string" && v["valueType"] !== "unknown" && v["valueType"] !== fieldType) {
        out.push({ nodeId, path, reason: "type", ...(field ? { field } : {}) });
      }
      return;
    }
    if (v["kind"] === "template" && Array.isArray(v["parts"])) {
      for (const part of v["parts"]) visit(part);
      return;
    }
    for (const child of Object.values(v)) visit(child);
  };
  visit(value);
  return out;
}

export interface ProviderKey {
  id: string;
  name: string;
  kind: "subscription" | "api";
}

/** Provider rows become key choices. Handles and secret material are not copied. */
export function keysFromProviders(out: unknown): ProviderKey[] | null {
  if (!out || typeof out !== "object" || !Array.isArray((out as { providers?: unknown }).providers)) return null;
  const keys: ProviderKey[] = [];
  for (const row of (out as { providers: unknown[] }).providers) {
    if (!row || typeof row !== "object") continue;
    const rec = row as Record<string, unknown>;
    if (typeof rec["id"] !== "string") continue;
    const kind = rec["connection"] === "api_key" ? "api" : "subscription";
    keys.push({ id: rec["id"], name: typeof rec["name"] === "string" ? rec["name"] : rec["id"], kind });
  }
  return keys;
}
