// What the step forms pick from, read out of the lists the place's own `call` returns: the Vault items that can hold a request key (names and handles, never values), the person's agents, and the
// people and groups a reviewer can be. Pure functions, so each shape is tested without a screen.
import type { Assignee } from "./edits.ts";

export interface VaultPick {
  id: string;
  name: string;
  handle: string;
  fieldKeys: string[];
  kind: string;
}
export interface AgentPick {
  id: string;
  name: string;
  kind?: string;
  ownerId?: string;
  runtime?: string;
}
export interface WhoPick {
  assignee: Assignee;
  name: string;
}

export const rec = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
export const text = (v: unknown): string => (typeof v === "string" ? v : "");

export function vaultPicks(out: unknown): VaultPick[] {
  const items = rec(out) && Array.isArray(out["items"]) ? out["items"] : [];
  const picks: VaultPick[] = [];
  for (const raw of items) {
    if (!rec(raw) || text(raw["handle"]) === "" || text(raw["name"]) === "") continue;
    const kind = text(raw["kind"]);
    if (kind === "ai_subscription" || kind === "card" || kind === "ssh_key" || kind === "totp") continue; // not a request key
    picks.push({
      id: text(raw["id"]),
      name: text(raw["name"]),
      handle: text(raw["handle"]),
      fieldKeys: Array.isArray(raw["fieldKeys"])
        ? raw["fieldKeys"].filter((k): k is string => typeof k === "string")
        : [],
      kind,
    });
  }
  return picks;
}

export function agentPicks(out: unknown): AgentPick[] {
  const rows = rec(out) && Array.isArray(out["agents"]) ? out["agents"] : [];
  const picks: AgentPick[] = [];
  for (const raw of rows)
    if (rec(raw) && text(raw["agentId"]) !== "")
      picks.push({
        id: text(raw["agentId"]),
        name: text(raw["name"]) || text(raw["agentId"]),
        ...(text(raw["kind"]) ? { kind: text(raw["kind"]) } : {}),
        ...(text(raw["ownerId"]) ? { ownerId: text(raw["ownerId"]) } : {}),
        ...(text(raw["runtime"]) ? { runtime: text(raw["runtime"]) } : {}),
      });
  return picks;
}

/**
 * The agents a task step may hand work to, as the server decides it (reason agent_not_yours): an Assistant or an agent on someone's own computer (runtime "outside") is never offered in a Space
 * Automation, and in a Personal one only when it is the owner's own. The server also refuses an agent the saver cannot give work to, with its own line.
 */
export function taskAgents(
  list: readonly AgentPick[],
  automationKind: "space" | "personal",
  ownerId: string,
): AgentPick[] {
  return list.filter(
    (a) =>
      (a.kind !== "assistant" && a.runtime !== "outside") || (automationKind === "personal" && a.ownerId === ownerId),
  );
}

export function whoPicks(people: unknown, groups: unknown): WhoPick[] {
  const out: WhoPick[] = [];
  const rows = rec(people) && Array.isArray(people["principals"]) ? people["principals"] : [];
  for (const raw of rows)
    if (rec(raw) && text(raw["kind"]) === "person" && text(raw["id"]) !== "")
      out.push({ assignee: { kind: "person", id: text(raw["id"]) }, name: text(raw["name"]) || text(raw["id"]) });
  const gs = rec(groups) && Array.isArray(groups["groups"]) ? groups["groups"] : [];
  for (const raw of gs) {
    const id = rec(raw) ? text(raw["groupId"]) || text(raw["id"]) : "";
    if (rec(raw) && id !== "")
      out.push({ assignee: { kind: "group", id }, name: `${text(raw["name"]) || id} (group)` });
  }
  return out;
}

export interface RefPick {
  value: string;
  label: string;
}

