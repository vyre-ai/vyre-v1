// tasks.act: device-bound approval token, and stuck-task detection.
import test from 'node:test';
import assert from 'node:assert/strict';
import { actOnTask, isStuck, mintDeviceToken, TaskErr, verifyDeviceToken } from '../handlers/act.ts';
import { blankTask, DEFAULT_POLICY } from '../handlers/state.ts';
import { handlers, setDelegateChain, tasksIn, type TaskCtx } from '../impl.ts';

const NOW = 1_760_000_000_000;
const DAY_BEFORE = 86_400_000 + 5;

function ctx(space: string, over: Partial<TaskCtx> = {}): TaskCtx & { events: { name: string; payload: unknown }[] } {
  const events: { name: string; payload: unknown }[] = [];
  return {
    space,
    principal: { kind: 'person', id: 'usr_approver' },
    device: 'dev_phone',
    trace: { traceId: '0123456789abcdef0123456789abcdef' },
    now: () => NOW,
    emit(name, _subject, payload) {
      events.push({ name, payload });
      return { id: 'evt_test' };
    },
    events,
    ...over,
  };
}

test('tasks.act: device-bound token approves, and a bad device or an expired token does not', async () => {
  const c = ctx('spc_act');
  const made = await handlers['tasks.create'](c, {
    kind: 'approve',
    title: 'Ship the change',
    why: 'the diff is the preview',
    assigned: { kind: 'person', id: 'usr_worker' },
    approver: { kind: 'person', id: 'usr_approver' },
    source: { kind: 'run', id: 'run_a1b2c3' },
    blocks: [{ type: 'diff', data: { files: 1 } }],
  }) as { task: { id: string; state: string; workingNotes: Record<string, string> } };
  assert.equal(made.task.state, 'awaiting_approval');
  const hash = made.task.workingNotes.payload_hash!;
  const token = mintDeviceToken({ deviceId: 'dev_phone', taskId: made.task.id, payloadHash: hash, expiresAt: NOW + 60_000 });
  assert.equal(verifyDeviceToken(token, { deviceId: 'dev_phone', taskId: made.task.id, payloadHash: hash, expiresAt: NOW + 60_000, now: NOW }), 'ok');

  const other = mintDeviceToken({ deviceId: 'dev_other', taskId: made.task.id, payloadHash: hash, expiresAt: NOW + 60_000 });
  await assert.rejects(
    () => handlers['tasks.act']({ ...c, device: 'dev_other' }, { taskId: made.task.id, action: 'approve', token: other }),
    (e: unknown) => e instanceof TaskErr && e.error.code === 'validation.precondition_failed',
  );

  const stale = mintDeviceToken({ deviceId: 'dev_phone', taskId: made.task.id, payloadHash: hash, expiresAt: NOW - 1 });
  await assert.rejects(
    () => handlers['tasks.act'](c, { taskId: made.task.id, action: 'approve', token: stale }),
    (e: unknown) => e instanceof TaskErr && e.error.code === 'permission.expired',
  );

  const wrongHash = mintDeviceToken({ deviceId: 'dev_phone', taskId: made.task.id, payloadHash: 'deadbeef', expiresAt: NOW + 60_000 });
  await assert.rejects(
    () => handlers['tasks.act'](c, { taskId: made.task.id, action: 'approve', token: wrongHash }),
    (e: unknown) => e instanceof TaskErr && e.error.code === 'validation.precondition_failed',
  );

  const acted = await handlers['tasks.act'](c, { taskId: made.task.id, action: 'approve', token }) as { task: { state: string }; result: { continued?: boolean } };
  assert.equal(acted.task.state, 'done');
  assert.equal(acted.result.continued, true);
  assert.ok(c.events.some((e) => e.name === 'task.approved'));
  assert.ok(c.events.some((e) => e.name === 'task.completed'));
});

test('tasks.act: stuck tasks are expired approvals, exhausted agent review loops, and overdue work with no progress', () => {
  const policy = DEFAULT_POLICY;
  const expired = blankTask({
    state: 'awaiting_approval', kind: 'approve', expiresAt: NOW - 5, updatedAt: NOW - 10,
    approver: { kind: 'person', id: 'usr_approver' },
  });
  assert.equal(isStuck(expired, NOW, policy), true);
  const snoozed = blankTask({ ...expired, snoozedUntil: NOW + 5_000 });
  assert.equal(isStuck(snoozed, NOW, policy), false);
  const loop = blankTask({
    state: 'in_review', kind: 'review', reviewLoops: 2, updatedAt: NOW,
    reviewer: { kind: 'agent', id: 'agt_rev' },
  });
  assert.equal(isStuck(loop, NOW, policy), true);
  const fresh = blankTask({ state: 'todo', kind: 'work', due: NOW - DAY_BEFORE, updatedAt: NOW - DAY_BEFORE });
  assert.equal(isStuck(fresh, NOW, policy), true);
  const moved = blankTask({ state: 'todo', kind: 'work', due: NOW - DAY_BEFORE, updatedAt: NOW });
  assert.equal(isStuck(moved, NOW, policy), false);
  const done = blankTask({ state: 'done', kind: 'approve', expiresAt: NOW - 5 });
  assert.equal(isStuck(done, NOW, policy), false);

  const manual = blankTask({
    id: 'tsk_manual', state: 'awaiting_approval', kind: 'approve', payloadHash: 'abc', boundDevice: 'dev_phone',
    approver: { kind: 'person', id: 'usr_approver' },
  });
  const token = mintDeviceToken({ deviceId: 'dev_phone', taskId: manual.id, payloadHash: 'abc', expiresAt: NOW + 1000 });
  const out = actOnTask(manual, {
    action: 'reject', note: 'not yet', token, deviceId: 'dev_phone', now: NOW,
    actor: { kind: 'person', id: 'usr_approver' }, policy, traceId: '0123456789abcdef0123456789abcdef',
  });
  assert.equal(out.task.state, 'doing');
  assert.throws(
    () => actOnTask(manual, { ...{ action: 'reject', note: 'not yet', token, deviceId: 'dev_phone', now: NOW + 5000, actor: { kind: 'person' as const, id: 'usr_approver' }, policy } }),
    (e: unknown) => e instanceof TaskErr && e.error.code === 'permission.expired',
  );
});

