// Narrow the unknown snapshots that createScreenHooks returns. The screen index lives in screens.ts
// because apps may not import generated/. The capability shapes match manifests/home.ts and manifests/tasks.ts.

import type { FaceKind } from "./faces.ts";
import { isFaceKind } from "./faces.ts";

export const NEEDS_YOU_LIMIT = 3;
export const NEEDS_YOU_RANK = ["overdue", "blocking", "due_today", "ready"] as const;
export type NeedsReason = (typeof NEEDS_YOU_RANK)[number];

export const REASON_LABEL: Record<NeedsReason, string> = {
  overdue: "Overdue",
  blocking: "Blocking someone",
  due_today: "Due today",
  ready: "Ready",
};

export interface TaskView {
  id: string;
  title: string;
  kind: string;
  state: string;
  summary?: string;
  due?: number;
  assigned: { kind: FaceKind; id: string };
  actionKey?: string;
  actionLabel?: string;
}

export interface NeedsItem {
  task: TaskView;
  reason: NeedsReason;
  handledBy?: string;
}

export interface WorkLists {
  open: TaskView[];
  assignedByMe: TaskView[];
  done: TaskView[];
  counts: { open: number; assignedByMe: number; done: number };
}

export interface AtRiskProject {
  recordId: string;
  title: string;
  reasons: Array<"overdue" | "blocked" | "slipped">;
  dueAt?: number;
  blockedTasks: number;
  overdueTasks: number;
}

export interface AtRiskView {
  rule: string;
  projects: AtRiskProject[];
}

export interface DigestItemView {
  kind: string;
  title: string;
  line: string;
  runId?: string;
}

export interface DigestView {
  id: string;
  headline: string[];
  items: DigestItemView[];
  seenAt?: number;
  periodStart: number;
  periodEnd: number;
  builtBy: string;
}

