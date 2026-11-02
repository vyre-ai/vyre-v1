// tasks (lane L6): the one task primitive (spec 2.8, 4.2), its state machine (4.7), Needs you, My work, Take, delegation.
// The record type `task` is declared by module projects; this module owns the capabilities, events, kinds and the task_meta entity.
// DECISION: `tasks.transition` is the only writer of the status field (writeOnlyBy on the record type). `tasks.act` and the Gate call it.
// DECISION: task events use vis 'participants' (visible to participants and to anyone who sees the parent record, spec 2.8).
// DECISION: the Approve kind lists only the approver slot; a Gate hold resolves its approver and puts it there.
import { create, defineManifest, entity, ev, read, screen, setting, t, taskKind, write } from '../packages/contracts/src/index.ts';
import { id, pageIn, pageOut } from './_common.ts';

const assignee = t.obj({ kind: t.enm('person', 'agent', 'group', 'role', 'automation'), id: t.str({ examples: ['usr_a1b2c3'] }) });
const slot = t.enm('assigned', 'reviewer', 'approver');
const taskState = t.enm('todo', 'doing', 'in_review', 'awaiting_approval', 'done', 'canceled');
const taskKindKey = t.enm('work', 'approve', 'review', 'answer', 'unblock', 'signature');
const blockIn = t.obj({ type: t.str({ examples: ['record_card'] }), v: t.opt(t.int({ minimum: 1 })), data: t.json() });
const source = t.obj({ kind: t.enm('chat', 'run', 'gate', 'journey', 'manual'), id: t.str({ examples: ['run_a1b2c3'] }) });
const action = t.obj({ key: t.str({ examples: ['approve'] }), label: t.str({ examples: ['Approve'] }), note: t.opt(t.enm('required', 'optional')) });

const priority = t.enm('urgent', 'high', 'normal', 'low');
const recur = t.obj({ every: t.enm('day', 'week', 'month'), n: t.opt(t.int({ minimum: 1, maximum: 365 })) });
const fieldValues = t.rec();
const taskRow = t.obj({
  id: id.task, key: t.opt(t.str({ examples: ['VY-123'] })), kind: taskKindKey, title: t.str(), summary: t.opt(t.str()), why: t.opt(t.str()), state: taskState,
  blocked: t.bool(), blocks: t.arr(blockIn), actions: t.arr(action),
  assigned: assignee, reviewer: t.opt(assignee), approver: t.opt(assignee),
  takenBy: t.opt(t.str({ examples: ['usr_a1b2c3'] })), due: t.opt(t.ts()), effort: t.opt(t.int({ minimum: 0, description: 'Minutes' })),
  recordId: t.opt(id.record), fileIds: t.arr(id.file), source: t.opt(source), parentTaskId: t.opt(id.task), dependsOn: t.arr(id.task),
  followers: t.arr(t.str()), workingNotes: t.rec(t.str()), threadId: t.opt(id.thread), reviewLoops: t.int({ minimum: 0 }),
  snoozedUntil: t.opt(t.ts()), createdBy: t.str(), createdAt: t.ts(), updatedAt: t.ts(),
  priority: t.opt(priority), labels: t.opt(t.arr(t.str())), start: t.opt(t.ts()), fields: t.opt(fieldValues), recur: t.opt(recur), workerThread: t.opt(id.thread),
});
// One row of a long list: everything a row, a card or a bar draws, and nothing it does not.
const indexRow = t.obj({
  id: id.task, key: t.opt(t.str()), kind: taskKindKey, title: t.str(), state: taskState, blocked: t.bool(),
  assigned: assignee, reviewer: t.opt(assignee), approver: t.opt(assignee), takenBy: t.opt(t.str()), due: t.opt(t.ts()), start: t.opt(t.ts()), effort: t.opt(t.int({ minimum: 0 })), priority: t.opt(priority), labels: t.arr(t.str()),
  recordId: t.opt(id.record), parentTaskId: t.opt(id.task), dependsOn: t.arr(id.task), threadId: t.opt(id.thread), workerThread: t.opt(id.thread), source: t.opt(source), snoozedUntil: t.opt(t.ts()),
  children: t.opt(t.obj({ total: t.int(), done: t.int() })), createdBy: t.str(), createdAt: t.ts(), updatedAt: t.ts(),
});
const planChild = t.obj({
  key: t.str({ minLength: 1, maxLength: 60, examples: ['draft'] }), title: t.str({ minLength: 1 }), brief: t.opt(t.str()), doneMeans: t.opt(t.arr(t.str({ minLength: 1 }), { maxItems: 20 })),
  assigned: assignee, reviewer: t.opt(assignee), approver: t.opt(assignee), dependsOn: t.opt(t.arr(t.str(), { maxItems: 50 })), due: t.opt(t.ts()), priority: t.opt(priority),
  worker: t.opt(t.enm('thread', 'crew')), projectId: t.opt(id.project),
});
const target = { taskId: id.task };
const baton = t.enm('review', 'approval', 'done');
const readyReason = t.enm('ready', 'due_today', 'overdue', 'blocking');