/** Record types, forms and Journeys a trigger can be narrowed to, as value and name. */
export function refPicks(kind: "types" | "forms" | "journeys", out: unknown): RefPick[] {
  const key = kind === "types" ? "types" : kind;
  const rows = rec(out) && Array.isArray(out[key]) ? out[key] : [];
  const picks: RefPick[] = [];
  for (const raw of rows) {
    if (!rec(raw)) continue;
    const value = kind === "types" ? text(raw["key"]) : kind === "forms" ? text(raw["formId"]) : text(raw["id"]);
    const label = kind === "types" ? text(raw["title"]) : text(raw["name"]);
    if (value !== "") picks.push({ value, label: label || value });
  }
  return picks;
}

/** The things a field can hold the id of, by the id's prefix: which list to ask, and which row field is the id and which the name. Never shown as ids. */
export interface ThingKind {
  cap: string;
  input: Record<string, unknown>;
  /** The step's own settings the list needs before it can be asked (a record's type). */
  needs?: string;
  key: string;
  ids: string[];
  names: string[];
  word: string;
}
export const THINGS: Record<string, ThingKind> = {
  chn: {
    cap: "channels.list",
    input: { limit: 200 },
    key: "channels",
    ids: ["id", "channelId"],
    names: ["name", "title"],
    word: "channel",
  },
  mbx: {
    cap: "mail.mailbox.list",
    input: { limit: 200 },
    key: "mailboxes",
    ids: ["id", "mailboxId"],
    names: ["address", "name"],
    word: "mailbox",
  },
  agt: { cap: "agents.list", input: {}, key: "agents", ids: ["agentId", "id"], names: ["name"], word: "agent" },
  aut: { cap: "automations.list", input: {}, key: "automations", ids: ["id"], names: ["name"], word: "automation" },
  jrn: { cap: "journeys.list", input: {}, key: "journeys", ids: ["id"], names: ["name"], word: "journey" },
  frm: {
    cap: "forms.list",
    input: { limit: 200 },
    key: "forms",
    ids: ["formId", "id"],
    names: ["name", "title"],
    word: "form",
  },
  fil: {
    cap: "files.list",
    input: { section: "space", deep: true, limit: 200 },
    key: "files",
    ids: ["fileId", "id"],
    names: ["name"],
    word: "file",
  },
  fld: {
    cap: "files.list",
    input: { section: "space", limit: 200 },
    key: "folders",
    ids: ["id", "folderId"],
    names: ["name"],
    word: "folder",
  },
  con: {
    cap: "connections.list",
    input: { whose: "all", limit: 200 },
    key: "connections",
    ids: ["connectionId", "id"],
    names: ["title"],
    word: "connection",
  },
  rec: {
    cap: "records.search",
    input: { q: "", limit: 200 },
    needs: "type",
    key: "rows",
    ids: ["id"],
    names: ["fields.name", "fields.title", "fields.full_name", "fields.email"],
    word: "record",
  },
};
export interface ThingPick {
  value: string;
  label: string;
}
export function thingPicks(kind: ThingKind, out: unknown): ThingPick[] {
  const rows = rec(out) && Array.isArray(out[kind.key]) ? (out[kind.key] as unknown[]) : [];
  const picks: ThingPick[] = [];
  for (const raw of rows) {
    if (!rec(raw)) continue;
    const at = (k: string): string =>
      text(k.split(".").reduce<unknown>((o, part) => (rec(o) ? o[part] : undefined), raw));
    const value = kind.ids.map(at).find((v) => v !== "") ?? "";
    const label = kind.names.map(at).find((v) => v !== "") ?? "";
    if (value !== "" && label !== "") picks.push({ value, label });
  }
  return picks;
}
/** What to ask the list with: its own input and, for a record, the type the step already names. Null when the step does not name it yet. */
export function thingInput(kind: ThingKind, step: Record<string, unknown>): Record<string, unknown> | null {
  if (!kind.needs) return kind.input;
  const v = step[kind.needs];
  return typeof v === "string" && v !== "" && !/\{\{/.test(v) ? { [kind.needs]: v, ...kind.input } : null;
}
