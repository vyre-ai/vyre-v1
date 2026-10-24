// Automations canvas model (ARCH 7.7). A definition is a JSON graph: triggers,
// steps, paths, parallel, wait, loop, approval and stop. This matches the
// automations manifest. kernel/flows/canvas.js is not in this worktree, so
// this is the v1 graph, not a line copy of the 0.6 file.
//
// Validation mirrors automations.validate: missing inputs, unreachable steps,
// loops that are not a Loop step, and personal triggers that need a Team Space.
// Issues render on the step they name so the canvas can show them inline.

import type { HistoryVersion } from "../../../../../../ui/src/HistoryTab/props.ts";

export const TRIGGER_PALETTE = [
  { key: "record_change", title: "Record change", personalOk: true },
  { key: "schedule", title: "Schedule", personalOk: true },
  { key: "webhook", title: "Webhook", personalOk: false },
  { key: "form_submit", title: "Form submit", personalOk: true },
  { key: "email_received", title: "Email received", personalOk: true },
  { key: "chat_message", title: "Chat message", personalOk: true },
  { key: "spreadsheet_row", title: "Spreadsheet row", personalOk: true },
  { key: "ci_check", title: "CI check", personalOk: true },
  { key: "meeting_transcript_ready", title: "Meeting transcript ready", personalOk: true },
  { key: "journey_stage_entered", title: "Journey stage entered", personalOk: true },
  { key: "campaign_reply", title: "Campaign reply", personalOk: true },
  { key: "button", title: "Button", personalOk: true },
  { key: "manual", title: "Manual", personalOk: true },
] as const;

export type TriggerKey = (typeof TRIGGER_PALETTE)[number]["key"];

/** Control steps the canvas palette offers. Spec 2.12. */
export const CONTROL_PALETTE = [
  { key: "paths", title: "Paths" },
  { key: "parallel", title: "Parallel" },
  { key: "wait", title: "Wait" },
  { key: "loop", title: "Loop" },
  { key: "approval", title: "Approval" },
  { key: "stop", title: "Stop" },
] as const;

export type ControlKey = (typeof CONTROL_PALETTE)[number]["key"];

/** Step keys from manifests/steps-core.ts. The canvas does not import that module. */
export const STEP_KEYS = [
  "records.create", "records.find", "records.update", "create_task",
  "send_email", "send_sms", "post_message", "ai",
  "start_journey", "wait_stage", "wait",
  "if", "paths", "parallel", "loop", "stop", "approval",
  "sheet.create", "sheet.add_rows", "sheet.find_rows", "sheet.update_rows", "sheet.delete_rows", "sheet.read_all",
  "sign", "code",
] as const;

export const WAIT_TIMEOUT_DEFAULT = "30d";
export const CHAIN_DEPTH_LIMIT = 8;

const DURATION = /^\d+(m|h|d)$/;
const SPECIFIC_INPUT = new Set(["paths", "parallel", "wait", "loop", "approval", "stop", "if", "ai"]);

export interface TriggerRef {
  key: string;
  config?: Record<string, unknown>;
  filter?: unknown;
}

export interface Branch {
  label: string;
  to: string;
  when?: string;
}

export type ErrorMode = "fail" | "continue" | "retry" | "route";

export interface OnError {
  mode: ErrorMode;
  max?: number;
  route?: string;
}

export interface AssigneeRef {
  kind: "person" | "agent" | "group" | "role" | "automation";
  id: string;
}

export interface AiBlock {
  agentId?: string;
  keyId?: string;
  backupKeyId?: string;
  assigned?: AssigneeRef;
  reviewer?: AssigneeRef;
  approver?: AssigneeRef;
  timeoutMinutes?: number;
  nudgeMinutes?: number;
  escalateTo?: AssigneeRef;
}

