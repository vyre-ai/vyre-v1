// Automation config (spec 3.7, 2.12): the pure parts of the Settings, Alerts and Runs pane and of the Promote sheet. Alerts are the contract's own shape (who, when, where, an escalation
// chain); this file turns one into the sentence at the top of the Alerts tab and makes the edits a person makes, each returning a new value so the pane can save as it goes and offer Undo.
import type { CapMap } from "../../../../../../generated/types.ts";

export type Automation = CapMap["automations.get"]["out"]["automation"];
export type Alerts = Automation["alerts"];
export type Subject = Alerts["who"][number];
export type Step = Alerts["escalation"][number];
export type PromoteDiff = CapMap["automations.preview_promote"]["out"];
export type Diff = PromoteDiff["diff"];

export const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

/* ---------- alerts ---------- */

export const FAILURES_IN_A_ROW: readonly number[] = [2, 3, 5, 10];
export const ESCALATE_AFTER_HOURS: readonly number[] = [1, 2, 4, 8, 24, 48];
export const MAX_ESCALATION_STEPS = 5;

export const hoursWords = (h: number): string => (h % 24 === 0 && h >= 24 ? plural(h / 24, "day") : plural(h, "hour"));

export const subjectKey = (s: Subject): string => `${s.kind}:${s.id}`;

