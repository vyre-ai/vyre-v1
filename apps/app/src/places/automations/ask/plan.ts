// Ask on an Automation. Reuses the account list, the catalog, Vault's field names, and the scrubber.
// A pasted value is only placed on the vault.item.put input. It is not placed on a line, a bundle, or a connection id.

import { addAfter, updateStep } from "../canvas/model.ts";
import type { Definition } from "../canvas/model.ts";
import { applyAccount } from "../connect/accounts.ts";
import type { AccountField, AccountOption } from "../connect/accounts.ts";
import { normalizeKey } from "../../vault/itemenv/env.ts";
import { scrubAskContext } from "./bundle.ts";

export interface AskStep {
  key: string;
  title: string;
}

export interface PasteSlot {
  key: string;
  label: string;
  secret: boolean;
  hint: string;
}

export type AskTurn =
  | { kind: "use"; app: string; account: AccountOption; stepKey: string | null; action: string | null; say: string }
  | { kind: "choose"; app: string; accounts: AccountOption[]; stepKey: string | null; action: string | null; say: string }
  | { kind: "sign_in"; app: string; service: string; stepKey: string | null; say: string }
  | { kind: "paste"; app: string; slots: PasteSlot[]; stepKey: string | null; action: string | null; say: string }
  | { kind: "need_doc"; app: string; say: string };

export interface AskLine {
  who: "you" | "vyre";
  say: string;
}

const UNUSABLE = new Set(["paused", "pending", "needs_reconnect"]);
const OAUTH = new Set(["google", "ms", "github", "mail"]);
const SKIP = new Set(["want", "this", "that", "with", "from", "when", "then", "step", "automation", "please", "make", "into", "your", "have", "does", "done", "what", "need", "document", "openapi", "already", "paste", "connection", "vault", "catalog", "address", "website"]);
const LOOSE = new Set([...SKIP, "list", "send", "read", "create", "message", "messages", "email", "customer"]);

const APP_WORDS: readonly { app: string; words: readonly string[] }[] = [
  { app: "google", words: ["google", "gmail"] },
  { app: "ms", words: ["microsoft", "outlook", "onedrive", "sharepoint"] },
  { app: "github", words: ["github"] },
  { app: "mail", words: ["mailbox"] },
];

const SECRET_HINT = "Paste this into Vault. Ask Vyre does not see the value.";
const PLAIN_HINT = "Paste this value. It is not a secret.";

function wordsOf(text: string): string[] {
  return text.toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length >= 3);
}

export function namedApp(text: string, accounts: readonly AccountOption[]): string {
  const words = new Set(wordsOf(text));
  for (const row of APP_WORDS) {
    if (row.words.some((word) => words.has(word))) return row.app;
  }
  const hay = text.toLowerCase();
  let found = "";
  for (const account of accounts) {
    const title = account.title.toLowerCase();
    if (title.length >= 3 && hay.includes(title) && title.length > found.length) found = account.app;
  }
  if (found) return found;
  for (const account of accounts) {
    if (words.has(account.app.toLowerCase())) return account.app;
  }
  const loose = wordsOf(text).find((word) => word.length >= 4 && !LOOSE.has(word));
  return loose ?? "";
}

export function stepMatches(key: string, app: string): boolean {
  if (!app) return false;
  if (app === "mail") return key === "send_email" || key.startsWith("mail.");
  if (app === "ms" || app === "microsoft") return key.startsWith("ms.");
  return key.startsWith(`${app}.`);
}

function usableAccounts(accounts: readonly AccountOption[], app: string): AccountOption[] {
  const apps = app === "ms" ? new Set(["ms", "microsoft"]) : new Set([app]);
  return accounts.filter((account) => apps.has(account.app) && !UNUSABLE.has(account.state));
}

export function pickStep(text: string, app: string, steps: readonly AskStep[], action: string | null): string | null {
  const words = wordsOf(text).filter((word) => !SKIP.has(word));
  let best: { key: string; score: number } | null = null;
  for (const step of steps) {
    if (app && !stepMatches(step.key, app)) continue;
    const hay = `${step.key} ${step.title}`.toLowerCase();
    let score = 0;
    for (const word of words) if (hay.includes(word)) score += 1;
    if (score > 0 && (!best || score > best.score)) best = { key: step.key, score };
  }
  if (best) return best.key;
  if (action && steps.some((step) => step.key === "connector_request")) return "connector_request";
  return null;
}

function stepTitle(steps: readonly AskStep[], key: string | null): string {
  if (!key) return "the selected step";
  return steps.find((step) => step.key === key)?.title ?? key;
}

