// tasks.act: device-bound approval token, and stuck-task detection (ARCH 4.7, spec 2.8).
import { applyTransition, type Actor, type Policy, type Task, type TaskState } from './state.ts';

export class TaskErr extends Error {
  error: { code: string; message: string; traceId: string; retryable: boolean; next: [] };
  constructor(code: string, message: string, traceId = '0'.repeat(32)) {
    super(message);
    this.name = 'TaskErr';
    this.error = { code, message, traceId, retryable: false, next: [] };
  }
}

const SECRET = 'tasks-device-token-v1';

/** Stable short hash. Not a secrecy primitive: the mac folds in SECRET so a copied hash is not a token. */
export function hashPayload(text: string): string {
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h * 33) ^ text.charCodeAt(i)) >>> 0;
  return h.toString(16).padStart(8, '0');
}

export function sealOf(task: Pick<Task, 'kind' | 'title' | 'assigned' | 'blocks'>): string {
  return hashPayload(`${task.kind}|${task.title}|${task.assigned.kind}:${task.assigned.id}|${JSON.stringify(task.blocks)}`);
}

export interface TokenParts { deviceId: string; taskId: string; payloadHash: string; expiresAt: number }

export function mintDeviceToken(p: TokenParts): string {
  const mac = hashPayload([p.deviceId, p.taskId, p.payloadHash, String(p.expiresAt), SECRET].join('|'));
  return ['dtok', p.deviceId, p.taskId, p.payloadHash, String(p.expiresAt), mac].join('.');
}

export type TokenVerdict = 'ok' | 'expired' | 'mismatch';

export function verifyDeviceToken(token: string, expect: TokenParts & { now: number }): TokenVerdict {
  const parts = token.split('.');
  if (parts.length !== 6 || parts[0] !== 'dtok') return 'mismatch';
  const deviceId = parts[1] ?? '';
  const taskId = parts[2] ?? '';
  const payloadHash = parts[3] ?? '';
  const expRaw = parts[4] ?? '';
  const mac = parts[5] ?? '';
  const expiresAt = Number(expRaw);
  if (!Number.isInteger(expiresAt)) return 'mismatch';
  const want = hashPayload([deviceId, taskId, payloadHash, String(expiresAt), SECRET].join('|'));
  if (want !== mac) return 'mismatch';
  if (expiresAt <= expect.now) return 'expired';
  if (deviceId !== expect.deviceId || taskId !== expect.taskId || payloadHash !== expect.payloadHash) return 'mismatch';
  return 'ok';
}

export interface ActInput {
  action: string;
  note?: string;
  answer?: unknown;
  token: string;
  deviceId: string;
  now: number;
  actor: Actor;
  policy: Policy;
  traceId?: string;
}

/** Act at the source. The token is bound to the device, the task and the payload hash, and it expires. */
export function actOnTask(task: Task, input: ActInput): { task: Task; effect: string; result: Record<string, unknown> } {
  const trace = input.traceId ?? '0'.repeat(32);
  if (!input.token) throw new TaskErr('validation.precondition_failed', 'A device-bound token is required.', trace);
  const payloadHash = task.payloadHash ?? sealOf(task);
  const deviceId = input.deviceId;
  if (task.boundDevice && task.boundDevice !== deviceId) {
    throw new TaskErr('validation.precondition_failed', 'The token device does not match this task.', trace);
  }
  const verdict = verifyDeviceToken(input.token, { deviceId, taskId: task.id, payloadHash, expiresAt: 0, now: input.now });
  if (verdict === 'expired') throw new TaskErr('permission.expired', 'The approval token expired.', trace);
  if (verdict !== 'ok') throw new TaskErr('validation.precondition_failed', 'The approval token does not match this task.', trace);

  const out = applyTransition(task, input.action, { note: input.note, actor: input.actor, policy: input.policy, now: input.now });
  if (!out.ok) throw new TaskErr('validation.precondition_failed', `Illegal transition ${task.state} via ${input.action}.`, trace);
  const next = out.task;
  if ((next.assigned.kind === 'group' || next.assigned.kind === 'role' || next.approver?.kind === 'role' || next.reviewer?.kind === 'role') && !task.takenBy) {
    next.takenBy = input.actor.kind === 'person' ? input.actor.id : next.takenBy;
    next.workingNotes = { ...next.workingNotes, handled_by: input.actor.id };
  }
  const continued = next.state === 'done' && (task.source?.kind === 'chat' || task.source?.kind === 'run');
  const result: Record<string, unknown> = { continued };
  if (input.answer !== undefined) result.answer = input.answer;
  if (task.source) result.source = task.source;
  return { task: next, effect: out.action, result };
}

/** A task that can no longer move on its own: expired token window, review loop exhausted on an agent, or overdue with no progress. */
export function isStuck(task: Task, now: number, policy: Policy): boolean {
  if (task.state === 'done' || task.state === 'canceled') return false;
  if (task.snoozedUntil !== undefined && task.snoozedUntil > now) return false;
  if (task.expiresAt !== undefined && task.expiresAt <= now) return true;
  if (task.state === 'in_review' && task.reviewer?.kind === 'agent' && task.reviewLoops >= policy.reviewLoopLimit) return true;
  if (task.due !== undefined && task.due < now && task.updatedAt <= task.due) return true;
  if (task.kind === 'signature' && task.state === 'doing' && task.expiresAt === undefined && now - task.updatedAt >= 7 * 86_400_000) return true;
  return false;
}

export function stuckTasks(tasks: readonly Task[], now: number, policy: Policy): Task[] {
  return tasks.filter((t) => isStuck(t, now, policy));
}

export function isTerminal(state: TaskState): boolean {
  return state === 'done' || state === 'canceled';
}
