// The Journey designer model (spec 2.12, 3.7; ARCH 7.7): stages, tasks with Assigned, Reviewer and Approver, the Automations that run when a record enters a stage, exit rules and time
// limits, and the stage mapping for moving in-flight records to a new version. Everything here is data in, data out; every edit returns a new list of stages, which the designer saves
// whole through journeys.design (so each edit is one version-checked write that can be undone by writing the previous list back).
import type { CapMap } from "../../../../../../generated/types.ts";

export type Journey = CapMap["journeys.get"]["out"]["journey"];
export type Stage = Journey["stages"][number];
export type Task = Stage["tasks"][number];
export type Ref = NonNullable<Task["reviewer"]>;
export type StartRule = NonNullable<Journey["startRule"]>;
export type TaskKind = NonNullable<Task["kind"]>;
export type Preview = CapMap["journeys.preview_migrate"]["out"];
export type StageCounts = CapMap["journeys.stage_counts"]["out"]["stages"];
export type Slot = "assigned" | "reviewer" | "approver";

export const SLOTS: readonly { key: Slot; label: string }[] = [{ key: "assigned", label: "Assigned" }, { key: "reviewer", label: "Reviewer" }, { key: "approver", label: "Approver" }];
export const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

/* ---------- words ---------- */

/** "now", "2 h", "1 d": how long after a record enters the stage a task is due. */
export function dueWords(hours: number | undefined): string {
  if (!hours) return "now";
  return hours % 24 === 0 ? `${hours / 24} d` : `${hours} h`;
}
export const DUE_CHOICES: readonly number[] = [0, 1, 2, 4, 8, 24, 48, 72, 168];

export function exitWords(exit: Stage["exit"]): string {
  return exit.manualOnly ? "Only when someone moves it" : exit.requireTasks ? "When every required task is done" : "When someone moves it, or tasks are done";
}
export const requiredCount = (s: Stage): number => s.tasks.filter((t) => t.required).length;
export const tasksWords = (s: Stage): string => `${s.tasks.length} (${requiredCount(s)} required)`;
export function limitWords(l: Stage["timeLimit"], name: (id: string) => string): string {
  if (!l) return "None";
  const h = l.hours % 24 === 0 ? plural(l.hours / 24, "day") : plural(l.hours, "hour");
  return l.escalateTo ? `${h}, then ${l.escalateTo.kind === "role" ? `the ${name(l.escalateTo.id)} role` : name(l.escalateTo.id)} is told` : h;
}
export const LIMIT_CHOICES: readonly number[] = [24, 48, 72, 168, 336];

export function startRuleWords(r: Journey["startRule"]): string {
  if (!r) return "Records are added by hand";
  return `${r.event}${r.enabled ? "" : " (off)"}`;
}

/** What a stage looks like in the funnel: the records in it, how many are over the limit. */
export function countOf(counts: StageCounts, key: string): { count: number; over: number } {
  const c = counts.find((x) => x.stage === key);
  return { count: c?.count ?? 0, over: c?.overLimit ?? 0 };
}
export const totalRecords = (counts: StageCounts): number => counts.reduce((n, c) => n + c.count, 0);
export const totalOver = (counts: StageCounts): number => counts.reduce((n, c) => n + c.overLimit, 0);

/* ---------- edits ---------- */

const renumber = (stages: readonly Stage[]): Stage[] => stages.map((s, i) => ({ ...s, order: i }));
export function uniqueKey(prefix: string, taken: readonly string[]): string {
  let n = taken.length + 1;
  while (taken.includes(`${prefix}${n}`)) n += 1;
  return `${prefix}${n}`;
}
const stageKeys = (stages: readonly Stage[]): string[] => stages.map((s) => s.key);
const taskKeys = (stages: readonly Stage[]): string[] => stages.flatMap((s) => s.tasks.map((t) => t.key));
const mapStage = (stages: readonly Stage[], key: string, f: (s: Stage) => Stage): Stage[] => stages.map((s) => (s.key === key ? f(s) : s));