export interface CanvasNode {
  id: string;
  key: string;
  title?: string;
  input: Record<string, unknown>;
  next?: string[];
  branches?: Branch[];
  onError?: OnError;
  ai?: AiBlock;
}

export interface CanvasDefinition {
  triggers: TriggerRef[];
  nodes: CanvasNode[];
  start?: string[];
  allowSelfTrigger?: boolean;
}

export interface CanvasIssue {
  nodeId?: string;
  severity: "error" | "warning";
  message: string;
}

export interface Validation {
  ok: boolean;
  issues: CanvasIssue[];
}

export type RunState = "running" | "succeeded" | "failed" | "waiting" | "skipped";

export interface RunStep {
  stepId: string;
  state: RunState;
  /** Branch label or target id chosen by a Paths step. */
  taken?: string;
}

export interface CanvasRun {
  runId: string;
  steps: RunStep[];
}

export type CanvasTab = "canvas" | "history";

export interface Editor {
  name: string;
  kind: "personal" | "space";
  automationId: string;
  definition: CanvasDefinition;
  tab: CanvasTab;
  run: CanvasRun | null;
  versions: HistoryVersion[];
  selectedVersionId: string | null;
  seq: number;
}

export interface PathStep {
  id: string;
  key: string;
  title?: string;
  input: Record<string, unknown>;
}

export interface PathBuild {
  name: string;
  when: string;
  to: PathStep;
}

export interface EditorInit {
  name?: string;
  kind?: "personal" | "space";
  automationId?: string;
  versions?: readonly HistoryVersion[];
}

export function triggerTitle(key: string): string {
  const row = TRIGGER_PALETTE.find((item) => item.key === key);
  return row ? row.title : key;
}

export function stepTitle(key: string): string {
  const control = CONTROL_PALETTE.find((item) => item.key === key);
  if (control) return control.title;
  if (key === "if") return "If";
  if (key === "ai") return "AI step";
  return key;
}

export function createEditor(init: EditorInit = {}): Editor {
  const automationId = init.automationId ?? "aut_draft";
  const versions = init.versions ? [...init.versions] : defaultVersions();
  const first = versions[0];
  return {
    name: init.name ?? "Untitled automation",
    kind: init.kind ?? "personal",
    automationId,
    definition: { triggers: [], nodes: [] },
    tab: "canvas",
    run: null,
    versions,
    selectedVersionId: first ? first.id : null,
    seq: 1,
  };
}

function defaultVersions(): HistoryVersion[] {
  return [
    {
      id: "ver_2",
      n: 2,
      who: "Irfad Imtiaz",
      why: "Add the Open path",
      at: "2026-10-24T12:00:00Z",
      runId: null,
      undoable: true,
    },
    {
      id: "ver_1",
      n: 1,
      who: "Irfad Imtiaz",
      why: "First draft",
      at: "2026-10-23T09:00:00Z",
      runId: null,
      undoable: false,
    },
  ];
}

export function addTrigger(editor: Editor, key: string, config?: Record<string, unknown>): Editor {
  const trigger: TriggerRef = config ? { key, config } : { key };
  const triggers = [...editor.definition.triggers, trigger];
  return { ...editor, definition: { ...editor.definition, triggers } };
}

export function addPaths(editor: Editor, paths: readonly PathBuild[], pathsId = `paths_${editor.seq}`): Editor {
  const branches: Branch[] = [];
  const pathInputs: { name: string; when: string }[] = [];
  const steps: CanvasNode[] = [];
  for (const path of paths) {
    branches.push(branchOf(path.name, path.to.id, path.when));
    pathInputs.push({ name: path.name, when: path.when });
    steps.push(stepNode(path.to));
  }
  const pathsNode: CanvasNode = {
    id: pathsId,
    key: "paths",
    title: "Paths",
    input: { paths: pathInputs, otherwise: false },
    branches,
  };
  const start = editor.definition.start && editor.definition.start.length > 0
    ? [...editor.definition.start]
    : [pathsId];
  return {
    ...editor,
    seq: editor.seq + 1,
    definition: {
      ...editor.definition,
      nodes: [...editor.definition.nodes, pathsNode, ...steps],
      start,
    },
  };
}