export interface RoutineView {
  routineId: string;
  title: string;
  state: "scheduled" | "running" | "done" | "failed";
  agentId: string;
  at: number;
  resultLine?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function isReason(value: unknown): value is NeedsReason {
  return value === "overdue" || value === "blocking" || value === "due_today" || value === "ready";
}

function firstAction(value: unknown): { key?: string; label?: string } {
  if (!Array.isArray(value) || !isRecord(value[0])) return {};
  const key = typeof value[0].key === "string" ? value[0].key : undefined;
  const label = typeof value[0].label === "string" ? value[0].label : undefined;
  return { key, label };
}

export function isTask(value: unknown): value is TaskView {
  if (!isRecord(value)) return false;
  if (typeof value.id !== "string" || typeof value.title !== "string") return false;
  if (typeof value.kind !== "string" || typeof value.state !== "string") return false;
  if (!isRecord(value.assigned) || typeof value.assigned.id !== "string" || typeof value.assigned.kind !== "string") return false;
  if (!isFaceKind(value.assigned.kind)) return false;
  if (value.due !== undefined && typeof value.due !== "number") return false;
  if (value.summary !== undefined && typeof value.summary !== "string") return false;
  return true;
}

function taskOf(value: unknown): TaskView | null {
  if (!isRecord(value)) return null;
  const action = firstAction(value.actions);
  if (!isTask(value)) return null;
  const task: TaskView = {
    id: value.id,
    title: value.title,
    kind: value.kind,
    state: value.state,
    assigned: value.assigned,
  };
  if (value.summary !== undefined) task.summary = value.summary;
  if (value.due !== undefined) task.due = value.due;
  if (action.key !== undefined) task.actionKey = action.key;
  if (action.label !== undefined) task.actionLabel = action.label;
  return task;
}

export function needsItems(data: unknown): { items: NeedsItem[]; total: number } {
  if (!isRecord(data) || !Array.isArray(data.items)) return { items: [], total: 0 };
  const items: NeedsItem[] = [];
  for (const raw of data.items) {
    if (!isRecord(raw) || !isReason(raw.reason)) continue;
    const task = taskOf(raw.task);
    if (!task) continue;
    const item: NeedsItem = { task, reason: raw.reason };
    if (typeof raw.handledBy === "string") item.handledBy = raw.handledBy;
    items.push(item);
  }
  const total = typeof data.total === "number" ? data.total : items.length;
  return { items, total };
}

/** Overdue, then blocking, then due today, then ready. Same reason: sooner due first, then title. */
export function rankNeedsYou(items: readonly NeedsItem[]): NeedsItem[] {
  const rank = new Map<NeedsReason, number>(NEEDS_YOU_RANK.map((reason, index) => [reason, index]));
  return [...items].sort((a, b) => {
    const byReason = (rank.get(a.reason) ?? 0) - (rank.get(b.reason) ?? 0);
    if (byReason !== 0) return byReason;
    const ad = a.task.due ?? Number.MAX_SAFE_INTEGER;
    const bd = b.task.due ?? Number.MAX_SAFE_INTEGER;
    if (ad !== bd) return ad - bd;
    const byTitle = a.task.title.localeCompare(b.task.title);
    if (byTitle !== 0) return byTitle;
    return a.task.id.localeCompare(b.task.id);
  }).slice(0, NEEDS_YOU_LIMIT);
}

function tasksOf(data: unknown): TaskView[] {
  if (!isRecord(data) || !Array.isArray(data.tasks)) return [];
  const out: TaskView[] = [];
  for (const raw of data.tasks) {
    const task = taskOf(raw);
    if (task) out.push(task);
  }
  return out;
}

export function workCounts(data: unknown): { open: number; assignedByMe: number; done: number } {
  if (!isRecord(data) || !isRecord(data.counts)) return { open: 0, assignedByMe: 0, done: 0 };
  return {
    open: num(data.counts.open),
    assignedByMe: num(data.counts.assignedByMe),
    done: num(data.counts.done),
  };
}

export function workTasks(data: unknown): TaskView[] {
  return tasksOf(data);
}

const RISK = ["overdue", "blocked", "slipped"] as const;
type RiskReason = (typeof RISK)[number];

function isRisk(value: unknown): value is RiskReason {
  return value === "overdue" || value === "blocked" || value === "slipped";
}

export function atRiskOf(data: unknown): AtRiskView {
  if (!isRecord(data)) return { rule: "", projects: [] };
  const rule = typeof data.rule === "string" ? data.rule : "";
  const projects: AtRiskProject[] = [];
  if (Array.isArray(data.projects)) {
    for (const raw of data.projects) {
      if (!isRecord(raw) || typeof raw.recordId !== "string" || typeof raw.title !== "string") continue;
      if (!Array.isArray(raw.reasons)) continue;
      const reasons = raw.reasons.filter(isRisk);
      const project: AtRiskProject = {
        recordId: raw.recordId,
        title: raw.title,
        reasons,
        blockedTasks: num(raw.blockedTasks),
        overdueTasks: num(raw.overdueTasks),
      };
      if (typeof raw.dueAt === "number") project.dueAt = raw.dueAt;
      projects.push(project);
    }
  }
  return { rule, projects };
}

function digestItem(value: unknown): DigestItemView | null {
  if (!isRecord(value)) return null;
  if (typeof value.kind !== "string" || typeof value.title !== "string" || typeof value.line !== "string") return null;
  const item: DigestItemView = { kind: value.kind, title: value.title, line: value.line };
  if (isRecord(value.undo) && isRecord(value.undo.input) && typeof value.undo.input.runId === "string") item.runId = value.undo.input.runId;
  return item;
}

export function digestOf(data: unknown): DigestView | null {
  if (!isRecord(data)) return null;
  const raw = data.digest;
  if (raw === null || raw === undefined) return null;
  if (!isRecord(raw)) return null;
  if (typeof raw.id !== "string" || typeof raw.builtBy !== "string") return null;
  if (typeof raw.periodStart !== "number" || typeof raw.periodEnd !== "number") return null;
  if (!Array.isArray(raw.headline) || !raw.headline.every((line) => typeof line === "string")) return null;
  if (raw.seenAt !== undefined && typeof raw.seenAt !== "number") return null;
  const items: DigestItemView[] = [];
  if (Array.isArray(raw.items)) {
    for (const entry of raw.items) {
      const item = digestItem(entry);
      if (item) items.push(item);
    }
  }
  const digest: DigestView = {
    id: raw.id,
    headline: raw.headline.slice(0, 3),
    items: items.slice(0, 7),
    periodStart: raw.periodStart,
    periodEnd: raw.periodEnd,
    builtBy: raw.builtBy,
  };
  if (typeof raw.seenAt === "number") digest.seenAt = raw.seenAt;
  return digest;
}

const ROUTINE_STATE = ["scheduled", "running", "done", "failed"] as const;
type RoutineState = (typeof ROUTINE_STATE)[number];

function isRoutineState(value: unknown): value is RoutineState {
  return value === "scheduled" || value === "running" || value === "done" || value === "failed";
}

export function routinesOf(data: unknown): RoutineView[] {
  if (!isRecord(data) || !Array.isArray(data.routines)) return [];
  const out: RoutineView[] = [];
  for (const raw of data.routines) {
    if (!isRecord(raw)) continue;
    if (typeof raw.routineId !== "string" || typeof raw.title !== "string" || typeof raw.agentId !== "string") continue;
    if (typeof raw.at !== "number" || !isRoutineState(raw.state)) continue;
    const routine: RoutineView = {
      routineId: raw.routineId,
      title: raw.title,
      state: raw.state,
      agentId: raw.agentId,
      at: raw.at,
    };
    if (typeof raw.resultLine === "string") routine.resultLine = raw.resultLine;
    out.push(routine);
  }
  return out;
}
