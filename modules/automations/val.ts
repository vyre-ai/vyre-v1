// Vyre Automation Language values and the stable-capability rule.
// The builder and agents both store these shapes. A step input is never a stringified number or boolean.
// Missing, null, and empty stay distinct so a mapping can leave a field unchanged without writing an empty value.

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

export type TypeRef = string;

export type ValueExpr =
  | { kind: "literal"; value: JsonValue; valueType: TypeRef }
  | { kind: "ref"; nodeId: string; path: string; valueType: TypeRef }
  | { kind: "resource"; resourceType: string; id: string; label?: string }
  | { kind: "expression"; language: "cel"; source: string; valueType: TypeRef }
  | { kind: "template"; parts: Array<string | ValueExpr> };

export type Presence = "missing" | "null" | "empty" | "value";

export type EffectClass = "read" | "write" | "outward" | "destructive";

export interface CapabilityContract {
  key: string;
  inputSchema: unknown;
  outputSchema: unknown;
  effects: EffectClass;
  /** Empty means the step needs no connection. Absent means the contract forgot to say. */
  connection?: { required: boolean; app?: string };
  errors: readonly { code: string; retryable: boolean }[];
  test: { mode: "sample" | "live-read" | "stub-write" };
  idempotency: "key" | "none" | "read-only";
  availability: "live" | "preview" | "unavailable";
  executorVersion: string;
}

export interface ContractIssue { code: string; message: string }

const SECRET_KEY = /(secret|password|authorization|cookie|token|api[-_]?key|credential)/i;

export function presenceOf(value: unknown): Presence {
  if (value === undefined) return "missing";
  if (value === null) return "null";
  if (value === "") return "empty";
  if (Array.isArray(value) && value.length === 0) return "empty";
  return "value";
}

/** Numbers stay numbers. Booleans stay booleans. A quoted number is a string on purpose. */
export function literal(value: JsonValue, valueType: TypeRef): ValueExpr {
  return { kind: "literal", value, valueType };
}

export function sameValue(a: ValueExpr, b: ValueExpr): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function admit(cap: CapabilityContract): { stable: boolean; issues: ContractIssue[] } {
  const issues: ContractIssue[] = [];
  if (cap.inputSchema === undefined || cap.inputSchema === null) issues.push({ code: "capability.input", message: `${cap.key} needs an input schema.` });
  if (cap.outputSchema === undefined || cap.outputSchema === null) issues.push({ code: "capability.output", message: `${cap.key} needs an output schema.` });
  if (!cap.effects) issues.push({ code: "capability.effects", message: `${cap.key} needs an effect classification.` });
  if (!cap.connection) issues.push({ code: "capability.connection", message: `${cap.key} needs an explicit connection requirement.` });
  if (!cap.errors || cap.errors.length === 0) issues.push({ code: "capability.errors", message: `${cap.key} needs documented errors.` });
  if (!cap.test) issues.push({ code: "capability.test", message: `${cap.key} needs a test behavior.` });
  if (!cap.idempotency) issues.push({ code: "capability.idempotency", message: `${cap.key} needs an idempotency behavior.` });
  if (!cap.executorVersion) issues.push({ code: "capability.executor", message: `${cap.key} needs an executor version.` });
  if (cap.availability !== "live") issues.push({ code: "capability.availability", message: `${cap.key} is ${cap.availability} and cannot publish as a stable action.` });
  if (SECRET_KEY.test(JSON.stringify(cap.outputSchema ?? {}))) {
    issues.push({ code: "capability.output_secret", message: `${cap.key} output schema names a secret. Stable output must stay scrubbed.` });
  }
  return { stable: issues.length === 0, issues };
}

/** Preview and unavailable actions cannot be enabled on a live definition. */
export function blocksLivePublish(availability: CapabilityContract["availability"]): boolean {
  return availability !== "live";
}
