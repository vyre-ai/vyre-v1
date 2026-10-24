// State-machine property: random event sequences never take an edge outside ARCH 4.7.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyTransition, blankTask, DEFAULT_POLICY, deriveBlocked, decide, responsiblePerson,
  type Actor, type Kind, type Policy, type TaskState,
} from '../handlers/state.ts';

const STATES: TaskState[] = ['todo', 'doing', 'in_review', 'awaiting_approval', 'done', 'canceled'];
const ACTIONS = ['start', 'submit', 'approve', 'send_back', 'reject', 'cancel', 'reopen', 'answer', 'dismiss', 'resolved', 'cannot', 'complete', 'nope'];

/** Every edge the machine is allowed to accept. Anything else is illegal. */
const ALLOWED = new Set([
  'todo|start|doing',
  'todo|submit|in_review',
  'todo|submit|awaiting_approval',
  'todo|submit|done',
  'doing|submit|in_review',
  'doing|submit|awaiting_approval',
  'doing|submit|done',
  'in_review|approve|awaiting_approval',
  'in_review|approve|done',
  'in_review|send_back|doing',
  'awaiting_approval|approve|done',
  'awaiting_approval|reject|doing',
  'todo|cancel|canceled',
  'doing|cancel|canceled',
  'in_review|cancel|canceled',
  'awaiting_approval|cancel|canceled',
  'done|reopen|todo',
  'canceled|reopen|todo',
  'todo|complete|done',
  'doing|complete|done',
  'todo|answer|done',
  'doing|answer|done',
  'todo|dismiss|canceled',
  'doing|dismiss|canceled',
  'in_review|dismiss|canceled',
  'awaiting_approval|dismiss|canceled',
  'todo|resolved|done',
  'doing|resolved|done',
  'todo|cannot|canceled',
  'doing|cannot|canceled',
  'in_review|cannot|canceled',
  'awaiting_approval|cannot|canceled',
]);

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function pick<T>(rand: () => number, xs: readonly T[]): T {
  return xs[Math.floor(rand() * xs.length)]!;
}

const person = (id: string): Actor => ({ kind: 'person', id, super: true });

test('state machine: no illegal transition across random event sequences', () => {
  const rand = rng(0x4a7);
  const kinds: Kind[] = ['work', 'approve', 'review', 'answer', 'unblock', 'signature'];
  for (let n = 0; n < 60; n++) {
    let task = blankTask({
      id: `tsk_p${n}`,
      state: pick(rand, STATES),
      kind: pick(rand, kinds),
      assigned: { kind: 'person', id: 'usr_work' },
      reviewer: rand() < 0.5 ? { kind: rand() < 0.5 ? 'agent' : 'person', id: 'usr_rev' } : undefined,
      approver: rand() < 0.5 ? { kind: 'person', id: 'usr_app' } : undefined,
      reviewLoops: Math.floor(rand() * 4),
    });
    const actor: Actor = rand() < 0.2 ? { kind: 'agent', id: 'agt_rev', super: true } : person('usr_work');
    const policy: Policy = { ...DEFAULT_POLICY, allowSelfReview: rand() < 0.1, reviewLoopLimit: 2 };
    for (let step = 0; step < 40; step++) {
      const action = pick(rand, ACTIONS);
      const note = rand() < 0.7 ? 'note' : '';
      const before = JSON.stringify(task);
      const from = task.state;
      const loops = task.reviewLoops;
      const out = applyTransition(task, action, { note, actor, policy });
      assert.equal(JSON.stringify(task), before, 'a refused or accepted edge must not mutate the input');
      if (!out.ok) continue;
      const edge = `${from}|${action}|${out.task.state}`;
      assert.ok(ALLOWED.has(edge), `illegal transition ${edge} on ${before.kind}`);
      assert.ok(STATES.includes(out.task.state));
      if (action === 'send_back') assert.equal(out.task.reviewLoops, loops + 1);
      else assert.equal(out.task.reviewLoops, loops);
      assert.ok(out.task.reviewLoops >= loops);
      assert.notEqual(out.task.state, 'blocked' as string);
      task = out.task;
    }
  }
});