export function vaultFieldKey(name: string, used: ReadonlySet<string>): string {
  const base = normalizeKey(name) || "FIELD";
  let key = base;
  let n = 2;
  while (used.has(key)) {
    key = `${base}_${n}`;
    n += 1;
  }
  return /^[A-Za-z][A-Za-z0-9_]*$/.test(key) ? key : "FIELD";
}

export function slotsFrom(fields: readonly { name: string; secret: boolean }[]): PasteSlot[] {
  const used = new Set<string>();
  const slots: PasteSlot[] = [];
  for (const field of fields) {
    const label = field.name.trim();
    if (!label) continue;
    const key = vaultFieldKey(label, used);
    used.add(key);
    slots.push({ key, label, secret: field.secret, hint: field.secret ? SECRET_HINT : PLAIN_HINT });
  }
  return slots;
}

export function planAsk(input: {
  text: string;
  accounts: readonly AccountOption[];
  steps: readonly AskStep[];
  fields?: readonly { name: string; secret: boolean }[];
  action?: string | null;
}): AskTurn {
  const app = namedApp(input.text, input.accounts);
  const action = input.action ?? null;
  const stepKey = pickStep(input.text, app, input.steps, action);
  const where = stepTitle(input.steps, stepKey);
  const usable = app ? usableAccounts(input.accounts, app) : [];
  if (!app && !(input.fields && input.fields.length > 0)) {
    return { kind: "need_doc", app: "", say: "Name the app and what the step should do." };
  }
  if (usable.length === 1) {
    const account = usable[0]!;
    return { kind: "use", app, account, stepKey, action, say: `Vault already has ${account.title}. It can go on ${where}.` };
  }
  if (usable.length > 1) {
    const titles = usable.map((account) => account.title).join(", ");
    return { kind: "choose", app, accounts: usable, stepKey, action, say: `Vault has ${titles}. Pick one for ${where}.` };
  }
  if (input.fields && input.fields.length > 0) {
    const slots = slotsFrom(input.fields);
    const labels = slots.map((slot) => slot.label).join(" and ");
    return {
      kind: "paste",
      app: app || "app",
      slots,
      stepKey,
      action,
      say: `Paste ${labels} into Vault. Ask Vyre does not see the values. The new item is linked to ${where}.`,
    };
  }
  if (OAUTH.has(app)) {
    const service = app === "ms" ? "microsoft" : app;
    return { kind: "sign_in", app, service, stepKey, say: `${service} has no connection in Vault yet. Sign in on the connection screen. Ask Vyre does not take the password here.` };
  }
  const named = app || "That app";
  return { kind: "need_doc", app, say: `${named} is not in the catalog. Paste the OpenAPI document you already have. A web address is not opened.` };
}

/** A line safe to keep on the tab and to hand to the Chats tab. Secret shapes are removed. */
export function publicLine(text: string): string {
  return scrubAskContext({ message: text }).message ?? "";
}

export function linesFor(text: string, turn: AskTurn): AskLine[] {
  return [
    { who: "you", say: publicLine(text) || "That line was left out." },
    { who: "vyre", say: turn.say },
  ];
}

export function savedLine(name: string, linked: boolean): string {
  return linked
    ? `Saved ${name} in Vault and linked it to the step. The values stayed in Vault.`
    : `Saved ${name} in Vault. The values stayed in Vault. There is no connection to put on a step yet.`;
}

export function vaultPutInput(spec: {
  folderId: string;
  app: string;
  slots: readonly PasteSlot[];
  values: Readonly<Record<string, string>>;
}): { put: { folderId: string; name: string; kind: "api_key"; fields: { key: string; value: string; secret: boolean }[] }; name: string } | { error: string } {
  const fields: { key: string; value: string; secret: boolean }[] = [];
  for (const slot of spec.slots) {
    const value = spec.values[slot.key] ?? "";
    if (slot.secret && value.trim() === "") return { error: `Paste ${slot.label}.` };
    if (value.trim() === "") continue;
    fields.push({ key: slot.key, value, secret: slot.secret });
  }
  if (fields.length === 0) return { error: "Paste a value into Vault." };
  const name = `${spec.app} connection`;
  return { put: { folderId: spec.folderId, name, kind: "api_key", fields }, name };
}

/** Handles only. The pasted values are already on the Vault item. */
export function connectionCreateInput(spec: { app: string; handle: string; slots: readonly PasteSlot[] }): { connector: string; title: string; ownerKind: "person"; secrets: Record<string, string> } {
  const secrets: Record<string, string> = {};
  for (const slot of spec.slots) if (slot.secret) secrets[slot.key] = spec.handle;
  if (Object.keys(secrets).length === 0) secrets.credential = spec.handle;
  return { connector: spec.app, title: `${spec.app} connection`, ownerKind: "person", secrets };
}

