// Using a stored connector: try one safe read, run an action for a step, poll a trigger, and take a webhook delivery.
// The key is filled by the Vault at send time and never returned. A reply is scrubbed before anyone reads it.
import { splitStepKey } from "../connector-def.ts";
import type { ActionDef, ConnectorDef, PollTrigger } from "../connector-def.ts";
import { proven, recordConnectorLevel, storedLevel } from "../connector-level.ts";
import type { LevelDb } from "../connector-level.ts";
import { advance, backoff, cursorQuery, FIRE_LIMIT, retryAfterMs } from "../connector-poll.ts";
import { missingParams, shapeOf } from "../connector-request.ts";
import { failFor, sendAction } from "../connector-send.ts";
import { getConnector, getHook, getPoll, hookSecretMatches, levelOfAction, levelOfTrigger, listConnectors, markDelivery, noteDelivery, savePoll } from "../connector-store.ts";
import type { ConnectorRow } from "../connector-store.ts";
import { itemsOf } from "../connector-poll.ts";
import { isAuthor } from "../connector-audience.ts";
import { allAutomations, me, raise } from "../projections.ts";
import type { AutoCtx } from "../projections.ts";
import { actionStepKey, triggerLevelKey } from "../connector-def.ts";

type In = Record<string, any>;   // eslint-disable-line @typescript-eslint/no-explicit-any

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isPerson = (ctx: AutoCtx): boolean => ctx.principal.kind === "person" && !ctx.actingFor;

function need(ctx: AutoCtx, app: string): ConnectorRow {
  const row = getConnector(ctx.db, app);
  if (!row) raise(ctx, "validation.not_found", "There is no connector with that name.", { reason: "no_connector" });
  return row;
}
function actionOf(ctx: AutoCtx, row: ConnectorRow, key: string): ActionDef {
  const a = row.def.actions.find((x) => x.key === key);
  if (!a) raise(ctx, "validation.not_found", `${row.def.app} has no action called ${key}.`, { reason: "no_action", actions: row.def.actions.map((x) => x.key) });
  return a;
}
function mayUse(ctx: AutoCtx, row: ConnectorRow): boolean {
  if (row.owner.id === me(ctx)) return true;
  return !!ctx.authorize && ctx.authorize({ perm: "connectors.manage", level: "use" }, { type: "space", id: ctx.space }).effect === "allow";
}

// ---- try one safe read of a stored action

/** Fields the trigger cannot find in a real reply, so the writer can fix them before the trigger is turned on. */
function triggerNotes(def: ConnectorDef, actionKey: string, reply: unknown): { notes: string[]; ready: string[] } {
  const notes: string[] = [];
  const ready: string[] = [];
  for (const t of def.triggers) {
    if (t.kind !== "poll" || t.action !== actionKey) continue;
    const items = itemsOf(reply, t);
    if (items === undefined) { notes.push(`${t.key}: no list at ${t.items === "" ? "the top of the reply" : t.items}.`); continue; }
    const probe = advance(t, { cursor: null, seen: [], primed: true, fails: 0, nextAt: 0 }, reply, 0);
    if ("error" in probe) { notes.push(`${t.key}: ${probe.error}`); continue; }
    if (items.length > 0 && probe.fresh.length === 0) { notes.push(`${t.key}: no item has ${t.idField}. Name the field that is each item's id.`); continue; }
    ready.push(t.key);
  }
  return { notes, ready };
}

export async function tryStored(ctx: AutoCtx, input: In): Promise<{ level: "tested" | "draft"; reason?: string; status?: number; shape?: unknown; notes?: string[] }> {
  const row = need(ctx, String(input.app));
  if (!mayUse(ctx, row)) raise(ctx, "permission.not_found", "That connector is not available.");
  const action = actionOf(ctx, row, String(input.action));
  const readMethod = action.method === "GET" || action.method === "HEAD";
  if (!(action.effect === "read" && (readMethod || action.markedSafe === true))) return { level: "draft", reason: "Only a read can be tried." };
  const values = isRecord(input.input) ? input.input : {};
  const missing = missingParams(action, values);
  if (missing.length > 0) return { level: "draft", reason: `Give a sample value for ${missing.join(", ")} in input.` };
  const sent = await sendAction(ctx, row, action, values, { person: isPerson(ctx), ...(typeof input.allowHost === "string" ? { allowHost: input.allowHost } : {}) });
  if (sent.status < 200 || sent.status > 299) {
    const reason = sent.status === 401 || sent.status === 403 ? `The app refused the key (${sent.status}). Check the key in the Vault.` : sent.status === 429 ? "The app is limiting requests (429). Try again later." : `The read did not succeed (${sent.status}).`;
    return { level: "draft", reason, status: sent.status };
  }
  const stepKey = actionStepKey(row.def.app, action.key);
  if (storedLevel(ctx.db, stepKey) !== "published") recordConnectorLevel(ctx.db as LevelDb, stepKey, "tested", ctx.now());
  const checked = triggerNotes(row.def, action.key, sent.reply);
  for (const key of checked.ready) {
    const lk = triggerLevelKey(row.def.app, key);
    if (storedLevel(ctx.db, lk) === "draft" || storedLevel(ctx.db, lk) === undefined) recordConnectorLevel(ctx.db as LevelDb, lk, "tested", ctx.now());
  }
  return { level: "tested", status: sent.status, shape: shapeOf(sent.reply), ...(checked.notes.length > 0 ? { notes: checked.notes } : {}) };
}