export function addStage(stages: readonly Stage[], title: string): Stage[] {
  return renumber([...stages, { key: uniqueKey("stage", stageKeys(stages)), title, order: stages.length, exit: { requireTasks: true }, tasks: [], automations: [] }]);
}
export function renameStage(stages: readonly Stage[], key: string, title: string): Stage[] {
  return mapStage(stages, key, (s) => ({ ...s, title }));
}
export function removeStage(stages: readonly Stage[], key: string): Stage[] {
  return renumber(stages.filter((s) => s.key !== key));
}
export function moveStage(stages: readonly Stage[], key: string, to: number): Stage[] {
  const from = stages.findIndex((s) => s.key === key);
  if (from < 0) return [...stages];
  const rest = stages.filter((s) => s.key !== key);
  rest.splice(Math.max(0, Math.min(rest.length, to)), 0, stages[from]!);
  return renumber(rest);
}
export function setExit(stages: readonly Stage[], key: string, exit: Stage["exit"]): Stage[] {
  return mapStage(stages, key, (s) => ({ ...s, exit }));
}
export function setTimeLimit(stages: readonly Stage[], key: string, limit: Stage["timeLimit"] | null): Stage[] {
  return mapStage(stages, key, (s) => { const { timeLimit: _drop, ...rest } = s; return limit ? { ...rest, timeLimit: limit } : rest; });
}

export function addTask(stages: readonly Stage[], stageKey: string, title: string, assigned: Ref): Stage[] {
  const key = uniqueKey("task", taskKeys(stages));
  return mapStage(stages, stageKey, (s) => ({ ...s, tasks: [...s.tasks, { key, title, assigned, required: true }] }));
}
export function removeTask(stages: readonly Stage[], stageKey: string, taskKey: string): Stage[] {
  return mapStage(stages, stageKey, (s) => ({ ...s, tasks: s.tasks.filter((t) => t.key !== taskKey) }));
}
export function updateTask(stages: readonly Stage[], stageKey: string, taskKey: string, patch: Partial<Omit<Task, "key">>): Stage[] {
  return mapStage(stages, stageKey, (s) => ({ ...s, tasks: s.tasks.map((t) => (t.key === taskKey ? { ...t, ...patch } : t)) }));
}
/** Sets one of the three seats; Assigned always has someone, Reviewer and Approver can be cleared. A key set for an agent goes when no agent holds a seat. */
export function setSeat(stages: readonly Stage[], stageKey: string, taskKey: string, slot: Slot, who: Ref | null): Stage[] {
  return mapStage(stages, stageKey, (s) => ({
    ...s,
    tasks: s.tasks.map((t) => {
      if (t.key !== taskKey) return t;
      if (slot === "assigned") return who ? { ...t, assigned: who } : t;
      if (slot === "reviewer") { const { reviewer: _r, ...rest } = t; return who ? { ...rest, reviewer: who } : rest; }
      const { approver: _a, ...rest } = t;
      return who ? { ...rest, approver: who } : rest;
    }),
  }));
}
export function moveTask(stages: readonly Stage[], stageKey: string, taskKey: string, dir: -1 | 1): Stage[] {
  return mapStage(stages, stageKey, (s) => {
    const i = s.tasks.findIndex((t) => t.key === taskKey), j = i + dir;
    if (i < 0 || j < 0 || j >= s.tasks.length) return s;
    const tasks = [...s.tasks];
    [tasks[i], tasks[j]] = [tasks[j]!, tasks[i]!];
    return { ...s, tasks };
  });
}
export function addAutomation(stages: readonly Stage[], stageKey: string, automationId: string): Stage[] {
  return mapStage(stages, stageKey, (s) => (s.automations.includes(automationId) ? s : { ...s, automations: [...s.automations, automationId] }));
}
export function removeAutomation(stages: readonly Stage[], stageKey: string, automationId: string): Stage[] {
  return mapStage(stages, stageKey, (s) => ({ ...s, automations: s.automations.filter((a) => a !== automationId) }));
}

/** An agent holds a seat on the task, so it runs on a key. */
export const isAgent = (r: Ref | undefined): boolean => r?.kind === "agent";
export const agentSeats = (t: Task): { slot: Slot; ref: Ref }[] => {
  const out: { slot: Slot; ref: Ref }[] = [];
  for (const { key } of SLOTS) { const r = t[key]; if (r && r.kind === "agent") out.push({ slot: key, ref: r }); }
  return out;
};

