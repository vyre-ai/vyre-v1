// What the step forms pick from, read out of the lists the place's own `call` returns: the Vault items that can hold a request key (names and handles, never values), the person's agents, and the
// people and groups a reviewer can be. Pure functions, so each shape is tested without a screen.
import type { Assignee } from "./edits.ts";

export interface VaultPick { id: string; name: string; handle: string; fieldKeys: string[]; kind: string }
export interface AgentPick { id: string; name: string }
export interface WhoPick { assignee: Assignee; name: string }

const rec = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const text = (v: unknown): string => (typeof v === "string" ? v : "");

export function vaultPicks(out: unknown): VaultPick[] {
  const items = rec(out) && Array.isArray(out["items"]) ? out["items"] : [];
  const picks: VaultPick[] = [];
  for (const raw of items) {
    if (!rec(raw) || text(raw["handle"]) === "" || text(raw["name"]) === "") continue;
    const kind = text(raw["kind"]);
    if (kind === "ai_subscription" || kind === "card" || kind === "ssh_key" || kind === "totp") continue;   // not a request key
    picks.push({ id: text(raw["id"]), name: text(raw["name"]), handle: text(raw["handle"]), fieldKeys: Array.isArray(raw["fieldKeys"]) ? raw["fieldKeys"].filter((k): k is string => typeof k === "string") : [], kind });
  }
  return picks;
}

export function agentPicks(out: unknown): AgentPick[] {
  const rows = rec(out) && Array.isArray(out["agents"]) ? out["agents"] : [];
  const picks: AgentPick[] = [];
  for (const raw of rows) if (rec(raw) && text(raw["agentId"]) !== "") picks.push({ id: text(raw["agentId"]), name: text(raw["name"]) || text(raw["agentId"]) });
  return picks;
}

export function whoPicks(people: unknown, groups: unknown): WhoPick[] {
  const out: WhoPick[] = [];
  const rows = rec(people) && Array.isArray(people["principals"]) ? people["principals"] : [];
  for (const raw of rows) if (rec(raw) && text(raw["kind"]) === "person" && text(raw["id"]) !== "") out.push({ assignee: { kind: "person", id: text(raw["id"]) }, name: text(raw["name"]) || text(raw["id"]) });
  const gs = rec(groups) && Array.isArray(groups["groups"]) ? groups["groups"] : [];
  for (const raw of gs) {
    const id = rec(raw) ? text(raw["groupId"]) || text(raw["id"]) : "";
    if (rec(raw) && id !== "") out.push({ assignee: { kind: "group", id }, name: `${text(raw["name"]) || id} (group)` });
  }
  return out;
}

