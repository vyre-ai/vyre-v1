// Inline reducers for task events. Consumers stay empty until the runs lane subscribes.
import { cloneTask, type Task, type TaskState } from './handlers/state.ts';

export function reduceTask(task: Task, event: string, payload: Record<string, unknown>): Task {
  const next = cloneTask(task);
  if (event === 'task.transitioned' && typeof payload.to === 'string') next.state = payload.to as TaskState;
  if (event === 'task.sent_back') {
    next.state = 'doing';
    if (typeof payload.reviewLoops === 'number') next.reviewLoops = payload.reviewLoops;
  }
  if (event === 'task.rejected') next.state = 'doing';
  if (event === 'task.completed' || event === 'task.approved') {
    if (next.state === 'awaiting_approval' || next.state === 'in_review' || next.state === 'doing' || next.state === 'todo') next.state = 'done';
  }
  if (event === 'task.taken' && typeof payload.by === 'string') next.takenBy = payload.by;
  if (event === 'task.released') next.takenBy = undefined;
  if (event === 'task.snoozed') next.snoozedUntil = typeof payload.until === 'number' ? payload.until : undefined;
  return next;
}

export const inline = { reduceTask };
export const consumers = {};