export function addNode(editor: Editor, node: CanvasNode): Editor {
  const stored = normalizeNode(node);
  const start = editor.definition.start && editor.definition.start.length > 0
    ? editor.definition.start
    : [stored.id];
  return {
    ...editor,
    definition: {
      ...editor.definition,
      nodes: [...editor.definition.nodes, stored],
      start: [...start],
    },
  };
}

export function setPathWhen(editor: Editor, pathsId: string, name: string, when: string): Editor {
  const nodes = editor.definition.nodes.map((node) => {
    if (node.id !== pathsId) return node;
    const paths = readPaths(node.input).map((path) => path.name === name ? { name: path.name, when } : path);
    const branches = (node.branches ?? []).map((branch) => branch.label === name ? branchOf(branch.label, branch.to, when) : branch);
    return { ...node, input: { ...node.input, paths }, branches };
  });
  return { ...editor, definition: { ...editor.definition, nodes } };
}

export function withCanvasTab(editor: Editor, tab: CanvasTab): Editor {
  return { ...editor, tab };
}

export function withRun(editor: Editor, run: CanvasRun | null): Editor {
  return { ...editor, run };
}

function stepNode(step: PathStep): CanvasNode {
  const node: CanvasNode = { id: step.id, key: step.key, input: step.input };
  if (step.title) node.title = step.title;
  return normalizeNode(node);
}

function branchOf(label: string, to: string, when: string): Branch {
  if (when.length === 0) return { label, to };
  return { label, to, when };
}

function normalizeNode(node: CanvasNode): CanvasNode {
  if (node.key !== "wait") return node;
  if (typeof node.input.timeout === "string" && node.input.timeout.length > 0) return node;
  return { ...node, input: { ...node.input, timeout: WAIT_TIMEOUT_DEFAULT } };
}

export function readPaths(input: Record<string, unknown>): { name: string; when: string }[] {
  const raw = input.paths;
  if (!Array.isArray(raw)) return [];
  const out: { name: string; when: string }[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    out.push({
      name: typeof rec.name === "string" ? rec.name : "",
      when: typeof rec.when === "string" ? rec.when : "",
    });
  }
  return out;
}

export function validateDefinition(definition: CanvasDefinition, kind: "personal" | "space"): Validation {
  const issues: CanvasIssue[] = [];
  const byId = new Map<string, CanvasNode>();
  const seen = new Set<string>();

  if (definition.triggers.length === 0) {
    issues.push({ severity: "error", message: "Add a trigger" });
  }
  definition.triggers.forEach((trigger, index) => {
    const nodeId = `trigger:${index}`;
    const known = TRIGGER_PALETTE.find((item) => item.key === trigger.key);
    if (!known) {
      issues.push({ nodeId, severity: "error", message: "Unknown trigger" });
      return;
    }
    if (kind === "personal" && !known.personalOk) {
      issues.push({ nodeId, severity: "error", message: `${known.title} needs a Team Space` });
    }
    if (trigger.key === "schedule" && trigger.config && "ifMissed" in trigger.config) {
      const missed = trigger.config.ifMissed;
      if (missed !== "skip" && missed !== "run_once") {
        issues.push({ nodeId, severity: "error", message: "Schedule if missed must be skip or run once" });
      }
    }
  });

  for (const node of definition.nodes) {
    if (seen.has(node.id)) issues.push({ nodeId: node.id, severity: "error", message: "Two steps share this id" });
    seen.add(node.id);
    byId.set(node.id, node);
  }

  const start = definition.start ?? [];
  for (const id of start) {
    if (!byId.has(id)) issues.push({ severity: "error", message: "Start step is not on the canvas" });
  }

  for (const node of definition.nodes) {
    if (!(STEP_KEYS as readonly string[]).includes(node.key)) {
      issues.push({ nodeId: node.id, severity: "error", message: "Unknown step" });
    }
    for (const next of node.next ?? []) {
      if (!byId.has(next)) issues.push({ nodeId: node.id, severity: "error", message: "Links to a step that is not on the canvas" });
    }
    for (const branch of node.branches ?? []) {
      if (!byId.has(branch.to)) issues.push({ nodeId: node.id, severity: "error", message: "Links to a step that is not on the canvas" });
    }
    issues.push(...inputIssues(node));
    issues.push(...errorIssues(node, byId));
  }

  const loopId = loopingNode(definition, byId);
  if (loopId) issues.push({ nodeId: loopId, severity: "error", message: "This path loops. Use a Loop step." });

  const reach = reachable(definition, byId);
  for (const node of definition.nodes) {
    if (!reach.has(node.id)) issues.push({ nodeId: node.id, severity: "error", message: "Step is not on a path" });
  }

  return { ok: issues.every((issue) => issue.severity !== "error"), issues };
}