// ---- what a step needs to know, then the call

export async function connectorInfo(ctx: AutoCtx, input: In): Promise<unknown> {
  const parts = splitStepKey(String(input.key));
  const row = parts ? getConnector(ctx.db, parts.app) : undefined;
  const action = row ? row.def.actions.find((a) => a.key === parts!.action) : undefined;
  if (!row || !action) return { found: false };
  if (levelOfAction(ctx.db, row.def.app, action.key) !== "published" && !isAuthor(ctx, row)) return { found: false };
  return { found: true, app: row.def.app, action: action.key, title: `${row.def.title}: ${action.title}`, effect: action.effect, level: levelOfAction(ctx.db, row.def.app, action.key) };
}

async function run(ctx: AutoCtx, input: In, want: "read" | "outward"): Promise<unknown> {
  const parts = splitStepKey(String(input.key));
  const row = parts ? getConnector(ctx.db, parts.app) : undefined;
  const action = row ? row.def.actions.find((a) => a.key === parts!.action) : undefined;
  if (!row || !action) raise(ctx, "validation.not_found", "There is no connector action with that key.", { reason: "no_action" });
  if (action.effect !== want) raise(ctx, "validation.precondition_failed", want === "read" ? `${action.key} changes something. Use automations.connector_send.` : `${action.key} only reads. Use automations.connector_read.`, { reason: "wrong_effect" });
  const level = levelOfAction(ctx.db, row.def.app, action.key);
  if (!proven(level)) raise(ctx, "validation.precondition_failed", `${row.def.title}: ${action.title} is a draft. Test it first.`, { reason: "draft" });
  if (level !== "published" && !isAuthor(ctx, row)) raise(ctx, "validation.precondition_failed", `${row.def.title}: ${action.title} is only tested. A person has to publish it before anyone else can use it.`, { reason: "not_published" });
  const values = isRecord(input.input) ? { ...input.input } : {};
  delete values["connectorLevel"];
  if (input.dryRun === true) return { output: null, status: 0, dryRun: true };
  // a tested action has been tried, so its host was allowed then; a run never allows a host by itself
  const sent = await sendAction(ctx, row, action, values, { person: false });
  if (sent.status < 200 || sent.status > 299) failFor(ctx, sent);
  return { output: sent.reply, status: sent.status, dryRun: false };
}
export const connectorRead = (ctx: AutoCtx, input: In): Promise<unknown> => run(ctx, input, "read");
export const connectorSend = (ctx: AutoCtx, input: In): Promise<unknown> => run(ctx, input, "outward");

// ---- polling

const ITEM_BYTES = 100_000;
/** An item is carried in an event, which many things read. A very large one is replaced by a marker that says so. */
function fitted(item: unknown): unknown {
  const text = JSON.stringify(item) ?? "null";
  return text.length <= ITEM_BYTES ? item : { truncated: true, bytes: text.length };
}

/** Triggers of a connector that an automation turned on is waiting for. */
function listened(ctx: AutoCtx): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const a of allAutomations(ctx.db, "status = 'on'")) {
    for (const t of a.definition.triggers) {
      if (t.key !== "app_event") continue;
      const cfg = t.config as { app?: unknown; trigger?: unknown } | undefined;
      if (typeof cfg?.app !== "string" || typeof cfg?.trigger !== "string") continue;
      const set = out.get(cfg.app) ?? new Set<string>();
      set.add(cfg.trigger);
      out.set(cfg.app, set);
    }
  }
  return out;
}

/** The polling triggers that are due: proven, listened to by a turned-on automation, and past their wait. */
export function pollDue(ctx: AutoCtx): { app: string; trigger: string; owner: { kind: string; id: string } }[] {
  const wanted = listened(ctx);
  const due: { app: string; trigger: string; owner: { kind: string; id: string } }[] = [];
  for (const row of listConnectors(ctx.db)) {
    for (const t of row.def.triggers) {
      if (t.kind !== "poll" || !wanted.get(row.def.app)?.has(t.key)) continue;
      if (!proven(levelOfTrigger(ctx.db, row.def.app, t.key))) continue;
      if (getPoll(ctx.db, row.def.app, t.key).nextAt > ctx.now()) continue;
      due.push({ app: row.def.app, trigger: t.key, owner: row.owner });
    }
  }
  return due;
}

function scrubError(e: unknown): string {
  const err = (e as { error?: { code?: string; message?: string } } | null)?.error;
  return (err?.message ?? (e as Error | null)?.message ?? "The read failed.").slice(0, 300);
}