function rows(out: unknown, key: string): unknown[] {
  if (!out || typeof out !== "object" || Array.isArray(out)) return [];
  const value = (out as Record<string, unknown>)[key];
  return Array.isArray(value) ? value : [];
}

export function firstFolderId(out: unknown): string | null {
  for (const row of rows(out, "folders")) {
    if (!row || typeof row !== "object" || Array.isArray(row)) continue;
    const id = (row as { id?: unknown }).id;
    if (typeof id === "string" && id.length > 0) return id;
  }
  return null;
}

export function itemIdOf(out: unknown): string | null {
  if (!out || typeof out !== "object") return null;
  const item = (out as { item?: unknown }).item;
  if (!item || typeof item !== "object") return null;
  const id = (item as { id?: unknown }).id;
  return typeof id === "string" && id.length > 0 ? id : null;
}

export function handleOf(out: unknown): string | null {
  if (!out || typeof out !== "object") return null;
  const handle = (out as { handle?: unknown }).handle;
  return typeof handle === "string" && handle.length > 0 ? handle : null;
}

export function accountFromCreate(out: unknown, app: string): AccountOption | null {
  if (!out || typeof out !== "object") return null;
  const connection = (out as { connection?: unknown }).connection;
  if (!connection || typeof connection !== "object") return null;
  const row = connection as Record<string, unknown>;
  const id = typeof row.connectionId === "string" ? row.connectionId : "";
  if (!id) return null;
  return {
    app: typeof row.connector === "string" ? row.connector : app,
    id,
    title: typeof row.title === "string" ? row.title : id,
    state: typeof row.state === "string" ? row.state : "active",
  };
}

/** Names from a draft_connector result. Values, examples, and request bodies are not copied. */
export function setupShape(out: unknown): { fields: { name: string; secret: boolean }[]; actions: string[] } {
  const rec = out && typeof out === "object" ? out as Record<string, unknown> : {};
  const setup = rec.setup && typeof rec.setup === "object" ? rec.setup as { fields?: unknown } : {};
  const fields: { name: string; secret: boolean }[] = [];
  if (Array.isArray(setup.fields)) {
    for (const field of setup.fields) {
      if (!field || typeof field !== "object") continue;
      const name = (field as { name?: unknown }).name;
      if (typeof name !== "string" || name.trim() === "") continue;
      fields.push({ name, secret: (field as { secret?: unknown }).secret === true });
    }
  }
  const actions: string[] = [];
  if (Array.isArray(rec.actions)) {
    for (const action of rec.actions) {
      if (!action || typeof action !== "object") continue;
      const key = (action as { key?: unknown }).key;
      if (typeof key === "string" && key.length > 0) actions.push(key);
    }
  }
  return { fields, actions };
}

function asInput(input: unknown): Record<string, unknown> {
  return input && typeof input === "object" && !Array.isArray(input) ? { ...(input as Record<string, unknown>) } : {};
}

/** Write the account onto a matching step, or add the catalog step and write it there. */
export function linkAccount(def: Definition, spec: {
  account: AccountOption;
  stepKey: string | null;
  nodeId?: string | null;
  action?: string | null;
}): { def: Definition; nodeId: string } | { error: string } {
  const field: AccountField = spec.account.app === "mail" ? "mailboxId" : "connectionId";
  const selected = spec.nodeId ? def.nodes.find((node) => node.id === spec.nodeId) : undefined;
  const fits = selected !== undefined && (stepMatches(selected.key, spec.account.app) || selected.key === spec.stepKey || selected.key === "connector_request");
  let next = def;
  let nodeId = "";
  if (fits && selected) nodeId = selected.id;
  else if (spec.stepKey) {
    const after = selected ? selected.id : (def.nodes.length > 0 ? def.nodes[def.nodes.length - 1]!.id : null);
    const added = addAfter(next, after, spec.stepKey);
    next = added.def;
    nodeId = added.id;
  } else {
    return { error: "Select a step, or name one the catalog already has." };
  }
  const node = next.nodes.find((item) => item.id === nodeId);
  if (!node) return { error: "That step is not on this Automation." };
  let input = applyAccount(asInput(node.input), field, spec.account);
  if (spec.action && field === "connectionId") input = { ...input, action: spec.action };
  return { def: updateStep(next, nodeId, { input: input as typeof node.input }), nodeId };
}