test('state machine: scripted work path and the review loop stay on the legal table', () => {
  const env = { actor: person('usr_work'), policy: DEFAULT_POLICY, note: 'again' };
  let task = blankTask({
    state: 'todo', kind: 'work',
    assigned: { kind: 'person', id: 'usr_work' },
    reviewer: { kind: 'person', id: 'usr_rev' },
    approver: { kind: 'person', id: 'usr_app' },
  });
  const steps: Array<[string, TaskState]> = [
    ['start', 'doing'],
    ['submit', 'in_review'],
    ['send_back', 'doing'],
    ['submit', 'in_review'],
    ['approve', 'awaiting_approval'],
    ['approve', 'done'],
  ];
  for (const [action, to] of steps) {
    const out = applyTransition(task, action, env);
    assert.equal(out.ok, true, action);
    if (out.ok) {
      assert.equal(out.task.state, to);
      assert.ok(ALLOWED.has(`${task.state}|${action}|${to}`));
      task = out.task;
    }
  }
  assert.equal(task.reviewLoops, 1);

  const agentReview = blankTask({
    state: 'in_review', kind: 'work', reviewLoops: 2,
    reviewer: { kind: 'agent', id: 'agt_rev' },
    approver: { kind: 'person', id: 'usr_app' },
  });
  const refused = decide(agentReview, 'send_back', { ...env, actor: { kind: 'agent', id: 'agt_rev', super: true }, note: 'again' });
  assert.equal(refused, null);
  const personDecides = decide(agentReview, 'send_back', { ...env, note: 'a person decides' });
  assert.equal(personDecides?.to, 'doing');

  const self = blankTask({
    state: 'todo', kind: 'work',
    assigned: { kind: 'person', id: 'usr_work' },
    reviewer: { kind: 'person', id: 'usr_work' },
  });
  assert.equal(decide(self, 'submit', env), null);
  const allowed = decide(self, 'submit', { ...env, policy: { ...DEFAULT_POLICY, allowSelfReview: true } });
  assert.equal(allowed?.to, 'in_review');
});

test('state machine: blocked is derived and the responsible person follows the slot', () => {
  const parent = blankTask({ id: 'tsk_parent', state: 'todo', kind: 'work', dependsOn: ['tsk_dep'] });
  const depOpen = blankTask({ id: 'tsk_dep', state: 'doing', kind: 'work' });
  const depDone = blankTask({ id: 'tsk_dep', state: 'done', kind: 'work' });
  assert.equal(deriveBlocked(parent, [parent, depOpen]), true);
  assert.equal(deriveBlocked(parent, [parent, depDone]), false);
  const child = blankTask({ id: 'tsk_child', state: 'todo', kind: 'unblock', parentTaskId: 'tsk_parent' });
  const clear = blankTask({ id: 'tsk_parent', state: 'todo', kind: 'work' });
  assert.equal(deriveBlocked(clear, [clear, child]), true);
  const finished = blankTask({ id: 'tsk_parent', state: 'done', kind: 'work', dependsOn: ['tsk_dep'] });
  assert.equal(deriveBlocked(finished, [finished, depOpen]), false);

  const group = blankTask({ state: 'todo', kind: 'work', assigned: { kind: 'group', id: 'grp_eng' } });
  assert.equal(responsiblePerson(group), null);
  assert.deepEqual(responsiblePerson({ ...group, takenBy: 'usr_taker' }), { kind: 'person', id: 'usr_taker' });
  const loop = blankTask({
    state: 'in_review', kind: 'review', reviewLoops: 2,
    assigned: { kind: 'person', id: 'usr_work' },
    reviewer: { kind: 'agent', id: 'agt_rev' },
    approver: { kind: 'person', id: 'usr_human' },
  });
  assert.deepEqual(responsiblePerson(loop), { kind: 'person', id: 'usr_human' });
  assert.deepEqual(responsiblePerson({ ...loop, reviewLoops: 1 }), { kind: 'agent', id: 'agt_rev' });
  const role = blankTask({ state: 'awaiting_approval', kind: 'approve', approver: { kind: 'role', id: 'rol_admin' }, assigned: { kind: 'role', id: 'rol_admin' } });
  assert.equal(responsiblePerson(role), null);
});