test('tasks.act: Needs you, Take lock, delegation that does not widen access, and withdraw', async () => {
  const space = 'spc_queue';
  const approver = ctx(space);
  const created = await handlers['tasks.create'](approver, {
    kind: 'approve', title: 'Approve spend', expiresAt: NOW - 10,
    assigned: { kind: 'person', id: 'usr_worker' },
    approver: { kind: 'person', id: 'usr_approver' },
  }) as { task: { id: string } };
  const due = await handlers['tasks.create'](approver, {
    kind: 'work', title: 'Overdue', due: NOW - DAY_BEFORE,
    assigned: { kind: 'person', id: 'usr_approver' },
  }) as { task: { id: string } };
  const needs = await handlers['tasks.needs_you'](approver, { limit: 20 }) as { total: number; items: { reason: string; task: { id: string } }[] };
  const reasons = new Map(needs.items.map((i) => [i.task.id, i.reason]));
  assert.equal(reasons.get(created.task.id), 'ready');
  assert.equal(reasons.get(due.task.id), 'overdue');
  assert.equal(isStuck(tasksIn(space).find((t) => t.id === created.task.id)!, NOW, DEFAULT_POLICY), true);

  const groupSpace = 'spc_take';
  const a = ctx(groupSpace, { principal: { kind: 'person', id: 'usr_a' } });
  const group = await handlers['tasks.create'](a, {
    kind: 'answer', title: 'Shared', assigned: { kind: 'group', id: 'grp_eng' },
    blocks: [{ type: 'question', data: {} }],
  }) as { task: { id: string } };
  const took = await handlers['tasks.take'](a, { taskId: group.task.id }) as { task: { takenBy?: string } };
  assert.equal(took.task.takenBy, 'usr_a');
  const b = ctx(groupSpace, { principal: { kind: 'person', id: 'usr_b' }, holds: (p) => p.kind === 'group' });
  await assert.rejects(
    () => handlers['tasks.take'](b, { taskId: group.task.id }),
    (e: unknown) => e instanceof TaskErr && e.error.code === 'validation.precondition_failed',
  );
  const seen = await handlers['tasks.needs_you'](b, {}) as { items: { handledBy?: string; task: { id: string } }[] };
  const row = seen.items.find((i) => i.task.id === group.task.id);
  assert.equal(row?.handledBy, 'usr_a');

  const del = ctx('spc_del', { principal: { kind: 'person', id: 'usr_owner' }, canAct: (p) => p.id !== 'usr_no' });
  setDelegateChain('spc_del', 'usr_no', { kind: 'person', id: 'usr_yes' });
  const secret = await handlers['tasks.create'](del, {
    kind: 'answer', title: 'Question', why: 'secret context',
    assigned: { kind: 'person', id: 'usr_owner' },
    blocks: [{ type: 'question', data: { q: 'when' } }],
  }) as { task: { id: string } };
  const handed = await handlers['tasks.delegate'](del, { taskId: secret.task.id, to: { kind: 'person', id: 'usr_no' }, note: 'you take it' }) as { passedTo: { id: string } };
  assert.equal(handed.passedTo.id, 'usr_yes');
  const asDelegate = await handlers['tasks.get']({ ...del, principal: { kind: 'person', id: 'usr_yes' } }, { taskId: secret.task.id }) as { task: { why?: string; blocks: unknown[] } };
  assert.equal(asDelegate.task.why, undefined);
  assert.equal(asDelegate.task.blocks.length, 1);
  const asOwner = await handlers['tasks.get'](del, { taskId: secret.task.id }) as { task: { why?: string } };
  assert.equal(asOwner.task.why, 'secret context');

  const pulled = await handlers['tasks.withdraw'](del, { taskId: secret.task.id, note: 'source stopped' }) as { withdrawn: number };
  assert.equal(pulled.withdrawn, 1);
});