export async function connectorPoll(ctx: AutoCtx, input: In): Promise<{ polled: boolean; fired: number; status?: number; reason?: string; nextAt?: number; more?: boolean }> {
  const row = need(ctx, String(input.app));
  if (!mayUse(ctx, row)) raise(ctx, "permission.not_found", "That connector is not available.");
  const trigger = row.def.triggers.find((t) => t.key === input.trigger);
  if (!trigger || trigger.kind !== "poll") raise(ctx, "validation.not_found", "That connector has no polling trigger with that name.", { reason: "no_trigger" });
  if (!proven(levelOfTrigger(ctx.db, row.def.app, trigger.key))) raise(ctx, "validation.precondition_failed", "Test this trigger's action first.", { reason: "draft" });
  const action = actionOf(ctx, row, trigger.action);
  const before = getPoll(ctx.db, row.def.app, trigger.key);
  const now = ctx.now();
  const query = cursorQuery(trigger as PollTrigger, before);
  let sent;
  try {
    sent = await sendAction(ctx, row, action, query, { person: false });
  } catch (e) {
    // A refusal by the host or the Vault is a failure of this pass. The wait grows, and the reason is kept for the connector page.
    const fails = before.fails + 1;
    const wait = backoff(trigger, fails);
    savePoll(ctx.db, row.def.app, trigger.key, { ...before, fails, nextAt: now + wait, lastAt: now, lastStatus: null, lastError: scrubError(e) });
    return { polled: false, fired: 0, reason: scrubError(e), nextAt: now + wait };
  }
  if (sent.status < 200 || sent.status > 299) {
    const fails = before.fails + 1;
    const wait = backoff(trigger, fails, sent.status === 429 ? retryAfterMs(sent.retryAfter, now) : undefined);
    const reason = sent.status === 401 || sent.status === 403 ? `The app refused the key (${sent.status}).` : sent.status === 429 ? "The app is limiting requests (429)." : `The app answered ${sent.status}.`;
    savePoll(ctx.db, row.def.app, trigger.key, { ...before, fails, nextAt: now + wait, lastAt: now, lastStatus: sent.status, lastError: reason });
    return { polled: false, fired: 0, status: sent.status, reason, nextAt: now + wait };
  }
  const next = advance(trigger, before, sent.reply, now);
  if ("error" in next) {
    const fails = before.fails + 1;
    const wait = backoff(trigger, fails);
    savePoll(ctx.db, row.def.app, trigger.key, { ...before, fails, nextAt: now + wait, lastAt: now, lastStatus: sent.status, lastError: next.error });
    return { polled: false, fired: 0, status: sent.status, reason: next.error, nextAt: now + wait };
  }
  for (const f of next.fresh.slice(0, FIRE_LIMIT)) {
    ctx.emit("app_event.received", `entity/${row.def.app}`, { app: row.def.app, trigger: trigger.key, itemId: f.id, item: fitted(f.item), source: "poll", at: now });
  }
  const nextAt = next.more ? now + 5_000 : next.state.nextAt;
  savePoll(ctx.db, row.def.app, trigger.key, { ...next.state, nextAt, lastAt: now, lastStatus: sent.status, lastError: null, fired: before.fired + next.fresh.length });
  return { polled: true, fired: next.fresh.length, status: sent.status, nextAt, ...(next.more ? { more: true } : {}) };
}

// ---- a webhook delivery

const DELIVERY = /^[A-Za-z0-9._:-]{1,200}$/;

/**
 * The inbound route asks this: does the address belong to a webhook trigger of a connector. Null is the one answer to every refusal.
 * A body that carries the trigger's id field is taken once; a repeat of the same id is dropped.
 */
export async function acceptAppHook(ctx: AutoCtx, input: { app?: unknown; trigger?: unknown; secret?: unknown; payload?: unknown; idempotencyKey?: unknown }): Promise<{ accepted: true; duplicate?: true } | null> {
  const app = typeof input.app === "string" ? input.app : "";
  const key = typeof input.trigger === "string" ? input.trigger : "";
  const secret = typeof input.secret === "string" ? input.secret : "";
  if (app === "" || key === "" || secret === "") return null;
  const row = getConnector(ctx.db, app);
  const trigger = row?.def.triggers.find((t) => t.key === key);
  if (!row || !trigger || trigger.kind !== "webhook" || !getHook(ctx.db, app, key)) return null;
  if (!hookSecretMatches(ctx.db, app, key, secret)) return null;
  const now = ctx.now();
  let id = typeof input.idempotencyKey === "string" && DELIVERY.test(input.idempotencyKey) ? input.idempotencyKey : "";
  if (trigger.idField && isRecord(input.payload)) {
    const raw = input.payload[trigger.idField];
    if (typeof raw === "string" || typeof raw === "number") id = String(raw);
  }
  if (id !== "" && !noteDelivery(ctx.db, app, key, id, now)) return { accepted: true, duplicate: true };
  markDelivery(ctx.db, app, key, now);
  const lk = triggerLevelKey(app, key);
  if (storedLevel(ctx.db, lk) !== "published") recordConnectorLevel(ctx.db as LevelDb, lk, "tested", now);
  ctx.emit("app_event.received", `entity/${app}`, { app, trigger: key, itemId: id === "" ? `hook-${now}` : id, item: fitted(input.payload ?? null), source: "webhook", at: now });
  return { accepted: true };
}
