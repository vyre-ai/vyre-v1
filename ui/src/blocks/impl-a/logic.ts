// Native chat blocks, part 1 (spec native, 3.2; ARCH 6.8): terminal, changeset, question, plan, deploy, mount, record_card.
// Pure logic: which capability each button calls (mirrors the block definitions in manifests/, checked by the test against generated/registry.json),
// how a pointer such as "/changesetId" reads the block data, and the small decisions each card makes (answers, plan edits, states).
// A block renderer never calls a module directly: it calls `host.invoke(capability, input)` and `host.open(tab, input)`, so every action goes through
// the same permission check, Gate and audit as the UI.

import type { Block } from "../../kit/types.ts";

/** What a block needs from the app around it. */
export interface BlockHost {
  /** Calls a capability as the person. */
  invoke: (capability: string, input: Record<string, unknown>) => Promise<unknown> | unknown;
  /** Opens a tab beside the chat (a diff, a terminal, a file, a record, a site, a folder). */
  open: (tab: string, input: Record<string, unknown>) => void;
  /** Opens a link outside the app (a preview URL). */
  openUrl?: (url: string) => void;
}

export interface BlockActionSpec {
  key: string;
  label: string;
  cap: string;
  /** Capability input: each value is a pointer into the block data. */
  input: Readonly<Record<string, string>>;
}

export interface BlockOpensSpec {
  tab: string;
  input: Readonly<Record<string, string>>;
}

export interface BlockSpecA {
  type: PartOneType;
  actions: readonly BlockActionSpec[];
  opens?: BlockOpensSpec;
}

export const PART_ONE_TYPES = ["terminal", "changeset", "question", "plan", "deploy", "mount", "record_card"] as const;
export type PartOneType = (typeof PART_ONE_TYPES)[number];

/** The actions and tab each block declares in the manifests. A test compares this table with generated/registry.json. */
export const BLOCK_SPECS_A: Readonly<Record<PartOneType, BlockSpecA>> = {
  terminal: {
    type: "terminal",
    actions: [
      { key: "interrupt", label: "Interrupt", cap: "terminal.interrupt", input: { terminalId: "/terminalId" } },
      { key: "close", label: "Close", cap: "terminal.close", input: { terminalId: "/terminalId" } },
    ],
    opens: { tab: "terminal", input: { terminalId: "/terminalId" } },
  },
  changeset: {
    type: "changeset",
    actions: [
      { key: "approve", label: "Approve and commit", cap: "changesets.approve", input: { changesetId: "/changesetId" } },
      { key: "request_changes", label: "Request changes", cap: "changesets.request_changes", input: { changesetId: "/changesetId" } },
      { key: "discard", label: "Discard", cap: "changesets.discard", input: { changesetId: "/changesetId" } },
    ],
    opens: { tab: "diff", input: { changesetId: "/changesetId" } },
  },
  question: {
    type: "question",
    actions: [{ key: "answer", label: "Answer", cap: "chat.answer_block", input: { threadId: "/threadId", blockId: "/blockId" } }],
  },
  plan: {
    type: "plan",
    actions: [
      { key: "approve", label: "Approve", cap: "chat.approve_plan", input: { threadId: "/threadId", planId: "/planId" } },
      { key: "reject", label: "Reject", cap: "chat.plan.reject", input: { threadId: "/threadId", planId: "/planId" } },
    ],
    opens: { tab: "file", input: { fileId: "/docFileId" } },
  },
  deploy: {
    type: "deploy",
    actions: [
      { key: "promote", label: "Promote", cap: "sites.promote", input: { siteId: "/siteId", deploymentId: "/deploymentId" } },
      { key: "rollback", label: "Roll back", cap: "sites.rollback", input: { siteId: "/siteId" } },
    ],
    opens: { tab: "site", input: { siteId: "/siteId" } },
  },
  mount: {
    type: "mount",
    actions: [{ key: "sync", label: "Sync now", cap: "mounts.sync_now", input: { mountId: "/mountId" } }],
    opens: { tab: "files", input: { folderId: "/folderId" } },
  },
  record_card: {
    type: "record_card",
    actions: [],
    opens: { tab: "record", input: { recordId: "/recordId" } },
  },
};

/** The terminal block stars through the shared star capability, not a block action of its own. */
export const STAR_CAPABILITY = "stars.toggle" as const;

export function actionSpec(type: PartOneType, key: string): BlockActionSpec | undefined {
  return BLOCK_SPECS_A[type].actions.find((a) => a.key === key);
}

