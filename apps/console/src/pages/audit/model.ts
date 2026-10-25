// Audit log model: the six event classes, the text of a row, and the state a filter writes into the screen query (generated/screens.ts audit.log: /state/class, /state/query, /state/traceId).
import type { CapMap } from "../../../../../generated/types.ts";
import { actionPhrase } from "../../shell/format.ts";

export type AuditRow = CapMap["audit.list"]["out"]["rows"][number];
export type AuditClass = AuditRow["class"];

export const CLASSES: readonly { id: AuditClass; label: string; icon: string }[] = [
  { id: "admin", label: "Admin actions", icon: "gear" },
  { id: "change", label: "Changes", icon: "data" },
  { id: "sensitive", label: "Sensitive reads", icon: "eye" },
  { id: "deny", label: "Denied", icon: "lock" },
  { id: "erase", label: "Erasures", icon: "x" },
  { id: "sign_in", label: "Sign-ins", icon: "key" },
];

export function classLabel(c: AuditClass): string {
  return CLASSES.find((x) => x.id === c)?.label ?? c;
}
export function classIcon(c: AuditClass): string {
  return CLASSES.find((x) => x.id === c)?.icon ?? "audit";
}

export interface AuditFilter {
  query: string;
  cls: AuditClass | null;
  traceId: string | null;
}
export const NO_FILTER: AuditFilter = { query: "", cls: null, traceId: null };

/** The screen state: only the keys that are set, so a cleared filter is the unfiltered query. */
export function stateOf(f: AuditFilter): Record<string, unknown> {
  return { ...(f.query.trim() ? { query: f.query.trim() } : {}), ...(f.cls ? { class: f.cls } : {}), ...(f.traceId ? { traceId: f.traceId } : {}) };
}
export function isFiltered(f: AuditFilter): boolean {
  return f.query.trim() !== "" || f.cls !== null || f.traceId !== null;
}

/** "Priya Raman changed role Omar, for Andrey": the actor, the act, what it touched, and on whose behalf. */
export function rowTitle(r: AuditRow, name: (id: string) => string): string {
  const behalf = r.onBehalfOf ? `, for ${name(r.onBehalfOf.id)}` : "";
  return `${name(r.actor.id)} ${actionPhrase(r.action)}${r.resource ? ` ${name(r.resource.id)}` : ""}${behalf}`;
}

/** The value of a before or after snapshot as readable lines; secret values are never in the log (CONSOLE-SPEC 1). */
export function snapshotLines(v: unknown): string[] {
  if (v === undefined) return [];
  if (v === null || typeof v !== "object") return [String(v)];
  return Object.entries(v as Record<string, unknown>).map(([k, x]) => `${k}: ${typeof x === "object" && x !== null ? JSON.stringify(x) : String(x)}`);
}
