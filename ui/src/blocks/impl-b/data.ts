// Block data for the seven part-two types, read from `Block.data` (unknown on the wire) into plain typed shapes.
// The field names are the ones in manifests/chat.ts, vault, memory and access (generated/registry.json blocks[].data).
// A field the sender left out becomes an empty value, so a card never throws on a thin payload.

import type { AccessLevel, DiffKind, HelperStatus, MemoryLayer, ModelRef, RequestState, VaultOutcome } from "./logic.ts";

function rec(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function str(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

function strings(value: unknown): string[] {
  const out: string[] = [];
  for (const v of list(value)) if (typeof v === "string") out.push(v);
  return out;
}

function modelRef(value: unknown): ModelRef {
  const r = rec(value);
  const effort = r["effort"];
  return { provider: str(r["provider"]), model: str(r["model"], "a model"), ...(typeof effort === "string" && effort !== "" ? { effort } : {}) };
}

export interface MemorySavedData {
  factId: string;
  layer: MemoryLayer;
  text: string;
  canPromote: boolean;
}

export function memorySavedData(data: unknown): MemorySavedData {
  const d = rec(data);
  return { factId: str(d["factId"]), layer: oneOf(d["layer"], ["person", "agent", "project", "space"] as const, "person"), text: str(d["text"]), canPromote: d["canPromote"] === true };
}

export interface VaultUsedData {
  itemId: string;
  name: string;
  handle: string;
  fields: string[];
  outcome: VaultOutcome;
  where: string;
}

export function vaultUsedData(data: unknown): VaultUsedData {
  const d = rec(data);
  const name = str(d["name"], "an item");
  return { itemId: str(d["itemId"]), name, handle: str(d["handle"], name), fields: strings(d["fields"]), outcome: oneOf(d["outcome"], ["used", "filled", "blocked"] as const, "used"), where: str(d["where"]) };
}

export interface AccessRequestData {
  requestId: string;
  requester: string;
  resourceType: string;
  resourceId: string;
  resourceTitle: string;
  level: AccessLevel;
  note: string;
  state: RequestState;
}

export function accessRequestData(data: unknown): AccessRequestData {
  const d = rec(data);
  const resource = rec(d["resource"]);
  return {
    requestId: str(d["requestId"]),
    requester: str(d["requester"]),
    resourceType: str(resource["type"], "space"),
    resourceId: str(resource["id"]),
    resourceTitle: str(d["resourceTitle"], "this"),
    level: oneOf(d["level"], ["view", "use", "edit", "manage"] as const, "view"),
    note: str(d["note"]),
    state: oneOf(d["state"], ["waiting", "granted", "declined"] as const, "waiting"),
  };
}

export interface SecretInputData {
  name: string;
  kind: string;
  folderId: string;
  fields: string[];
  hint: string;
}

export function secretInputData(data: unknown): SecretInputData {
  const d = rec(data);
  const fields = strings(d["fields"]);
  return { name: str(d["name"], "a secret"), kind: str(d["kind"], "other"), folderId: str(d["folderId"]), fields: fields.length > 0 ? fields : ["value"], hint: str(d["hint"]) };
}

export interface ModelSwitchData {
  threadId: string;
  agentId: string;
  scope: "sub_task" | "thread";
  from: ModelRef;
  to: ModelRef;
  reason: string;
}

export function modelSwitchData(data: unknown): ModelSwitchData {
  const d = rec(data);
  return { threadId: str(d["threadId"]), agentId: str(d["agentId"]), scope: oneOf(d["scope"], ["sub_task", "thread"] as const, "sub_task"), from: modelRef(d["from"]), to: modelRef(d["to"]), reason: str(d["reason"]) };
}

export interface HelperData {
  threadId: string;
  title: string;
  status: HelperStatus;
  agentId: string;
  model: string;
  path: { title: string; threadId: string }[];
}

export function helperData(data: unknown): HelperData {
  const d = rec(data);
  const path = list(d["path"]).map((p) => {
    const r = rec(p);
    return { title: str(r["title"]), threadId: str(r["threadId"]) };
  });
  return { threadId: str(d["threadId"]), title: str(d["title"], "Helper"), status: oneOf(d["status"], ["running", "done", "failed", "stopped"] as const, "running"), agentId: str(d["agentId"]), model: str(d["model"]), path };
}

export interface DiffChange {
  path: string;
  before: unknown;
  after: unknown;
}

export interface DiffCardData {
  diffId: string;
  kind: DiffKind;
  title: string;
  changes: DiffChange[];
  affects: string;
}

export function diffCardData(data: unknown): DiffCardData {
  const d = rec(data);
  const changes = list(d["changes"]).map((c): DiffChange => {
    const r = rec(c);
    return { path: str(r["path"]), before: r["before"], after: r["after"] };
  });
  return { diffId: str(d["diffId"]), kind: oneOf(d["kind"], ["role", "grant", "schema", "policy", "setting", "connector", "config"] as const, "config"), title: str(d["title"], "Proposed change"), changes, affects: str(d["affects"]) };
}
