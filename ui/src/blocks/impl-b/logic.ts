// Native chat blocks, part 2 (spec native, 2.17 and 4.8; ARCH 6.8 and 7.2): memory_saved, vault_used, access_request, secret_input, model_switch, helper, diff_card.
// Pure logic: which capability each button calls (mirrors the block definitions in manifests/, checked by the test against generated/registry.json)
// and the small decisions each card makes. A block never calls a module directly: it calls `host.invoke(capability, input)` and `host.open(tab, input)`.
// The secret_input block holds the typed value only in the card's own state and hands it to `vault.item.put` at the moment of saving.

import { readPointer, resolveInput } from "../impl-a/logic.ts";
import type { BlockActionSpec, BlockHost, BlockOpensSpec } from "../impl-a/logic.ts";

export { readPointer, resolveInput };
export type { BlockActionSpec, BlockHost, BlockOpensSpec };

/** What part two needs beyond part one: names for ids, and who is looking. */
export interface BlockHostB extends BlockHost {
  /** The signed-in person's id, so an access request shows its requester the locked view and shows an approver the buttons. */
  viewerId?: string;
  /** A person's or agent's display name for an id. */
  nameOf?: (id: string) => string | undefined;
}

export const PART_TWO_TYPES = ["memory_saved", "vault_used", "access_request", "secret_input", "model_switch", "helper", "diff_card"] as const;
export type PartTwoType = (typeof PART_TWO_TYPES)[number];

export interface BlockSpecB {
  type: PartTwoType;
  actions: readonly BlockActionSpec[];
  opens?: BlockOpensSpec;
}

/** The actions and tab each block declares in the manifests. A test compares this table with generated/registry.json. */
export const BLOCK_SPECS_B: Readonly<Record<PartTwoType, BlockSpecB>> = {
  memory_saved: {
    type: "memory_saved",
    actions: [{ key: "propose_for_team", label: "Propose for team", cap: "memory.promote", input: { factId: "/factId" } }],
  },
  vault_used: {
    type: "vault_used",
    actions: [],
    opens: { tab: "vault.item", input: { itemId: "/itemId" } },
  },
  access_request: {
    type: "access_request",
    actions: [
      { key: "approve", label: "Approve", cap: "access.requests.approve", input: { requestId: "/requestId", level: "/level" } },
      { key: "decline", label: "Decline", cap: "access.requests.decline", input: { requestId: "/requestId" } },
    ],
  },
  secret_input: {
    type: "secret_input",
    actions: [{ key: "save", label: "Save to Vault", cap: "vault.item.put", input: { folderId: "/folderId", kind: "/kind", name: "/name" } }],
  },
  model_switch: { type: "model_switch", actions: [] },
  helper: {
    type: "helper",
    actions: [{ key: "stop", label: "Stop", cap: "engine.stop", input: { threadId: "/threadId" } }],
    opens: { tab: "thread", input: { threadId: "/threadId" } },
  },
  diff_card: {
    type: "diff_card",
    actions: [
      { key: "apply", label: "Apply", cap: "console.diff_apply", input: { diffId: "/diffId" } },
      { key: "reject", label: "Reject", cap: "console.diff_reject", input: { diffId: "/diffId" } },
    ],
  },
};

/** Capabilities the cards call without a block action of their own (the model menus on model_switch). */
export const SET_MODEL_CAPABILITY = "engine.set_model" as const;

export function actionSpecB(type: PartTwoType, key: string): BlockActionSpec | undefined {
  return BLOCK_SPECS_B[type].actions.find((a) => a.key === key);
}

/** Calls the capability a block action declares, with the block's own ids and any extra input. */
export async function runActionB(host: BlockHost, type: PartTwoType, key: string, data: unknown, extra: Record<string, unknown> = {}): Promise<boolean> {
  const spec = actionSpecB(type, key);
  if (spec === undefined) return false;
  await host.invoke(spec.cap, { ...resolveInput(data, spec.input), ...extra });
  return true;
}

/** Opens the tab a block declares. False when the block has none or the data lacks what the tab needs. */
export function openTabB(host: BlockHost, type: PartTwoType, data: unknown): boolean {
  const opens = BLOCK_SPECS_B[type].opens;
  if (opens === undefined) return false;
  const input = resolveInput(data, opens.input);
  if (Object.keys(input).length < Object.keys(opens.input).length) return false;
  host.open(opens.tab, input);
  return true;
}

/* ---------- memory_saved ---------- */

export type MemoryLayer = "person" | "agent" | "project" | "space";
export type PromoteLayer = "agent" | "project" | "space";

const LAYER_WORD: Readonly<Record<MemoryLayer, string>> = { person: "own", agent: "agent", project: "project", space: "Space" };

/** "Saved to your own layer" / "Saved to the Space layer". */
export function memoryHead(layer: MemoryLayer): string {
  return layer === "space" ? "Saved to the Space layer" : `Saved to your ${LAYER_WORD[layer]} layer`;
}

/** Where "Propose for team" sends a fact: a person's or an agent's fact goes to the Space, a project fact too. The Space layer is the top. */
export function promoteTarget(layer: MemoryLayer): PromoteLayer | null {
  return layer === "space" ? null : "space";
}

/** The button shows while the fact can still be promoted. */
export function canPropose(layer: MemoryLayer, canPromote: boolean, proposed: boolean): boolean {
  return canPromote && !proposed && promoteTarget(layer) !== null;
}

export const PROPOSED_LINE = "Proposed to the team · waiting for review";

/* ---------- vault_used ---------- */