/** Reads a JSON pointer ("/a/b") from block data. Undefined when any step is missing. */
export function readPointer(data: unknown, pointer: string): unknown {
  if (!pointer.startsWith("/")) return undefined;
  let at: unknown = data;
  for (const part of pointer.slice(1).split("/")) {
    if (part === "") continue;
    if (typeof at !== "object" || at === null) return undefined;
    at = (at as Record<string, unknown>)[part];
  }
  return at;
}

/** The input of a capability call: every pointer replaced by its value. A pointer with no value is left out. */
export function resolveInput(data: unknown, input: Readonly<Record<string, string>>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, pointer] of Object.entries(input)) {
    const value = readPointer(data, pointer);
    if (value !== undefined) out[key] = value;
  }
  return out;
}

/** Calls the capability a block action declares, with the block's own ids and any extra input (an answer, a note, edits). */
export async function runAction(host: BlockHost, type: PartOneType, key: string, data: unknown, extra: Record<string, unknown> = {}): Promise<boolean> {
  const spec = actionSpec(type, key);
  if (spec === undefined) return false;
  await host.invoke(spec.cap, { ...resolveInput(data, spec.input), ...extra });
  return true;
}

/** Opens the tab a block declares. False when the block has none or the data lacks what the tab needs. */
export function openTab(host: BlockHost, type: PartOneType, data: unknown): boolean {
  const opens = BLOCK_SPECS_A[type].opens;
  if (opens === undefined) return false;
  const input = resolveInput(data, opens.input);
  if (Object.keys(input).length < Object.keys(opens.input).length) return false;
  host.open(opens.tab, input);
  return true;
}

/** Stars or unstars a terminal. */
export async function starTerminal(host: BlockHost, terminalId: string, on: boolean): Promise<void> {
  await host.invoke(STAR_CAPABILITY, { resource: { type: "terminal", id: terminalId }, on });
}

/* ---------- terminal ---------- */

export interface TerminalCommand {
  command: string;
  exitCode: number | null;
  startedAt: number;
  durationMs?: number;
}

/** "Ran 3 commands on Intake computer". */
export function terminalTitle(count: number, hostTitle: string): string {
  return `Ran ${count} ${count === 1 ? "command" : "commands"} on ${hostTitle}`;
}

/** The last few lines of output, so a long tail stays a short block. */
export function tailLines(tail: string, max = 6): string[] {
  const lines = tail.replace(/\s+$/, "").split("\n");
  return lines.length <= max ? lines : lines.slice(lines.length - max);
}

export function durationLabel(ms: number | undefined): string {
  if (ms === undefined) return "";
  if (ms < 1000) return `${ms} ms`;
  const s = ms / 1000;
  return s < 10 ? `${s.toFixed(1)} s` : `${Math.round(s)} s`;
}

export function exitLabel(code: number | null): string {
  return code === null ? "running" : code === 0 ? "ok" : `exit ${code}`;
}

export type TerminalState = "running" | "idle" | "exited";

/** Interrupt is for a running terminal, Close for one that has stopped. */
export function terminalActions(state: TerminalState): { interrupt: boolean; close: boolean } {
  return { interrupt: state === "running", close: state !== "running" };
}

/* ---------- changeset ---------- */

const CLOSED_CHANGESET = new Set(["approved", "committed", "merged", "discarded", "rejected", "closed"]);

/** A changeset can still be reviewed while it is open or waiting for changes. */
export function changesetOpen(state: string): boolean {
  return !CLOSED_CHANGESET.has(state.trim().toLowerCase());
}

export function changesetTitle(fileCount: number, folderName: string): string {
  return `Changed ${fileCount} ${fileCount === 1 ? "file" : "files"} in ${folderName}`;
}

export function countsLine(added: number, removed: number): string {
  return `+${added} −${removed}`;
}

/* ---------- question ---------- */

export type QuestionMode = "single" | "multi" | "free";

export interface QuestionAnswer {
  /** The keys of the chosen options (single has one). */
  keys: string[];
  /** The text typed under Other, or the free-text answer. */
  text?: string;
}

/** What goes to chat.answer_block: the chosen option keys and any text. Free mode is text only. */
export function buildAnswer(mode: QuestionMode, picked: readonly string[], text: string): QuestionAnswer {
  const typed = text.trim();
  if (mode === "free") return { keys: [], text: typed };
  const keys = mode === "single" ? picked.slice(0, 1) : picked.slice();
  return typed === "" ? { keys } : { keys, text: typed };
}

/** An answer needs a choice or some text. */
export function canAnswer(mode: QuestionMode, picked: readonly string[], text: string): boolean {
  if (mode === "free") return text.trim() !== "";
  return picked.length > 0 || text.trim() !== "";
}