/** "Maya Chen", "Maya Chen and Omar Haddad", "Maya Chen, Omar Haddad and the Ops leads role". */
export function whoWords(who: readonly Subject[], name: (id: string) => string, me?: string): string {
  const parts = who.map((s) => (s.kind === "role" ? `the ${name(s.id)} role` : s.kind === "group" ? `the ${name(s.id)} group` : s.id === me ? "you" : name(s.id)));
  if (parts.length === 0) return "nobody";
  if (parts.length === 1) return parts[0]!;
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]!}`;
}

export function whereWords(where: Alerts["where"], channelName: (id: string) => string): string {
  const parts: string[] = [];
  if (where.needsYou) parts.push("Needs you");
  if (where.dm) parts.push("a direct message");
  if (where.channelId) parts.push(channelName(where.channelId));
  return parts.length ? parts.join(" and ") : "nowhere";
}

export function whenWords(when: Alerts["when"]): string {
  return when.mode === "every" ? "on every failure" : `after ${when.n ?? 2} failures in a row`;
}

/** The one sentence the Alerts tab opens with. A Personal Automation tells only its owner. */
export function alertSentence(a: Pick<Automation, "kind" | "ownerId" | "alerts">, name: (id: string) => string, channelName: (id: string) => string, me?: string): string {
  const who = a.kind === "personal" ? (a.ownerId === me ? "you" : name(a.ownerId)) : whoWords(a.alerts.who, name, me);
  return `Tells ${who} ${whenWords(a.alerts.when)}, in ${whereWords(a.alerts.where, channelName)}.`;
}

export function escalationWords(step: Step, name: (id: string) => string): string {
  const to = step.to.kind === "role" ? `the ${name(step.to.id)} role` : step.to.kind === "group" ? `the ${name(step.to.id)} group` : name(step.to.id);
  return `After ${hoursWords(step.afterHours)}, ${to} is told as well`;
}

export const addWho = (a: Alerts, s: Subject): Alerts => (a.who.some((x) => subjectKey(x) === subjectKey(s)) ? a : { ...a, who: [...a.who, s] });
export const removeWho = (a: Alerts, s: Subject): Alerts => ({ ...a, who: a.who.filter((x) => subjectKey(x) !== subjectKey(s)) });
export const setWhen = (a: Alerts, mode: "every" | "after_n", n?: number): Alerts => ({ ...a, when: mode === "every" ? { mode } : { mode, n: n ?? a.when.n ?? 2 } });
export const setWhere = (a: Alerts, patch: Partial<Alerts["where"]>): Alerts => {
  const next = { ...a.where, ...patch };
  if (next.channelId === undefined) delete (next as { channelId?: string }).channelId;
  return { ...a, where: next };
};
/** The channel switch: on picks the first channel offered, off clears it. */
export const withoutChannel = (a: Alerts): Alerts => { const w = { ...a.where }; delete (w as { channelId?: string }).channelId; return { ...a, where: w }; };
export const addStep = (a: Alerts, to: Subject, afterHours: number): Alerts =>
  a.escalation.length >= MAX_ESCALATION_STEPS ? a : { ...a, escalation: [...a.escalation, { to, afterHours }].sort((x, y) => x.afterHours - y.afterHours) };
export const removeStep = (a: Alerts, i: number): Alerts => ({ ...a, escalation: a.escalation.filter((_, n) => n !== i) });
export const setStepHours = (a: Alerts, i: number, afterHours: number): Alerts => ({ ...a, escalation: a.escalation.map((s, n) => (n === i ? { ...s, afterHours } : s)).sort((x, y) => x.afterHours - y.afterHours) });
export const setStepTo = (a: Alerts, i: number, to: Subject): Alerts => ({ ...a, escalation: a.escalation.map((s, n) => (n === i ? { ...s, to } : s)) });

/** The hours a new step starts at: one level past the last, so a chain reads in order. */
export function nextStepHours(a: Alerts): number {
  const last = a.escalation[a.escalation.length - 1]?.afterHours ?? 0;
  return ESCALATE_AFTER_HOURS.find((h) => h > last) ?? ESCALATE_AFTER_HOURS[ESCALATE_AFTER_HOURS.length - 1]!;
}

/* ---------- scope ---------- */

export const scopeLine = (a: Pick<Automation, "kind" | "ownerId">, name: (id: string) => string, me: string): string =>
  a.kind === "personal" ? (a.ownerId === me ? "Personal, only you" : `Personal, shared by ${name(a.ownerId)}`) : `Space, owned by ${name(a.ownerId)}`;

/** The AI steps of a definition with the key each one runs on, for "Runs on access given to it". */
export function aiKeys(def: Automation["definition"], name: (id: string) => string): { nodeId: string; title: string; agent: string; key: string; backup: string | null }[] {
  const out: { nodeId: string; title: string; agent: string; key: string; backup: string | null }[] = [];
  for (const n of def.nodes) {
    if (!n.ai) continue;
    out.push({ nodeId: n.id, title: n.title ?? n.key, agent: n.ai.agentId ? name(n.ai.agentId) : "An agent", key: n.ai.keyId ? name(n.ai.keyId) : "No key set", backup: n.ai.backupKeyId ? name(n.ai.backupKeyId) : null });
  }
  return out;
}

export const hasWebhook = (def: Automation["definition"]): boolean => def.triggers.some((t) => t.key === "webhook");

/* ---------- the Promote sheet (access diff, key replacement) ---------- */

export const LEVEL_WORDS: Readonly<Record<Diff["grants"][number]["level"], string>> = { view: "View", use: "Use", edit: "Edit", manage: "Manage" };
export const VIA_WORDS: Readonly<Record<Diff["grants"][number]["via"], string>> = { owner_access: "Taken from your access", role: "Through a role", new_grant: "A new grant to the Automation" };

export interface Choice { stepId: string; keyId: string }
/** One replacement per step that needs one; a step with no choice yet keeps the key the server suggested only when it is not a subscription. */
export function initialChoices(diff: Diff, keys: readonly { id: string; kind: "subscription" | "api" }[]): Choice[] {
  return diff.keysToReplace.map((k) => ({ stepId: k.stepId, keyId: keys.find((x) => x.kind === "api" && x.id !== k.keyId)?.id ?? "" }));
}
export const choiceFor = (choices: readonly Choice[], stepId: string): string => choices.find((c) => c.stepId === stepId)?.keyId ?? "";
export const setChoice = (choices: readonly Choice[], stepId: string, keyId: string): Choice[] => choices.map((c) => (c.stepId === stepId ? { stepId, keyId } : c));
/** Promote is allowed once the server says it is ready and every step that needs a shared key has one that is an API key. */
export function canPromote(p: PromoteDiff, choices: readonly Choice[], keys: readonly { id: string; kind: "subscription" | "api" }[]): boolean {
  if (!p.ready && p.diff.keysToReplace.length === 0) return false;
  return p.diff.keysToReplace.every((k) => { const c = choiceFor(choices, k.stepId); return c !== "" && keys.find((x) => x.id === c)?.kind === "api"; });
}
export const promoteInput = (automationId: string, ownerId: string, choices: readonly Choice[]): { automationId: string; confirm: true; ownerId: string; replaceKeys: Choice[] } => ({ automationId, confirm: true, ownerId, replaceKeys: choices.filter((c) => c.keyId !== "") });