export type VaultOutcome = "used" | "filled" | "blocked";

/** "Used #Dana_Lawmatics by name · never shown". A blocked use says so. */
export function vaultLine(handle: string, outcome: VaultOutcome): string {
  if (outcome === "blocked") return `${handle} was blocked · never shown`;
  return `${outcome === "filled" ? "Filled" : "Used"} ${handle} by name · never shown`;
}

export function vaultWhere(where: string | undefined): string {
  return where === "device" ? "On your device" : where === "host" ? "On the server" : where === "computer" ? "On the agent computer" : "";
}

/* ---------- access_request ---------- */

export type RequestState = "waiting" | "granted" | "declined";
export type AccessLevel = "view" | "use" | "edit" | "manage";
export const ACCESS_LEVELS: readonly AccessLevel[] = ["view", "use", "edit", "manage"];

export function levelWord(level: AccessLevel): string {
  return level === "view" ? "view" : level === "use" ? "use" : level === "edit" ? "edit" : "manage";
}

/** "Maya asks for edit on Clients". */
export function requestLine(who: string, level: AccessLevel, resourceTitle: string): string {
  return `${who} asks for ${levelWord(level)} access to ${resourceTitle}`;
}

export function requestStateLine(state: RequestState, level: AccessLevel, by?: string): string {
  if (state === "granted") return `Granted ${levelWord(level)} access${by ? ` by ${by}` : ""}`;
  if (state === "declined") return `Declined${by ? ` by ${by}` : ""}`;
  return "Waiting for a decision";
}

/** The requester sees the locked view; anyone else sees the buttons while the request waits. */
export function requestView(viewerId: string | undefined, requester: string): "requester" | "approver" {
  return viewerId !== undefined && viewerId === requester ? "requester" : "approver";
}

/* ---------- secret_input ---------- */

export interface SecretField {
  key: string;
  value: string;
  secret: true;
}

/** The fields sent to vault.item.put: every named field with the typed value. Empty values are left out. */
export function secretFields(keys: readonly string[], values: Readonly<Record<string, string>>): SecretField[] {
  const out: SecretField[] = [];
  for (const key of keys) {
    const value = values[key];
    if (value !== undefined && value !== "") out.push({ key, value, secret: true });
  }
  return out;
}

/** Save needs a value in every field the block asks for. */
export function canSaveSecret(keys: readonly string[], values: Readonly<Record<string, string>>): boolean {
  if (keys.length === 0) return false;
  for (const key of keys) if ((values[key] ?? "") === "") return false;
  return true;
}

/** A field key shown as a label: api_key becomes "Api key". */
export function fieldLabel(key: string): string {
  const spaced = key.replace(/_/g, " ").trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export const SECRET_SAVED_LINE = "Saved to the Vault. The value did not enter this chat.";
export const SECRET_NOTE = "Type the value here. It goes straight to the Vault and does not enter this chat.";

/** What a log or a host trace may show of a vault.item.put input: every value hidden. */
export function redactSecretInput(input: Record<string, unknown>): Record<string, unknown> {
  const fields = input["fields"];
  if (!Array.isArray(fields)) return input;
  return { ...input, fields: fields.map((f) => (typeof f === "object" && f !== null ? { ...(f as Record<string, unknown>), value: "•••" } : f)) };
}

/* ---------- model_switch ---------- */

export const EFFORTS: readonly string[] = ["Low", "Medium", "High"];

export interface ModelRef {
  provider: string;
  model: string;
  effort?: string;
}

export function modelLabel(ref: ModelRef): string {
  return ref.effort !== undefined && ref.effort !== "" ? `${ref.model} · ${ref.effort}` : ref.model;
}

export function switchTitle(scope: "sub_task" | "thread"): string {
  return scope === "sub_task" ? "Sub-task" : "This chat";
}

/** The models the menu offers: the one in use first, then the one it switched from. */
export function modelChoices(from: ModelRef, to: ModelRef): string[] {
  return to.model === from.model ? [to.model] : [to.model, from.model];
}

/* ---------- helper ---------- */

export type HelperStatus = "running" | "done" | "failed" | "stopped";

export function helperStatusWord(status: HelperStatus): string {
  return status === "running" ? "Working" : status === "done" ? "Done" : status === "failed" ? "Failed" : "Stopped";
}

export function helperTone(status: HelperStatus): "ok" | "bad" | "plain" {
  return status === "done" ? "ok" : status === "failed" ? "bad" : "plain";
}

/** The trail from the parent chat down to this helper: "Intake / Check the bounce list". */
export function helperTrail(path: readonly { title: string }[]): string {
  return path.map((p) => p.title).join(" / ");
}

/* ---------- diff_card ---------- */

export type DiffKind = "role" | "grant" | "schema" | "policy" | "setting" | "connector" | "config";

export function diffKindWord(kind: DiffKind): string {
  return kind === "role" ? "Role" : kind === "grant" ? "Grant" : kind === "schema" ? "Schema" : kind === "policy" ? "Policy" : kind === "setting" ? "Setting" : kind === "connector" ? "Connector" : "Config";
}

/** A before or after value as one short line. */
export function valueText(value: unknown): string {
  if (value === undefined || value === null) return "none";
  if (typeof value === "string") return value === "" ? "empty" : value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.length === 0 ? "empty" : value.map((v) => valueText(v)).join(", ");
  try {
    return JSON.stringify(value);
  } catch {
    return "";
  }
}

export function changeCount(count: number): string {
  return `${count} ${count === 1 ? "change" : "changes"}`;
}
