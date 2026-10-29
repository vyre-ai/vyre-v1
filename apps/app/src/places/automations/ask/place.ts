// A document's actions become new connector steps. A webhook draft is one catalog trigger.
// Nothing runs, and a secret is not copied onto the definition or into a sentence.

import { addAfter, addTrigger, updateStep } from "../canvas/model.ts";
import type { Definition } from "../canvas/model.ts";
import type { AccountOption } from "../connect/accounts.ts";

export interface TriggerOffer {
  key: "webhook";
  check: "hold";
  say: "A webhook stays off until you run it.";
}

const WEBHOOK_SAY = "A webhook stays off until you run it.";
const NO_STEP = "There is no step to add.";
const NEED_CONNECTION = "Link a connection before adding this step.";
const ACTION_SECRET = /secret|authorization|cookie|password|token|api[-_]?key|credential/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function webhookOffer(): TriggerOffer {
  return { key: "webhook", check: "hold", say: WEBHOOK_SAY };
}

/** A draft row is a non-null object with a string key and check "dry_run" or "hold". */
function validTrigger(row: unknown): boolean {
  if (!isRecord(row)) return false;
  if (typeof row.key !== "string") return false;
  return row.check === "dry_run" || row.check === "hold";
}

function keptAction(action: string): boolean {
  return action.length > 0 && !ACTION_SECRET.test(action);
}

function cursorOf(def: Definition, startId: string | null): string | null {
  if (startId !== null && def.nodes.some((node) => node.id === startId)) return startId;
  return def.nodes[def.nodes.length - 1]?.id ?? null;
}

function stepInput(account: AccountOption, action: string): Record<string, unknown> {
  if (account.app === "mail") return { mailboxId: account.id };
  return { connectionId: account.id, action };
}

function cloneDef(def: Definition): Definition {
  return JSON.parse(JSON.stringify(def)) as Definition;
}

/** True only for a read. An outward call is not offered a try. */
export function showTry(effect: "read" | "outward" | null | undefined): boolean {
  return effect === "read";
}

/** One webhook offer when a draft lists any trigger. Path, method, and url are not copied. */
export function triggersFrom(out: unknown): TriggerOffer[] {
  if (!isRecord(out)) return [];
  const setup = out.setup;
  if (!isRecord(setup) || !Array.isArray(setup.triggers)) return [];
  return setup.triggers.some((row) => validTrigger(row)) ? [webhookOffer()] : [];
}

/** Each kept action is a new connector_request. An existing node is never rewritten. */
export function placeSteps(def: Definition, items: readonly { action: string }[], account: AccountOption, startId: string | null): { def: Definition; nodeIds: string[] } | { error: string } {
  if (items.length === 0) return { error: NO_STEP };
  if (account.id.length === 0) return { error: NEED_CONNECTION };
  const actions = items.map((item) => item.action).filter(keptAction);
  if (actions.length === 0) return { error: NO_STEP };
  let next = def;
  let cursor = cursorOf(def, startId);
  const nodeIds: string[] = [];
  for (const action of actions) {
    const added = addAfter(next, cursor, "connector_request");
    next = updateStep(added.def, added.id, { input: stepInput(account, action) });
    cursor = added.id;
    nodeIds.push(added.id);
  }
  return { def: next, nodeIds };
}

/** The catalog webhook trigger, at most once. No url is written. */
export function placeWebhook(def: Definition): Definition {
  if (def.triggers.some((trigger) => trigger.key === "webhook")) return cloneDef(def);
  return addTrigger(def, "webhook");
}