function inputIssues(node: CanvasNode): CanvasIssue[] {
  const issues: CanvasIssue[] = [];
  const nodeId = node.id;
  if (node.key === "paths") {
    const paths = readPaths(node.input);
    const source = paths.length > 0 ? paths : (node.branches ?? []).map((branch) => ({ name: branch.label, when: branch.when ?? "" }));
    if (source.length < 1) issues.push({ nodeId, severity: "error", message: "Paths needs a path" });
    const names = new Set<string>();
    const otherwise = node.input.otherwise === true;
    source.forEach((path, index) => {
      if (path.name.length === 0) {
        issues.push({ nodeId, severity: "error", message: "Path needs a name" });
        return;
      }
      if (names.has(path.name)) issues.push({ nodeId, severity: "error", message: `Path name ${path.name} is used twice` });
      names.add(path.name);
      const last = index === source.length - 1;
      if (path.when.trim().length === 0 && !(otherwise && last)) {
        issues.push({ nodeId, severity: "error", message: `Path ${path.name} needs a condition` });
      }
    });
    return issues;
  }
  if (node.key === "parallel") {
    const fromInput = Array.isArray(node.input.branches) ? node.input.branches.length : 0;
    const fromGraph = node.branches?.length ?? 0;
    const count = Math.max(fromInput, fromGraph);
    if (count < 2) issues.push({ nodeId, severity: "error", message: "Parallel needs two branches" });
    return issues;
  }
  if (node.key === "wait") {
    const timeout = node.input.timeout;
    if (typeof timeout === "string" && timeout.length > 0 && !DURATION.test(timeout)) {
      issues.push({ nodeId, severity: "error", message: "Wait timeout is not a duration" });
    }
    return issues;
  }
  if (node.key === "loop") {
    const items = node.input.items;
    if (typeof items !== "string" || items.trim().length === 0) {
      issues.push({ nodeId, severity: "error", message: "Loop needs a list" });
    }
    return issues;
  }
  if (node.key === "approval") {
    const title = node.input.title;
    if (typeof title !== "string" || title.trim().length === 0) issues.push({ nodeId, severity: "error", message: "Approval needs a title" });
    const approver = node.input.approver;
    if (!approver || typeof approver !== "object") issues.push({ nodeId, severity: "error", message: "Approval needs an approver" });
    return issues;
  }
  if (node.key === "if") {
    const condition = node.input.condition;
    if (typeof condition !== "string" || condition.trim().length === 0) {
      issues.push({ nodeId, severity: "error", message: "If needs a condition" });
    }
    return issues;
  }
  if (node.key === "ai") {
    if (!node.ai?.keyId) issues.push({ nodeId, severity: "error", message: "AI step needs an inference key" });
    if (!node.ai?.backupKeyId) issues.push({ nodeId, severity: "error", message: "AI step needs a backup key" });
    return issues;
  }
  if (node.key === "stop") return issues;
  if (!SPECIFIC_INPUT.has(node.key) && Object.keys(node.input).length === 0) {
    issues.push({ nodeId, severity: "error", message: "Missing inputs" });
  }
  return issues;
}

