// tasks.act: act at the source, with the approval token kept from the 0.6 tasks idea.
// The token is an HMAC over the canonical payload hash (kernel seal wire) plus the device id and the expiry.
// A token is good for one task, one payload, and one device. Push approve-in-one-tap presents it; a wrong device is refused.
// Stuck tasks are open work that stopped moving: expired approval, a review loop waiting on a person, an idle signature, a long block, or Doing with no update.

import { canonical, hmac, payloadHash, sameMac } from "../../../kernel/src/seal/wire.ts";
import { step } from "./state.ts";
import type { Actor, Party, Policy, StepOk, TaskKind, TaskRecord, TaskState } from "./state.ts";
import { isOpen } from "./state.ts";

export interface TokenClaims {
  taskId: string;
  deviceId: string;
  payloadHash: string;
  exp: number;
}

export interface ActRequest {
  action: string;
  note?: string;
  answer?: unknown;
  approvalToken?: string;
  deviceId?: string;
}

export type ActFailure = { ok: false; code: "validation.precondition_failed" | "permission.expired"; reason: string };

export type ActSuccess = { ok: true; task: TaskRecord; events: StepOk["events"]; result: unknown };

/** Space-namespaced MAC key. The claims still bind device, task, payload hash, and expiry. */
export function approvalKey(space: string): string {
  return `vyre.tasks.approval.${space}`;
}

/** Hash of the preview a person approves. Nested fields, so a field named op cannot stand in for the op. */
export function approvalHash(space: string, parts: {
  kind: string;
  title: string;
  blocks: unknown;
  assigned: Party;
  source: { kind: string; id: string } | null;
}): string {
  return payloadHash("tasks.approve", space, {
    assigned: parts.assigned,
    blocks: parts.blocks,
    kind: parts.kind,
    source: parts.source,
    title: parts.title,
  });
}

export function mintDeviceToken(key: string, claims: TokenClaims): string {
  const body = canonical({
    v: 1,
    taskId: claims.taskId,
    deviceId: claims.deviceId,
    payloadHash: claims.payloadHash,
    exp: claims.exp,
  });
  const mac = hmac(key, body);
  return `${mac}.${Buffer.from(body, "utf8").toString("base64url")}`;
}

export function readDeviceToken(key: string, token: string, now: number): { ok: true; claims: TokenClaims } | ActFailure {
  const dot = token.indexOf(".");
  if (dot <= 0) return { ok: false, code: "validation.precondition_failed", reason: "The approval token is not readable" };
  const mac = token.slice(0, dot);
  const body = Buffer.from(token.slice(dot + 1), "base64url").toString("utf8");
  if (!sameMac(mac, hmac(key, body))) return { ok: false, code: "validation.precondition_failed", reason: "The approval token does not match" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return { ok: false, code: "validation.precondition_failed", reason: "The approval token is not readable" };
  }
  if (!parsed || typeof parsed !== "object") return { ok: false, code: "validation.precondition_failed", reason: "The approval token is not readable" };
  const row = parsed as Record<string, unknown>;
  if (row.v !== 1) return { ok: false, code: "validation.precondition_failed", reason: "The approval token is not readable" };
  if (typeof row.taskId !== "string" || typeof row.deviceId !== "string" || typeof row.payloadHash !== "string" || typeof row.exp !== "number") {
    return { ok: false, code: "validation.precondition_failed", reason: "The approval token is not readable" };
  }
  if (now >= row.exp) return { ok: false, code: "permission.expired", reason: "The approval token expired" };
  return { ok: true, claims: { taskId: row.taskId, deviceId: row.deviceId, payloadHash: row.payloadHash, exp: row.exp } };
}

function refuse(code: ActFailure["code"], reason: string): ActFailure {
  return { ok: false, code, reason };
}

/**
 * Apply one Needs you action. When the caller presents an approval token, it has to match this task,
 * this payload hash, and this device. A bad token does not fall through to the session path.
 */
export function applyAct(task: TaskRecord, input: ActRequest, actor: Actor, policy: Policy, key: string, now: number): ActSuccess | ActFailure {
  if (input.approvalToken) {
    const read = readDeviceToken(key, input.approvalToken, now);
    if (!read.ok) return read;
    if (read.claims.taskId !== task.id) return refuse("validation.precondition_failed", "The approval token is for a different task");
    if (!input.deviceId || read.claims.deviceId !== input.deviceId) return refuse("validation.precondition_failed", "The approval token is bound to another device");
    if (task.payloadHash && read.claims.payloadHash !== task.payloadHash) return refuse("validation.precondition_failed", "The approval token is for a different payload");
  }
  const moved = step(task, input.action, { actor, policy, ...(input.note !== undefined ? { note: input.note } : {}) });
  if (!moved.ok) return refuse(moved.code, moved.reason);
  const next: TaskRecord = { ...task, state: moved.to, reviewLoops: moved.reviewLoops, updatedAt: now, version: task.version + 1 };
  if (moved.takenBy !== undefined) next.takenBy = moved.takenBy;
  const result = input.answer === undefined ? { action: input.action } : { action: input.action, answer: input.answer };
  return { ok: true, task: next, events: moved.events, result };
}

/** 24 hours with no write. Callers can pass a shorter window in tests. */
export const STUCK_IDLE_MS = 24 * 60 * 60 * 1000;

export type StuckReason = "approval_expired" | "review_loop_exhausted" | "signature_waiting" | "blocked" | "idle_doing";

export interface StuckRow {
  id: string;
  state: TaskState;
  kind: TaskKind;
  updatedAt: number;
  expiresAt?: number;
  reviewLoops: number;
  reviewer?: { kind: string };
}

export function stuckReason(task: StuckRow, now: number, policy: Policy, blocked: boolean, idleMs: number = STUCK_IDLE_MS): StuckReason | null {
  if (!isOpen(task.state)) return null;
  const idle = now - task.updatedAt >= idleMs;
  if ((task.state === "awaiting_approval" || task.state === "in_review") && task.expiresAt !== undefined && task.expiresAt <= now) return "approval_expired";
  if (task.state === "in_review" && task.reviewer?.kind === "agent" && task.reviewLoops >= policy.reviewLoopLimit) return "review_loop_exhausted";
  if (task.kind === "signature" && task.state === "doing" && idle) return "signature_waiting";
  if (blocked && idle) return "blocked";
  if (task.state === "doing" && idle) return "idle_doing";
  return null;
}

export function detectStuck<T extends StuckRow>(
  tasks: readonly T[],
  now: number,
  policy: Policy,
  blockedOf: (task: T) => boolean,
  idleMs?: number,
): { taskId: string; reason: StuckReason }[] {
  const out: { taskId: string; reason: StuckReason }[] = [];
  for (const task of tasks) {
    const reason = stuckReason(task, now, policy, blockedOf(task), idleMs);
    if (reason) out.push({ taskId: task.id, reason });
  }
  return out;
}

/**
 * Walk delegate, then the next delegate, then the role. The first party who can act on the source wins.
 * A party who fails the check is skipped, so handing over never widens access.
 */
export function walkDelegates(start: Party, next: (party: Party) => Party | null, canAct: (party: Party) => boolean): Party | null {
  const seen = new Set<string>();
  let cur: Party | null = start;
  while (cur) {
    const key = `${cur.kind}:${cur.id}`;
    if (seen.has(key)) return null;
    seen.add(key);
    if (canAct(cur)) return cur;
    cur = next(cur);
  }
  return null;
}

export function requestKind(kind: TaskKind): boolean {
  return kind === "approve" || kind === "review" || kind === "answer" || kind === "unblock";
}