/** Single picks replace, multi picks toggle. */
export function togglePick(mode: QuestionMode, picked: readonly string[], key: string): string[] {
  if (mode === "single") return [key];
  return picked.includes(key) ? picked.filter((k) => k !== key) : [...picked, key];
}

/** The answer as one line, for a block that has been answered. */
export function answerLine(options: readonly { key: string; label: string }[], answer: unknown): string {
  if (typeof answer === "string") return answer;
  if (typeof answer !== "object" || answer === null) return "";
  const rec = answer as { keys?: unknown; text?: unknown };
  const labels: string[] = [];
  if (Array.isArray(rec.keys)) {
    for (const key of rec.keys) {
      const hit = options.find((o) => o.key === key);
      labels.push(hit === undefined ? String(key) : hit.label);
    }
  }
  if (typeof rec.text === "string" && rec.text !== "") labels.push(rec.text);
  return labels.join(", ");
}

/* ---------- plan ---------- */

export interface PlanStepData {
  stepId: string;
  text: string;
  state: "todo" | "doing" | "done" | "skipped";
  detail?: string;
}

export interface StepEdit {
  stepId: string;
  text?: string;
  remove?: boolean;
}

/** The edits to send with Approve: a changed text, or a removed step. Unchanged steps are left out. */
export function planEdits(steps: readonly PlanStepData[], texts: Readonly<Record<string, string>>, removed: ReadonlySet<string>): StepEdit[] {
  const out: StepEdit[] = [];
  for (const step of steps) {
    if (removed.has(step.stepId)) {
      out.push({ stepId: step.stepId, remove: true });
      continue;
    }
    const text = texts[step.stepId];
    if (text !== undefined && text.trim() !== "" && text.trim() !== step.text) out.push({ stepId: step.stepId, text: text.trim() });
  }
  return out;
}

/** "2 of 5 done". */
export function planProgress(steps: readonly PlanStepData[]): string {
  const done = steps.filter((s) => s.state === "done").length;
  return `${done} of ${steps.length} done`;
}

export function planTitle(title: string, steps: number): string {
  return `${title} · ${steps} ${steps === 1 ? "step" : "steps"}`;
}

export const STEP_MARK: Readonly<Record<PlanStepData["state"], string>> = { todo: "○", doing: "◐", done: "●", skipped: "–" };

/** Approve, Edit and Reject show while the plan waits. After that the card shows its state. */
export function planWaiting(state: string): boolean {
  return state === "proposed";
}

/* ---------- deploy ---------- */

export type DeployState = "queued" | "building" | "ready" | "failed" | "stopped";

export function deployLine(env: string, state: DeployState): string {
  const word = state === "ready" ? "is live" : state === "building" ? "is building" : state === "queued" ? "is queued" : state === "failed" ? "failed" : "was stopped";
  return `Deploy ${env} ${word}`;
}

/** Promote needs a ready deploy that may be promoted; Roll back needs one that went live or failed. */
export function deployActions(state: DeployState, canPromote: boolean, env: string): { promote: boolean; rollback: boolean } {
  return { promote: state === "ready" && canPromote && env !== "production", rollback: (state === "ready" || state === "failed") && env === "production" };
}

export function checksLine(checks: readonly { name: string; ok: boolean }[]): string {
  if (checks.length === 0) return "";
  const failed = checks.filter((c) => !c.ok).length;
  return failed === 0 ? `${checks.length} checks passed` : `${failed} of ${checks.length} checks failed`;
}

/** A preview link is only followed when it is an http or https address. */
export function safeUrl(url: string | undefined): string | null {
  if (url === undefined) return null;
  return /^https?:\/\//i.test(url.trim()) ? url.trim() : null;
}

/* ---------- mount ---------- */

export function lagLine(lagSeconds: number | undefined): string {
  if (lagSeconds === undefined) return "";
  if (lagSeconds < 5) return "In sync";
  if (lagSeconds < 90) return `${Math.round(lagSeconds)} s behind`;
  return `${Math.round(lagSeconds / 60)} min behind`;
}

export function mountTitle(name: string, provider: string): string {
  return `Mounted ${name} from ${provider}`;
}

/* ---------- record card ---------- */

/** A field value as the card shows it: text as is, a list joined, an object as nothing a person can read (left out). */
export function fieldText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map((v) => fieldText(v)).filter((v) => v !== "").join(", ");
  return "";
}

export function visibleFields<F extends { key: string; title: string; value: unknown }>(fields: readonly F[], max = 4): (F & { text: string })[] {
  const out: (F & { text: string })[] = [];
  for (const field of fields) {
    const text = fieldText(field.value);
    if (text === "") continue;
    out.push({ ...field, text });
    if (out.length === max) break;
  }
  return out;
}

export type { Block };