function errorIssues(node: CanvasNode, byId: Map<string, CanvasNode>): CanvasIssue[] {
  const onError = node.onError;
  if (!onError) return [];
  const nodeId = node.id;
  if (onError.mode === "route") {
    if (!onError.route) return [{ nodeId, severity: "error", message: "Error route needs a step" }];
    if (!byId.has(onError.route)) return [{ nodeId, severity: "error", message: "Error route is not on the canvas" }];
  }
  if (onError.mode === "retry" && onError.max !== undefined && (onError.max < 1 || onError.max > 10)) {
    return [{ nodeId, severity: "error", message: "Retry max is between 1 and 10" }];
  }
  return [];
}

export function rootIds(definition: CanvasDefinition): string[] {
  if (definition.start && definition.start.length > 0) return [...definition.start];
  const first = definition.nodes[0];
  return first ? [first.id] : [];
}

function reachable(definition: CanvasDefinition, byId: Map<string, CanvasNode>): Set<string> {
  const roots = rootIds(definition);
  const seen = new Set<string>();
  const walk = (id: string): void => {
    if (seen.has(id)) return;
    const node = byId.get(id);
    if (!node) return;
    seen.add(id);
    for (const next of node.next ?? []) walk(next);
    for (const branch of node.branches ?? []) walk(branch.to);
  };
  for (const id of roots) walk(id);
  return seen;
}

function loopingNode(definition: CanvasDefinition, byId: Map<string, CanvasNode>): string | null {
  const color = new Map<string, 0 | 1 | 2>();
  const stack: string[] = [];
  const visit = (id: string): string | null => {
    const state = color.get(id) ?? 0;
    if (state === 1) {
      const cycle = stack.slice(stack.indexOf(id));
      const allowed = cycle.some((cycleId) => byId.get(cycleId)?.key === "loop");
      return allowed ? null : id;
    }
    if (state === 2) return null;
    color.set(id, 1);
    stack.push(id);
    const node = byId.get(id);
    if (node) {
      for (const next of node.next ?? []) {
        const hit = visit(next);
        if (hit) return hit;
      }
      for (const branch of node.branches ?? []) {
        const hit = visit(branch.to);
        if (hit) return hit;
      }
    }
    stack.pop();
    color.set(id, 2);
    return null;
  };
  for (const node of definition.nodes) {
    const hit = visit(node.id);
    if (hit) return hit;
  }
  return null;
}

/** Node ids on the lane a run took. Other lanes stay dim. Paths follow `taken`. */
export function takenLane(definition: CanvasDefinition, steps: readonly RunStep[]): ReadonlySet<string> {
  const byId = new Map(definition.nodes.map((node) => [node.id, node]));
  const takenOf = new Map<string, string>();
  for (const step of steps) {
    if (step.taken) takenOf.set(step.stepId, step.taken);
  }
  const lit = new Set<string>();
  const seen = new Set<string>();
  const roots = rootIds(definition);
  const walk = (id: string): void => {
    if (seen.has(id)) return;
    const node = byId.get(id);
    if (!node) return;
    seen.add(id);
    lit.add(id);
    if (node.key === "paths") {
      const taken = takenOf.get(id);
      const branch = taken ? node.branches?.find((item) => item.label === taken || item.to === taken) : undefined;
      if (branch) walk(branch.to);
      return;
    }
    for (const next of node.next ?? []) walk(next);
    for (const branch of node.branches ?? []) walk(branch.to);
  };
  for (const id of roots) walk(id);
  return lit;
}
