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

export interface CatalogueStep {
  key: string;
  input: unknown;
  output: unknown;
  effects: "read" | "write" | "outward";
  errors?: readonly string[];
  idempotency?: "key" | "natural" | "none";
}

const ACCOUNT_FIELDS = ["connectionId", "mailboxId", "numberId"] as const;

function requiredNames(schema: unknown): Set<string> {
  const required = schema && typeof schema === "object" ? (schema as { required?: unknown }).required : undefined;
  return new Set(Array.isArray(required) ? required.filter((name): name is string => typeof name === "string") : []);
}

function propertyNames(schema: unknown): Set<string> {
  const properties = schema && typeof schema === "object" ? (schema as { properties?: unknown }).properties : undefined;
  if (!properties || typeof properties !== "object") return new Set();
  return new Set(Object.keys(properties as Record<string, unknown>));
}

/** The catalogue row is the contract. A missing field stays missing so admit() can refuse it. */
export function contractOf(step: CatalogueStep, availability: CapabilityContract["availability"] = "live"): CapabilityContract {
  const required = requiredNames(step.input);
  const props = propertyNames(step.input);
  const account = ACCOUNT_FIELDS.find((name) => required.has(name) || props.has(name));
  const idempotency: CapabilityContract["idempotency"] = step.idempotency === "none"
    ? (step.effects === "read" ? "read-only" : "none")
    : "key";
  return {
    key: step.key,
    inputSchema: step.input,
    outputSchema: step.output,
    effects: step.effects,
    ...(account ? { connection: { required: required.has(account), app: account === "mailboxId" ? "mail" : account === "numberId" ? "sms" : "connection" } } : { connection: { required: false } }),
    errors: (step.errors ?? []).map((code) => ({ code, retryable: code.startsWith("timeout.") || code === "internal.unexpected" || code.startsWith("provider.") })),
    test: { mode: step.effects === "read" ? "live-read" : "stub-write" },
    idempotency,
    availability,
    executorVersion: "1",
  };
}