export default defineManifest({
  id: 'tasks',
  title: 'Tasks',
  owner: 'L6',
  permissions: [],
  entities: [
    entity('task_meta', 'tasks_meta', 'tsk_', {
      kind: 'choice', assigned: 'text', reviewer: 'text', approver: 'text', taken_by: 'person', taken_at: 'datetime',
      snoozed_until: 'datetime', why: 'text', blocks: 'text', source_kind: 'text', source_id: 'text', parent_task: 'text',
      depends_on: 'multichoice', followers: 'multichoice', working_notes: 'text', review_loops: 'number',
      decision_id: 'text', payload_hash: 'text', expires_at: 'datetime', due: 'datetime', effort: 'number', thread_id: 'text',
    }, 'task', { ownerField: 'assigned', sync: { window: { days: 90, recentCount: 500 }, protectedFields: ['kind', 'assigned', 'reviewer', 'approver', 'taken_by', 'decision_id'] } }),
  ],
  events: [
    ev('task.created', 'A task was created', { p: { taskId: id.task, kind: taskKindKey, title: t.str(), assigned: assignee, recordId: t.opt(id.record), source: t.opt(source) }, subject: ['task', '/taskId'], vis: 'participants', label: 'subject', trigger: { title: 'A task is created', fields: ['/kind'] } }),
    ev('task.requested', 'A request (Approve, Review, Answer or Unblock) is waiting on someone', { p: { taskId: id.task, kind: taskKindKey, title: t.str(), assigned: assignee, expiresAt: t.opt(t.ts()) }, subject: ['task', '/taskId'], vis: 'participants', label: 'subject', notify: 'approval.requested' }),
    ev('task.updated', 'Fields of a task changed (title, summary, why, due, effort, blocks, links)', { p: { taskId: id.task, fields: t.arr(t.str()) }, subject: ['task', '/taskId'], vis: 'participants', label: 'subject' }),
    ev('task.assigned', 'A slot (Assigned, Reviewer or Approver) was set or changed', { p: { taskId: id.task, slot, to: t.nullable(assignee), from: t.nullable(assignee) }, subject: ['task', '/taskId'], vis: 'participants', label: 'subject', notify: 'task.assigned', trigger: { title: 'A task is assigned', fields: ['/slot'] } }),
    ev('task.transitioned', 'A task changed status', { p: { taskId: id.task, kind: taskKindKey, from: taskState, to: taskState, note: t.opt(t.str()) }, subject: ['task', '/taskId'], vis: 'participants', label: 'subject', trigger: { title: 'A task changed status', fields: ['/to', '/from', '/kind'] } }),
    ev('task.completed', 'A task reached Done', { p: { taskId: id.task, kind: taskKindKey, recordId: t.opt(id.record), source: t.opt(source) }, subject: ['task', '/taskId'], vis: 'participants', label: 'subject', trigger: { title: 'A task is completed', fields: ['/kind'] } }),
    ev('task.sent_back', 'A reviewer or approver sent work back with a note', { p: { taskId: id.task, by: t.str(), note: t.str(), reviewLoops: t.int() }, subject: ['task', '/taskId'], vis: 'participants', label: 'subject' }),
    ev('task.approved', 'A review or approval was granted', { p: { taskId: id.task, kind: taskKindKey, by: t.str(), forPerson: t.opt(t.str({ description: 'Set when a delegate acted for someone away' })) }, subject: ['task', '/taskId'], vis: 'participants', label: 'subject' }),
    ev('task.rejected', 'An approver rejected the work with a note', { p: { taskId: id.task, by: t.str(), note: t.str() }, subject: ['task', '/taskId'], vis: 'participants', label: 'subject' }),
    ev('task.escalated', 'A task passed to a delegate or role after its timeout', { p: { taskId: id.task, to: assignee, reason: t.enm('timeout', 'manual', 'away') }, subject: ['task', '/taskId'], vis: 'participants', label: 'subject' }),
    ev('task.delegated', 'A task was handed over with a note', { p: { taskId: id.task, from: t.str(), to: assignee, passedTo: assignee }, subject: ['task', '/taskId'], vis: 'participants', label: 'subject' }),
    ev('task.taken', 'A person took a group or role task; it is locked to them', { p: { taskId: id.task, by: t.str() }, subject: ['task', '/taskId'], vis: 'participants', label: 'subject' }),
    ev('task.released', 'A taken task went back to the group or role', { p: { taskId: id.task, by: t.str() }, subject: ['task', '/taskId'], vis: 'participants', label: 'subject' }),
    ev('task.snoozed', 'A request was snoozed until a time', { p: { taskId: id.task, until: t.nullable(t.ts()) }, subject: ['task', '/taskId'], vis: 'participants', label: 'subject' }),
    ev('task.withdrawn', 'A request or a task was withdrawn because its source chat or run stopped, the item changed or someone let it go', { p: { taskId: id.task, note: t.str(), sourceKind: t.opt(t.str()), sourceId: t.opt(t.str()) }, subject: ['task', '/taskId'], vis: 'participants', label: 'subject', trigger: { title: 'A task is withdrawn', fields: [] } }),
    ev('task.ready', 'Everything a task waited on finished, so it can start', { p: { taskId: id.task }, subject: ['task', '/taskId'], vis: 'participants', label: 'subject' }),
    ev('task.children_settled', 'The children of a task need its holder: all finished, or one is blocked or asks', { p: { taskId: id.task, reason: t.enm('finished', 'blocked', 'asked'), childId: t.opt(id.task) }, subject: ['task', '/taskId'], vis: 'participants', label: 'subject' }),
    ev('task.deleted', 'A task was deleted; it can come back with Undo', { p: { taskId: id.task, title: t.str() }, subject: ['task', '/taskId'], vis: 'participants', label: 'subject' }),
    ev('task.restored', 'A deleted task came back', { p: { taskId: id.task }, subject: ['task', '/taskId'], vis: 'participants', label: 'subject' }),
    ev('task.handled', 'A request addressed to a role was resolved by the first action; others see handled by', { p: { taskId: id.task, by: t.str() }, subject: ['task', '/taskId'], vis: 'participants', label: 'subject' }),
    ev('task.note_set', 'A working note (key and value) was written by a person or agent', { p: { taskId: id.task, key: t.str(), by: t.str() }, subject: ['task', '/taskId'], vis: 'participants', label: 'subject' }),
    ev('task.follower_added', 'A follower was added', { p: { taskId: id.task, follower: t.str() }, subject: ['task', '/taskId'], vis: 'participants', label: 'subject' }),
    ev('task.follower_removed', 'A follower was removed', { p: { taskId: id.task, follower: t.str() }, subject: ['task', '/taskId'], vis: 'participants', label: 'subject' }),
    ev('task.link_changed', 'A record or file link, or a dependency, was added or removed', { p: { taskId: id.task, op: t.enm('added', 'removed'), linkKind: t.enm('record', 'file', 'dependency'), linkId: t.str() }, subject: ['task', '/taskId'], vis: 'participants', label: 'subject' }),
  ],
  capabilities: [
    create('tasks.create', 'Create a task of any kind (Work by default); Approve, Review, Answer and Unblock requests come from the Gate, agents and Journeys', {
      in: {
        kind: t.opt(taskKindKey), title: t.str({ minLength: 1 }), summary: t.opt(t.str()), why: t.opt(t.str()), blocks: t.opt(t.arr(blockIn)),
        assigned: assignee, reviewer: t.opt(assignee), approver: t.opt(assignee), due: t.opt(t.ts()), effort: t.opt(t.int({ minimum: 0 })),
        priority: t.opt(priority), labels: t.opt(t.arr(t.str())), start: t.opt(t.ts()), fields: t.opt(fieldValues), recur: t.opt(recur),
        recordId: t.opt(id.record), fileIds: t.opt(t.arr(id.file)), source: t.opt(source), parentTaskId: t.opt(id.task), dependsOn: t.opt(t.arr(id.task)),
        expiresAt: t.opt(t.ts()), actions: t.opt(t.arr(action)),
        notes: t.opt(t.rec(t.str())),   // working notes to start the task with: the brief, what done means, the schema its outputs must match
        decisionId: t.opt(t.str()), payloadHash: t.opt(t.str()),   // the Gate's Approve task keeps the held act's decision and payload hash (working notes decision_id, payload_hash)
      },
      out: { task: taskRow }, make: ['task', '/recordId'], emits: ['task.created', 'task.requested', 'task.assigned'], tool: 'tasks', offline: 'queue', hook: true, cli: 'vyre tasks create',
      errors: ['validation.precondition_failed'],
    }),
    read('tasks.get', 'Read one task with its blocks, slots, links, notes and followers', { in: target, out: { task: taskRow }, on: ['task', '/taskId'], tool: 'tasks', label: 'check', cli: 'vyre tasks get' }),
    read('tasks.list', 'List tasks by scope (mine, assigned by me, following, a record, a run) and filters', {
      in: {
        scope: t.enm('mine', 'assigned_by_me', 'following', 'record', 'run', 'all'), states: t.opt(t.arr(taskState)), kinds: t.opt(t.arr(taskKindKey)),
        recordId: t.opt(id.record), runId: t.opt(id.run), assignee: t.opt(assignee), includeSnoozed: t.opt(t.bool()), ...pageIn,
      },
      out: { tasks: t.arr(taskRow), ...pageOut }, tool: 'tasks', label: 'filter', cli: 'vyre tasks list',
    }),
    read('tasks.needs_you', 'Needs you: my Ready tasks of kind Approve, Review, Answer or Unblock, plus due today, overdue or blocking others', {
      in: { limit: t.opt(t.int({ minimum: 1, maximum: 200 })) },
      out: { items: t.arr(t.obj({ task: taskRow, reason: readyReason, handledBy: t.opt(t.str()) })), total: t.int() },
      tool: 'tasks', label: 'filter', cli: 'vyre tasks needs-you',
    }),
    read('tasks.index', 'The long list of a scope in one read: a light row per task with its rollup, ordered newest first; pass the last rev and an unchanged list answers nothing', {
      in: { scope: t.enm('mine', 'given', 'everyone'), recordId: t.opt(id.record), parentTaskId: t.opt(id.task), done: t.opt(t.bool()), rev: t.opt(t.str()) },
      out: { rev: t.str(), unchanged: t.bool(), rows: t.arr(indexRow), doneThisWeek: t.int(), total: t.int() }, tool: 'tasks', label: 'filter',
    }),
    read('tasks.rev', 'A short mark that changes whenever any task changes, for a screen that holds a long list', { in: {}, out: { rev: t.str() }, tool: 'tasks', label: 'check' }),
    read('tasks.by_key', 'Find a task by its short key, such as VY-123', { in: { key: t.str({ minLength: 3, examples: ['VY-123'] }) }, out: { taskId: t.nullable(id.task) }, tool: 'tasks', label: 'check' }),
    read('tasks.digest', 'What an agent should keep in mind: the task bound to this thread, its parent and siblings in a line each, then its own open tasks, the top five and a count. About 300 tokens; detail stays one tasks_get away', {
      in: { agentId: id.agent, threadId: t.opt(id.thread) }, out: { text: t.str(), hash: t.str(), boundTaskId: t.opt(id.task) }, label: 'check',
    }),
    read('tasks.count_needs_you', 'Count of Ready requests for the rail badge and the Space switcher dot', { in: {}, out: { count: t.int() }, tool: 'tasks' }),
    read('tasks.my_work', 'My work: the full list, with sections Open, Assigned by me, Done', {
      in: { section: t.opt(t.enm('open', 'assigned_by_me', 'done', 'all')), ...pageIn },
      out: { tasks: t.arr(taskRow), counts: t.obj({ open: t.int(), assignedByMe: t.int(), done: t.int() }), ...pageOut }, tool: 'tasks', label: 'filter',
    }),
    write('tasks.update', 'Edit the title, summary, why, due, effort or content blocks of a task, or link its thread when it has none (status goes through tasks.transition)', {
      in: {
        ...target, title: t.opt(t.str()), summary: t.opt(t.str()), why: t.opt(t.str()), due: t.opt(t.nullable(t.ts())), effort: t.opt(t.nullable(t.int())), blocks: t.opt(t.arr(blockIn)), threadId: t.opt(id.thread),
        priority: t.opt(t.nullable(priority)), labels: t.opt(t.arr(t.str())), start: t.opt(t.nullable(t.ts())), fields: t.opt(fieldValues), recur: t.opt(t.nullable(recur)), parentTaskId: t.opt(t.nullable(id.task)), workerThread: t.opt(id.thread),
      },
      out: { task: taskRow }, on: ['task', '/taskId'], emits: ['task.updated'], tool: 'tasks', offline: 'patch',
    }),
    write('tasks.transition', 'Move a task to a new status (the only writer of status); checks the 4.7 state table and the reviewer/approver rules', {
      in: { ...target, to: taskState, note: t.opt(t.str()), expectedFrom: t.opt(taskState) },
      out: { task: taskRow }, on: ['task', '/taskId'], level: 'use', emits: ['task.transitioned', 'task.completed', 'task.sent_back', 'task.approved', 'task.rejected', 'task.updated', 'task.ready', 'task.children_settled'],
      tool: 'tasks', offline: 'queue', hook: true, errors: ['validation.precondition_failed', 'validation.field_locked'],
    }),
    write('tasks.act', 'Act on a request at its source: approve, reject, send back, answer, resolve, with a note; continues the chat or run at once', {
      in: { ...target, action: t.str({ examples: ['approve'] }), note: t.opt(t.str()), answer: t.opt(t.json()), edits: t.opt(t.rec()) },
      out: { task: taskRow, result: t.opt(t.json()) }, on: ['task', '/taskId'], level: 'use',
      emits: ['task.transitioned', 'task.completed', 'task.sent_back', 'task.approved', 'task.rejected', 'task.handled'], tool: 'tasks', offline: 'online',
      errors: ['validation.precondition_failed', 'permission.expired'],
    }),
    write('tasks.submit', 'Hand in your part of a work task with its outputs and a one-line summary; it goes to the Reviewer, else the Approver, else Done', {
      in: { ...target, outputs: t.opt(t.rec()), summary: t.str({ minLength: 1, examples: ['Drafted the letter and checked the dates'] }) },
      out: { task: taskRow, next: baton }, on: ['task', '/taskId'], level: 'use', emits: ['task.transitioned', 'task.completed'],
      tool: 'tasks', mcpName: 'task_submit', offline: 'online', errors: ['validation.precondition_failed'],
    }),
    write('tasks.ask', 'Ask a question while you work on a task: an Answer task opens for the requester or a named person, the work waits, and the answer wakes you', {
      in: { ...target, question: t.str({ minLength: 1, examples: ['Which of the two dates is right?'] }), to: t.opt(assignee) },
      out: { task: taskRow, answerTaskId: id.task }, on: ['task', '/taskId'], level: 'use', emits: ['task.created', 'task.requested', 'task.assigned', 'task.link_changed'],
      tool: 'tasks', mcpName: 'task_ask', offline: 'online', errors: ['validation.precondition_failed'],
    }),
    write('tasks.block', 'Report what is in the way of a task: an Unblock task opens for whoever the task escalates to, and the work waits', {
      in: { ...target, reason: t.str({ minLength: 1, examples: ['I cannot open the client folder'] }) },
      out: { task: taskRow, unblockTaskId: id.task }, on: ['task', '/taskId'], level: 'use', emits: ['task.created', 'task.requested', 'task.assigned', 'task.link_changed'],
      tool: 'tasks', mcpName: 'task_block', offline: 'online', errors: ['validation.precondition_failed'],
    }),
    write('tasks.review', 'Review submitted work: approve it, or send it back with numbered fixes (after the loop limit a person decides)', {
      in: { ...target, verdict: t.enm('approve', 'send_back'), fixes: t.opt(t.arr(t.str({ minLength: 1 }))), note: t.opt(t.str()) },
      out: { task: taskRow, next: t.enm('approval', 'done', 'fixes', 'person') }, on: ['task', '/taskId'], level: 'use',
      emits: ['task.transitioned', 'task.completed', 'task.approved', 'task.sent_back', 'task.assigned'], tool: 'tasks', mcpName: 'task_review', offline: 'online',
      errors: ['validation.precondition_failed'],
    }),
    write('tasks.decide', 'Decide on reviewed work: approve it (Done, held actions release) or reject it with a reason (back to the doer)', {
      in: { ...target, verdict: t.enm('approve', 'reject'), reason: t.opt(t.str()) },
      out: { task: taskRow, next: t.enm('done', 'fixes') }, on: ['task', '/taskId'], level: 'use', emits: ['task.transitioned', 'task.completed', 'task.approved', 'task.rejected'],
      tool: 'tasks', mcpName: 'task_decide', offline: 'online', errors: ['validation.precondition_failed'],
    }),
    write('tasks.assign', 'Set or clear a slot: Assigned, Reviewer or Approver (person, agent, group, role or automation)', {
      in: { ...target, slot, to: t.nullable(assignee) }, out: { task: taskRow }, on: ['task', '/taskId'], emits: ['task.assigned'], tool: 'tasks', offline: 'queue',
      errors: ['validation.precondition_failed'],
    }),
    write('tasks.delegate', 'Hand a request to someone else with a note; never widens access, so it walks the delegate chain to the first who can act', {
      in: { ...target, to: assignee, note: t.opt(t.str()) }, out: { task: taskRow, passedTo: assignee }, on: ['task', '/taskId'], level: 'use', emits: ['task.delegated'], tool: 'tasks',
    }),
    write('tasks.escalate', 'Pass a task to the delegate or role after its timeout (called by the scheduler and the Gate)', {
      in: { ...target, reason: t.enm('timeout', 'manual', 'away') }, out: { task: taskRow }, on: ['task', '/taskId'], emits: ['task.escalated'],
    }),
    write('tasks.snooze', 'Snooze an open task until a time, or clear the snooze with null', {
      in: { ...target, until: t.nullable(t.ts()) }, out: { task: taskRow }, on: ['task', '/taskId'], level: 'use', emits: ['task.snoozed'], tool: 'tasks', offline: 'queue',
    }),
    write('tasks.take', 'Take a group or role task; the first Take locks it and others see taken by', {
      in: target, out: { task: taskRow }, on: ['task', '/taskId'], level: 'use', emits: ['task.taken'], tool: 'tasks', offline: 'online', errors: ['validation.precondition_failed'],
    }),
    write('tasks.release', 'Give a taken task back to its group or role', { in: target, out: { task: taskRow }, on: ['task', '/taskId'], level: 'use', emits: ['task.released'], tool: 'tasks' }),
    create('tasks.plan', 'Break work into tasks in one step: a parent (new, or one that exists) and its children, each with its brief, what done means, who does it and which others it waits on. A child starts by itself when what it waits on is done; the parent hears only when all are done, or one is blocked or asks', {
      in: {
        parentTaskId: t.opt(id.task), parent: t.opt(t.obj({ title: t.str({ minLength: 1 }), brief: t.opt(t.str()), doneMeans: t.opt(t.arr(t.str({ minLength: 1 }), { maxItems: 20 })), assigned: t.opt(assignee), recordId: t.opt(id.record), due: t.opt(t.ts()) })),
        children: t.arr(planChild, { minItems: 1, maxItems: 50 }),
      },
      out: { parent: taskRow, children: t.arr(t.obj({ key: t.str(), taskId: id.task, shortKey: t.opt(t.str()), created: t.bool() })) }, make: ['task', '/parent/recordId'], emits: ['task.created', 'task.assigned', 'task.updated'], tool: 'tasks', mcpName: 'task_plan', offline: 'online',
      errors: ['validation.precondition_failed'],
    }),
    write('tasks.delete', 'Delete a task; Undo brings it back. A held act and a task a Run waits on are canceled instead', {
      in: target, out: { deleted: t.bool() }, on: ['task', '/taskId'], level: 'use', emits: ['task.deleted'], tool: 'tasks', errors: ['validation.precondition_failed'],
    }),
    write('tasks.restore', 'Bring a deleted task back', { in: target, out: { task: taskRow }, on: ['task', '/taskId'], level: 'use', emits: ['task.restored'], tool: 'tasks', errors: ['validation.precondition_failed'] }),
    write('tasks.withdraw', 'Withdraw open requests whose source chat or run stopped or whose item changed, or let one task go, with a note', {
      in: { taskId: t.opt(id.task), sourceKind: t.opt(t.enm('chat', 'run', 'gate', 'journey')), sourceId: t.opt(t.str()), note: t.str() },
      out: { withdrawn: t.int() }, emits: ['task.withdrawn'],
    }),
    write('tasks.followers.add', 'Add a follower; plain @mentions become followers, never tasks', {
      in: { ...target, follower: t.str({ examples: ['usr_a1b2c3'] }) }, out: { task: taskRow }, on: ['task', '/taskId'], emits: ['task.follower_added'], tool: 'tasks', offline: 'patch',
    }),
    write('tasks.followers.remove', 'Remove a follower', {
      in: { ...target, follower: t.str({ examples: ['usr_a1b2c3'] }) }, out: { task: taskRow }, on: ['task', '/taskId'], emits: ['task.follower_removed'], tool: 'tasks', offline: 'patch',
    }),
    write('tasks.working_notes.set', 'Write a working note (key and value) that any person or agent on the task can read', {
      in: { ...target, key: t.str({ minLength: 1 }), value: t.str() }, out: { task: taskRow }, on: ['task', '/taskId'], level: 'use', emits: ['task.note_set'], tool: 'tasks', offline: 'patch',
    }),
    write('tasks.working_notes.delete', 'Delete a working note', { in: { ...target, key: t.str() }, out: { task: taskRow }, on: ['task', '/taskId'], level: 'use', emits: ['task.note_set'], tool: 'tasks', offline: 'patch' }),
    write('tasks.links.add', 'Link a record or a file to a task', {
      in: { ...target, recordId: t.opt(id.record), fileId: t.opt(id.file) }, out: { task: taskRow }, on: ['task', '/taskId'], emits: ['task.link_changed'], tool: 'tasks', offline: 'patch',
    }),
    write('tasks.links.remove', 'Remove a record or file link from a task', {
      in: { ...target, recordId: t.opt(id.record), fileId: t.opt(id.file) }, out: { task: taskRow }, on: ['task', '/taskId'], emits: ['task.link_changed'], tool: 'tasks', offline: 'patch',
    }),
    write('tasks.dependencies.add', 'Make a task wait on another; Blocked is derived from unmet dependencies and open Unblock children', {
      in: { ...target, dependsOnId: id.task }, out: { task: taskRow }, on: ['task', '/taskId'], emits: ['task.link_changed'], tool: 'tasks', errors: ['validation.precondition_failed'],
    }),
    write('tasks.dependencies.remove', 'Remove a dependency', {
      in: { ...target, dependsOnId: id.task }, out: { task: taskRow }, on: ['task', '/taskId'], emits: ['task.link_changed'], tool: 'tasks',
    }),
    read('tasks.history', 'Activity of a task: transitions, hand-overs, notes and sends back, newest first', {
      in: { ...target, ...pageIn }, out: { entries: t.arr(t.obj({ at: t.ts(), type: t.str(), by: t.str(), note: t.opt(t.str()), eventId: id.event })), ...pageOut },
      on: ['task', '/taskId'], tool: 'tasks',
    }),
  ],
  taskKinds: [
    taskKind('work', 'Work', {
      needsYou: false, initial: 'todo', closeOn: 'complete', slots: ['assigned', 'reviewer', 'approver'],
      actions: [
        { key: 'start', label: 'Start', to: 'doing' },
        { key: 'take', label: 'Take', cap: 'tasks.take' },
        { key: 'submit', label: 'Submit' },
        { key: 'complete', label: 'Done', to: 'done' },
        { key: 'cancel', label: 'Cancel', to: 'canceled', note: 'optional' },
        { key: 'reopen', label: 'Reopen', to: 'todo' },
      ],
      blocks: ['checklist', 'record_card', 'file', 'table', 'doc_excerpt'],
    }),
    taskKind('approve', 'Approve', {
      needsYou: true, initial: 'awaiting_approval', closeOn: 'act', slots: ['approver'],
      actions: [
        { key: 'approve', label: 'Approve', to: 'done', note: 'optional' },
        { key: 'reject', label: 'Send back', to: 'doing', note: 'required' },
        { key: 'delegate', label: 'Hand over', cap: 'tasks.delegate', note: 'optional' },
        { key: 'snooze', label: 'Snooze', cap: 'tasks.snooze' },
      ],
      blocks: ['table', 'doc_excerpt', 'diff', 'file', 'record_card', 'deploy', 'form_fields'],
    }),
    taskKind('review', 'Review', {
      needsYou: true, initial: 'in_review', closeOn: 'act', slots: ['reviewer'],
      actions: [
        { key: 'approve', label: 'Looks good', note: 'optional' },
        { key: 'send_back', label: 'Send back', to: 'doing', note: 'required' },
        { key: 'delegate', label: 'Hand over', cap: 'tasks.delegate', note: 'optional' },
        { key: 'snooze', label: 'Snooze', cap: 'tasks.snooze' },
      ],
      blocks: ['changeset', 'diff', 'file', 'doc_excerpt', 'table', 'record_card', 'checklist'],
    }),
    taskKind('answer', 'Answer', {
      needsYou: true, initial: 'todo', closeOn: 'act', slots: ['assigned'],
      actions: [
        { key: 'answer', label: 'Answer', to: 'done', note: 'optional' },
        { key: 'dismiss', label: 'Dismiss', to: 'canceled', note: 'optional' },
        { key: 'delegate', label: 'Hand over', cap: 'tasks.delegate', note: 'optional' },
        { key: 'snooze', label: 'Snooze', cap: 'tasks.snooze' },
      ],
      blocks: ['question', 'form_fields', 'table', 'doc_excerpt', 'record_card'],
    }),
    taskKind('unblock', 'Unblock', {
      needsYou: true, initial: 'todo', closeOn: 'act', slots: ['assigned'],
      actions: [
        { key: 'resolved', label: 'Done, continue', to: 'done', note: 'optional' },
        { key: 'cannot', label: "Can't do this", to: 'canceled', note: 'required' },
        { key: 'delegate', label: 'Hand over', cap: 'tasks.delegate', note: 'optional' },
        { key: 'snooze', label: 'Snooze', cap: 'tasks.snooze' },
      ],
      blocks: ['screenshot', 'access_request', 'secret_input', 'checklist', 'table'],
    }),
    taskKind('signature', 'Signature', {
      needsYou: false, initial: 'doing', closeOn: 'complete', slots: ['assigned'],
      actions: [
        { key: 'cancel', label: 'Cancel the request', to: 'canceled', note: 'optional' },
        { key: 'reopen', label: 'Reopen', to: 'todo' },
      ],
      blocks: ['file', 'record_card'],
    }),
  ],
  settings: [
    setting('tasks.review_loop_limit', 'space', 'Policies', 'Times a reviewer agent may send work back before a person decides', t.int({ minimum: 1, maximum: 10 }), 2),
    setting('tasks.allow_self_review', 'space', 'Policies', 'Allow the reviewer or approver to be the assignee', t.bool(), false),
    setting('tasks.require_human_approver', 'space', 'Policies', 'Approvers must be people, never agents', t.bool(), false, { floorable: true }),
  ],
  screens: [
    screen('tasks.needs-you', 'chats', 'ui:NeedsYou', {
      q: { items: ['tasks.needs_you', { limit: '/state/limit' }, true], count: ['tasks.count_needs_you', {}, true], task: ['tasks.get', { taskId: '/state/selected' }, true] },
      a: {
        act: ['tasks.act', { taskId: '/state/selected', action: '/state/action', note: '/state/note', answer: '/state/answer' }],
        delegate: ['tasks.delegate', { taskId: '/state/selected', to: '/state/delegateTo', note: '/state/note' }],
        snooze: ['tasks.snooze', { taskId: '/state/selected', until: '/state/until' }],
        take: ['tasks.take', { taskId: '/state/selected' }],
      },
      empty: 'Nothing needs you', needs: [],
    }),
    screen('tasks.my-work', 'chats', 'ui:MyWork', {
      q: { list: ['tasks.my_work', { section: '/state/section' }, true], rev: ['tasks.rev', {}, true], needs: ['tasks.needs_you', { limit: '/state/limit' }, true] },
      a: {
        assign: ['tasks.assign', { taskId: '/state/taskId', slot: '/state/slot', to: '/state/to' }],
        create: ['tasks.create', { kind: '/draft/kind', title: '/draft/title', assigned: '/draft/assigned', recordId: '/draft/recordId' }],
        transition: ['tasks.transition', { taskId: '/state/taskId', to: '/state/to', note: '/state/note' }],
      },
      empty: 'No tasks yet', primary: 'New task',
    }),
    screen('tasks.page', 'chats', 'ui:TaskPage', {
      slot: 'tab',
      q: { task: ['tasks.get', { taskId: '/route/taskId' }, true], activity: ['tasks.history', { taskId: '/route/taskId' }, true] },
      a: {
        transition: ['tasks.transition', { taskId: '/route/taskId', to: '/state/to', note: '/state/note' }],
        act: ['tasks.act', { taskId: '/route/taskId', action: '/state/action', note: '/state/note', answer: '/state/answer' }],
        assign: ['tasks.assign', { taskId: '/route/taskId', slot: '/state/slot', to: '/state/to' }],
        update: ['tasks.update', { taskId: '/route/taskId', title: '/draft/title', summary: '/draft/summary', why: '/draft/why', due: '/draft/due', effort: '/draft/effort' }],
        delegate: ['tasks.delegate', { taskId: '/route/taskId', to: '/state/to', note: '/state/note' }],
        snooze: ['tasks.snooze', { taskId: '/route/taskId', until: '/state/until' }],
        take: ['tasks.take', { taskId: '/route/taskId' }],
        follow: ['tasks.followers.add', { taskId: '/route/taskId', follower: '/state/follower' }],
        note: ['tasks.working_notes.set', { taskId: '/route/taskId', key: '/state/key', value: '/state/value' }],
      },
      empty: 'This task is not available',
    }),
  ],
});
