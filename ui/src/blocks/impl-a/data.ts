// Block data for the seven part-one types, read from `Block.data` (unknown on the wire) into plain typed shapes.
// The field names are the ones in manifests/chat.ts (generated/registry.json blocks[].data). A field the sender left out
// becomes an empty value, so a card never throws on a thin payload; the block registry already filtered by type@v.

import type { PlanStepData, TerminalCommand, TerminalState, DeployState, QuestionMode } from "./logic.ts";

function rec(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function str(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function num(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

export interface TerminalData {
  terminalId: string;
  title: string;
  hostTitle: string;
  commands: TerminalCommand[];
  tail: string;
  state: TerminalState;
  exitCode: number | null;
  starred: boolean;
}

export function terminalData(data: unknown): TerminalData {
  const d = rec(data);
  const commands = list(d["commands"]).map((c): TerminalCommand => {
    const r = rec(c);
    const exit = r["exitCode"];
    const durationMs = r["durationMs"];
    return {
      command: str(r["command"]),
      exitCode: typeof exit === "number" ? exit : null,
      startedAt: num(r["startedAt"]),
      ...(typeof durationMs === "number" ? { durationMs } : {}),
    };
  });
  const exit = d["exitCode"];
  return {
    terminalId: str(d["terminalId"]),
    title: str(d["title"], "Terminal"),
    hostTitle: str(d["hostTitle"], "this computer"),
    commands,
    tail: str(d["tail"]),
    state: oneOf(d["state"], ["running", "idle", "exited"] as const, "idle"),
    exitCode: typeof exit === "number" ? exit : null,
    starred: d["starred"] === true,
  };
}

export interface ChangesetData {
  changesetId: string;
  folderName: string;
  fileCount: number;
  added: number;
  removed: number;
  state: string;
}

export function changesetData(data: unknown): ChangesetData {
  const d = rec(data);
  return {
    changesetId: str(d["changesetId"]),
    folderName: str(d["folderName"], "this folder"),
    fileCount: num(d["fileCount"]),
    added: num(d["added"]),
    removed: num(d["removed"]),
    state: str(d["state"], "open"),
  };
}

export interface QuestionOption {
  key: string;
  label: string;
  detail?: string;
}

export interface QuestionData {
  prompt: string;
  mode: QuestionMode;
  options: QuestionOption[];
  allowOther: boolean;
  answer: unknown;
  answeredBy: string;
}

export function questionData(data: unknown): QuestionData {
  const d = rec(data);
  const options = list(d["options"]).map((o): QuestionOption => {
    const r = rec(o);
    const detail = r["detail"];
    return { key: str(r["key"]), label: str(r["label"]), ...(typeof detail === "string" ? { detail } : {}) };
  });
  return {
    prompt: str(d["prompt"]),
    mode: oneOf(d["mode"], ["single", "multi", "free"] as const, "single"),
    options,
    allowOther: d["allowOther"] === true,
    answer: d["answer"],
    answeredBy: str(d["answeredBy"]),
  };
}

export interface PlanData {
  title: string;
  state: string;
  steps: PlanStepData[];
  hasDoc: boolean;
}

export function planData(data: unknown): PlanData {
  const d = rec(data);
  const steps = list(d["steps"]).map((s): PlanStepData => {
    const r = rec(s);
    const detail = r["detail"];
    return {
      stepId: str(r["stepId"]),
      text: str(r["text"]),
      state: oneOf(r["state"], ["todo", "doing", "done", "skipped"] as const, "todo"),
      ...(typeof detail === "string" ? { detail } : {}),
    };
  });
  return { title: str(d["title"], "Plan"), state: str(d["state"], "proposed"), steps, hasDoc: str(d["docFileId"]) !== "" };
}

export interface DeployData {
  env: string;
  state: DeployState;
  url: string;
  checks: { name: string; ok: boolean }[];
  canPromote: boolean;
}

export function deployData(data: unknown): DeployData {
  const d = rec(data);
  const checks = list(d["checks"]).map((c) => {
    const r = rec(c);
    return { name: str(r["name"]), ok: r["ok"] === true };
  });
  return {
    env: str(d["env"], "preview"),
    state: oneOf(d["state"], ["queued", "building", "ready", "failed", "stopped"] as const, "queued"),
    url: str(d["url"]),
    checks,
    canPromote: d["canPromote"] === true,
  };
}

export interface MountData {
  name: string;
  provider: string;
  state: string;
  lagSeconds: number | undefined;
}

export function mountData(data: unknown): MountData {
  const d = rec(data);
  const lag = d["lagSeconds"];
  return { name: str(d["name"], "Folder"), provider: str(d["provider"], "a connected account"), state: str(d["state"], "synced"), lagSeconds: typeof lag === "number" ? lag : undefined };
}

export interface RecordCardData {
  title: string;
  type: string;
  status: string;
  summary: string;
  fields: { key: string; title: string; value: unknown }[];
}

export function recordCardData(data: unknown): RecordCardData {
  const d = rec(data);
  const fields = list(d["fields"]).map((f) => {
    const r = rec(f);
    return { key: str(r["key"]), title: str(r["title"]), value: r["value"] };
  });
  return { title: str(d["title"], "Record"), type: str(d["type"]), status: str(d["status"]), summary: str(d["summary"]), fields };
}