/** A stage with records in it cannot be deleted. */
export const canDeleteStage = (counts: StageCounts, key: string): boolean => countOf(counts, key).count === 0;

/** Problems a design has before it is saved. */
export function designIssues(stages: readonly Stage[]): string[] {
  const out: string[] = [];
  if (stages.length === 0) out.push("A Journey needs at least one stage");
  const titles = new Set<string>();
  for (const s of stages) {
    const t = s.title.trim().toLowerCase();
    if (!t) out.push("A stage needs a name");
    else if (titles.has(t)) out.push(`Two stages are named ${s.title}`);
    titles.add(t);
    for (const k of s.tasks) if (!k.title.trim()) out.push(`A task in ${s.title} needs a name`);
  }
  return out;
}

/* ---------- migration (move in-flight records to a new version) ---------- */

export interface MoveRow { from: string; to: string | null; records: number }
export const unmappedMoves = (p: Preview): MoveRow[] => p.moves.filter((m) => m.to === null);
export function stageMapOf(p: Preview, overrides: Readonly<Record<string, string>>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of p.moves) { const to = overrides[m.from] ?? m.to; if (to) out[m.from] = to; }
  return out;
}
export const canMigrate = (p: Preview, map: Readonly<Record<string, string>>): boolean => p.blockers.length === 0 && p.moves.every((m) => map[m.from] !== undefined);
export function migrationLine(p: Preview): string {
  if (p.recordsAffected === 0) return "No records are in flight, so nothing moves.";
  return `${plural(p.recordsAffected, "record")} move from version ${p.fromVersion} to version ${p.toVersion}.`;
}

/* ---------- clearing an optional field of a task ---------- */

export type OptionalTaskField = "keyId" | "backupKeyId" | "dueAfterHours" | "description";
export function clearTaskField(stages: readonly Stage[], stageKey: string, taskKey: string, field: OptionalTaskField): Stage[] {
  return mapStage(stages, stageKey, (s) => ({
    ...s,
    tasks: s.tasks.map((t) => {
      if (t.key !== taskKey) return t;
      const copy: Task = { ...t };
      delete (copy as Partial<Task>)[field];
      return copy;
    }),
  }));
}

export const EXIT_RULES: readonly { id: "tasks" | "hand"; label: string; exit: Stage["exit"] }[] = [
  { id: "tasks", label: "When every required task is done", exit: { requireTasks: true } },
  { id: "hand", label: "Only when someone moves it", exit: { requireTasks: false, manualOnly: true } },
];
export const exitRuleId = (exit: Stage["exit"]): "tasks" | "hand" => (exit.manualOnly ? "hand" : "tasks");

/** The stage a task sits in and its position, for "Task in Intake". */
export function findTask(stages: readonly Stage[], stageKey: string, taskKey: string): { stage: Stage; task: Task; index: number } | null {
  const stage = stages.find((x) => x.key === stageKey);
  const index = stage ? stage.tasks.findIndex((t) => t.key === taskKey) : -1;
  return stage && index >= 0 ? { stage, task: stage.tasks[index]!, index } : null;
}

/** "Client onboarding" becomes "CO". */
export function initials(name: string): string {
  return (name.match(/\b[\p{L}\p{N}]/gu) ?? []).slice(0, 2).join("").toUpperCase();
}

/** Titles joined for a sentence ("Start, In progress, Done"). */
export const joinTitles = (items: readonly { title: string }[]): string => items.map((x) => x.title).join(", ");
export const joinNames = (ids: readonly string[], name: (id: string) => string): string => ids.map((id) => name(id)).join(", ");
/** Every Automation that runs on a stage, with the stage it runs on. */
export function automationsByStage(stages: readonly Stage[]): { id: string; stage: string }[] {
  return stages.flatMap((g) => g.automations.map((id) => ({ id, stage: g.title })));
}
export const agentNames = (t: Task, name: (id: string) => string): string => joinNames(agentSeats(t).map((a) => a.ref.id), name);
