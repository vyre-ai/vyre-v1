// goals (lane L6): an agent owns an outcome. A Goal has a finish line read from a real source, a lead agent, helpers, a plan made of tasks, a budget, a check-in rhythm and a status.
// The plan is tasks (the one task object, its slots and its baton): the goal's root task is the parent of every task in the plan. Wake-ups are goal.woken events the engine turns into a turn of the
// lead agent in the goal's own chat, for the goal's owner, on the owner's account and placement. Outward acts follow the Gate: the standing permissions the owner pressed for are grants of kind goal.
// DECISION: progress is read from the source by this module (records count, a connection read, an outside MCP read, an automation's output, a number the owner sets, a checklist, or the owner saying done),
//           never from what an agent reports. A source that cannot be read says so on the goal and counts toward stuck.
// DECISION: a goal is not a kernel resource type yet. Capabilities bind to the Space at level member and the handlers decide who sees and changes a goal: its owner, its lead and helpers, people who can
//           see its project, and Space admins. Events go to the participants of the goal's chat.
// DECISION: statuses add draft (an agent drafted it, the owner has not pressed Start) and paused (the owner paused it, or the budget ran out) to the lead's list.
import { block, create, defineManifest, ev, read, t, write } from '../packages/contracts/src/index.ts';
import { id } from './_common.ts';

const goalId = id.goal;
const who = t.obj({ kind: t.enm('person', 'agent', 'group', 'role'), id: t.str({ examples: ['agt_a1b2c3'] }) });
const status = t.enm('draft', 'planning', 'active', 'waiting', 'stuck', 'paused', 'done', 'missed', 'stopped');
const outcome = t.enm('done', 'missed', 'stopped');
const sourceKind = t.enm('records', 'connection', 'mcp', 'automation', 'manual');
const source = t.obj({
  kind: sourceKind,
  label: t.opt(t.str({ examples: ['Luma, Lab 8 registrations'] })),
  // records: a count of a record type, with an optional filter
  type: t.opt(id.recordType), filter: t.opt(t.json()),
  // connection: one read action of a connector on a connection
  connector: t.opt(id.connector), connectionId: t.opt(id.connection), action: t.opt(t.str()), input: t.opt(t.json()),
  // mcp: a tool of an outside MCP server that only reads, called as the lead agent
  server: t.opt(t.str()), tool: t.opt(t.str()),
  // automation: a field of the newest successful run's output
  automationId: t.opt(id.automation),
  // where the number is in what a connection, MCP tool or automation answers: a dotted path ("total", "data.count"), or "length" of a list at that path
  path: t.opt(t.str({ examples: ['meta.total'] })),
});
const item = t.obj({ id: t.str({ minLength: 1, maxLength: 40 }), text: t.str({ minLength: 1 }), taskId: t.opt(id.task), done: t.opt(t.bool()) });
const finish = t.obj({
  kind: t.enm('number', 'checklist', 'owner'),
  line: t.str({ minLength: 1, description: 'The finish line in words', examples: ['Luma registrations for Lab 8 reach 300 by Friday'] }),
  target: t.opt(t.num()), direction: t.opt(t.enm('up', 'down')), unit: t.opt(t.str({ examples: ['registrations'] })),
  source: t.opt(source), items: t.opt(t.arr(item, { maxItems: 50 })),
});
const budget = t.obj({ spendMicros: t.opt(t.int({ minimum: 0, description: 'Spend cap in millionths of a dollar' })), turns: t.opt(t.int({ minimum: 1 })) });
const rhythm = t.obj({ every: t.enm('day', 'hours', 'week'), at: t.opt(t.str({ pattern: '^[0-2][0-9]:[0-5][0-9]$', examples: ['09:00'] })), hours: t.opt(t.int({ minimum: 1, maximum: 168 })), day: t.opt(t.int({ minimum: 0, maximum: 6 })) });
const quiet = t.obj({ from: t.str({ pattern: '^[0-2][0-9]:[0-5][0-9]$', examples: ['22:00'] }), to: t.str({ pattern: '^[0-2][0-9]:[0-5][0-9]$', examples: ['08:00'] }) });
const permission = t.obj({
  act: t.enm('send', 'post', 'push_protected', 'site_promote', 'signature_send'),
  target: t.str({ minLength: 1, description: 'An address, a domain, a capability name, or * for anything the goal reaches', examples: ['mail.send'] }),
  label: t.str({ minLength: 1, examples: ['Send email from the Lab template'] }),
  granted: t.opt(t.bool()),
});
const planChild = t.obj({
  key: t.str({ minLength: 1, maxLength: 60, examples: ['reminder'] }), title: t.str({ minLength: 1 }),
  why: t.str({ minLength: 1, description: 'Why this step, in one line: what you learned that says it will move the number', examples: ['Lab 7 attendees registered at 31% after one reminder last time'] }),
  impact: t.opt(t.str({ description: 'What it should do to the number', examples: ['+40 to +60 registrations'] })),
  brief: t.opt(t.str()), doneMeans: t.opt(t.arr(t.str({ minLength: 1 }), { maxItems: 20 })),
  assigned: who, reviewer: t.opt(who), approver: t.opt(who), dependsOn: t.opt(t.arr(t.str(), { maxItems: 50 })), due: t.opt(t.ts()),
});
const retro = t.obj({
  summary: t.str({ minLength: 1, maxLength: 800 }), worked: t.arr(t.str(), { maxItems: 10 }), didNot: t.arr(t.str(), { maxItems: 10 }),
  playbook: t.opt(t.str({ maxLength: 4000, description: 'Steps worth repeating, written so a skill can be made of them' })),
});
const pastGoal = t.obj({ goalId, title: t.str(), line: t.str(), ended: t.opt(outcome), value: t.opt(t.num()), target: t.opt(t.num()), endedAt: t.opt(t.ts()), retro: t.opt(retro) });
const reading = t.obj({ at: t.ts(), value: t.opt(t.num()), ok: t.bool(), error: t.opt(t.str()) });
const progress = t.obj({
  value: t.opt(t.num()), target: t.opt(t.num()), start: t.opt(t.num()), percent: t.opt(t.int({ minimum: 0, maximum: 100 })), readAt: t.opt(t.ts()), error: t.opt(t.str()),
  itemsDone: t.opt(t.int()), items: t.opt(t.int()), tasksDone: t.int(), tasks: t.int(),
});
const goalRow = t.obj({
  id: goalId, title: t.str(), outcome: t.opt(t.str()), finish, deadline: t.ts(), owner: id.user, leadAgentId: id.agent, helpers: t.arr(who),
  projectId: t.opt(id.project), recordIds: t.arr(id.record), budget, rhythm, zone: t.str({ examples: ['Asia/Karachi'] }), quiet: t.nullable(quiet), permissions: t.arr(permission),
  status, statusReason: t.opt(t.str()), threadId: t.opt(id.thread), rootTaskId: t.opt(id.task), folderId: t.opt(id.folder), progress, nextCheckinAt: t.opt(t.ts()), lastCheckinAt: t.opt(t.ts()), checkins: t.int(),
  spentMicros: t.int(), turns: t.int(), stuckAfter: t.int({ minimum: 1 }), endedAt: t.opt(t.ts()), ended: t.opt(outcome), summary: t.opt(t.str()), retro: t.opt(retro),
  createdBy: t.str(), createdAt: t.ts(), updatedAt: t.ts(),
});
const goalLine = t.obj({
  id: goalId, title: t.str(), status, statusReason: t.opt(t.str()), owner: id.user, leadAgentId: id.agent, threadId: t.opt(id.thread), deadline: t.ts(), nextCheckinAt: t.opt(t.ts()),
  progress, projectId: t.opt(id.project), updatedAt: t.ts(),
});
const taskLine = t.obj({ taskId: id.task, key: t.opt(t.str()), title: t.str(), state: t.str(), assigned: t.opt(who), blocked: t.bool() });
const waitLine = t.obj({ taskId: id.task, kind: t.str(), title: t.str(), assigned: t.opt(who), since: t.ts() });
const activity = t.obj({ at: t.ts(), kind: t.str({ examples: ['reading'] }), text: t.str(), by: t.opt(t.str()), ref: t.opt(t.str()) });
const wakeReason = t.str({ examples: ['checkin'] });
// every change to a goal can move its status, read its source, send a wake-up or end it, so every write declares the goal's events
const EMITS = ['goal.created', 'goal.started', 'goal.updated', 'goal.status_changed', 'goal.progress', 'goal.woken', 'goal.resumed', 'goal.reported', 'goal.step_done', 'goal.budget_warned', 'goal.ended', 'goal.extended'];
const target = { goalId };
const thr = { threadId: id.thread };

export default defineManifest({
  id: 'goals',
  title: 'Goals',
  owner: 'L6',
  events: [
    ev('goal.created', 'A goal was created, as a draft for its owner to start or started at once', { p: { ...target, ...thr, title: t.str(), owner: id.user, leadAgentId: id.agent, status }, subject: ['thread', '/threadId'], vis: 'participants', label: 'subject', trigger: { title: 'A goal is created', fields: [] } }),
    ev('goal.started', 'The owner started a goal: its standing permissions hold from now', { p: { ...target, ...thr, by: t.str() }, subject: ['thread', '/threadId'], vis: 'participants', label: 'subject' }),
    ev('goal.updated', 'Fields of a goal changed (finish line, deadline, budget, rhythm, helpers, links, permissions)', { p: { ...target, ...thr, fields: t.arr(t.str()), by: t.str() }, subject: ['thread', '/threadId'], vis: 'participants', label: 'subject' }),
    ev('goal.status_changed', 'A goal changed status', { p: { ...target, ...thr, from: status, to: status, reason: t.opt(t.str()) }, subject: ['thread', '/threadId'], vis: 'participants', label: 'subject', trigger: { title: 'A goal changes status', fields: ['/to'] } }),
    ev('goal.progress', 'The source of a goal was read', { p: { ...target, ...thr, ok: t.bool(), value: t.opt(t.num()), prev: t.opt(t.num()), target: t.opt(t.num()), error: t.opt(t.str()) }, subject: ['thread', '/threadId'], vis: 'participants', label: 'subject', trigger: { title: 'A goal moves', fields: [] } }),
    ev('goal.woken', 'The lead agent of a goal is due a turn in the goal chat (check-in, a task done, the number moved, an answer)', {
      p: { ...target, ...thr, wakeId: t.str(), attempt: t.int({ minimum: 1 }), reason: wakeReason, leadAgentId: id.agent, owner: id.user }, subject: ['thread', '/threadId'], vis: 'participants', label: 'subject',
    }),
    ev('goal.resumed', 'A paused goal goes on: the work its agents hold may wake again', { p: { ...target, ...thr, taskIds: t.arr(id.task), by: t.str() }, subject: ['thread', '/threadId'], vis: 'participants', label: 'subject' }),
    ev('goal.reported', 'The lead agent posted a goal update', { p: { ...target, ...thr, wakeId: t.opt(t.str()), by: t.str() }, subject: ['thread', '/threadId'], vis: 'participants', label: 'subject' }),
    ev('goal.step_done', 'A step of a goal finished; a retried wake-up will not do it again', { p: { ...target, ...thr, stepId: t.str(), by: t.str() }, subject: ['thread', '/threadId'], vis: 'participants', label: 'subject' }),
    ev('goal.budget_warned', 'A goal used 80 percent of its budget', { p: { ...target, ...thr, spentMicros: t.int(), turns: t.int(), budget }, subject: ['thread', '/threadId'], vis: 'participants', label: 'subject' }),
    ev('goal.ended', 'A goal ended: done, missed or stopped, with its summary', { p: { ...target, ...thr, outcome, summary: t.str() }, subject: ['thread', '/threadId'], vis: 'participants', label: 'subject', trigger: { title: 'A goal ends', fields: ['/outcome'] } }),
    ev('goal.extended', 'The deadline of a goal moved', { p: { ...target, ...thr, deadline: t.ts(), by: t.str() }, subject: ['thread', '/threadId'], vis: 'participants', label: 'subject' }),
  ],
  capabilities: [
    create('goals.create', 'Give an agent a goal with a finish line: it plans the work as tasks, works across days, posts progress, asks for approvals and says when it is stuck. Drafted by an agent, it waits for its owner to press Start', {
      in: {
        title: t.str({ minLength: 1, maxLength: 140 }), outcome: t.opt(t.str()), finish, deadline: t.ts(), owner: t.opt(id.user), leadAgentId: id.agent, helpers: t.opt(t.arr(who, { maxItems: 20 })),
        projectId: t.opt(id.project), recordIds: t.opt(t.arr(id.record, { maxItems: 50 })), budget: t.opt(budget), rhythm: t.opt(rhythm), quiet: t.opt(t.nullable(quiet)), zone: t.opt(t.str()),
        permissions: t.opt(t.arr(permission, { maxItems: 10 })), plan: t.opt(t.arr(planChild, { maxItems: 50 })), stuckAfter: t.opt(t.int({ minimum: 1, maximum: 20 })),
        sourceThreadId: t.opt(id.thread), start: t.opt(t.bool()),
      },
      out: { goal: goalRow, overlaps: t.arr(t.obj({ goalId, title: t.str(), recordId: id.record })) }, level: 'member',
      emits: EMITS, tool: 'tasks', mcpName: 'goals_create', cli: 'vyre goals create',
      errors: ['validation.precondition_failed', 'validation.not_found'],
    }),
    write('goals.confirm', 'Start a drafted goal: the owner presses Start on its card. The standing permissions it names hold from this press', {
      in: { ...target, permissions: t.opt(t.arr(t.str(), { description: 'The labels of the permissions to grant; all when omitted' })) }, out: { goal: goalRow }, level: 'member',
      emits: EMITS, tool: 'tasks', errors: ['validation.precondition_failed', 'validation.not_found'],
    }),
    read('goals.get', 'One goal: its finish line and progress, the plan as tasks, who is helping, what waits on whom, budget used and the latest activity', {
      in: target, out: { goal: goalRow, tasks: t.arr(taskLine), waiting: t.arr(waitLine), activity: t.arr(activity), readings: t.arr(reading) }, level: 'member', tool: 'tasks', mcpName: 'goals_get', label: 'check',
      errors: ['validation.not_found'],
    }),
    read('goals.list', 'Goals by scope: mine, the ones I help with, a project, a record, a task, or all I can see', {
      in: { scope: t.enm('mine', 'helping', 'project', 'record', 'task', 'all'), projectId: t.opt(id.project), recordId: t.opt(id.record), taskId: t.opt(id.task), open: t.opt(t.bool()) },
      out: { goals: t.arr(goalLine) }, level: 'member', tool: 'tasks', mcpName: 'goals_list', label: 'filter', cli: 'vyre goals list',
    }),
    read('goals.activity', 'The activity of a goal, newest first: every reading, wake-up, step, task and status change, and why', {
      in: { ...target, before: t.opt(t.ts()), limit: t.opt(t.int({ minimum: 1, maximum: 200 })) }, out: { activity: t.arr(activity) }, level: 'member', tool: 'tasks', errors: ['validation.not_found'],
    }),
    write('goals.update', 'Change a goal: its finish line, deadline, budget, check-in rhythm, quiet hours, helpers, links or standing permissions (only the owner)', {
      in: {
        ...target, title: t.opt(t.str({ minLength: 1, maxLength: 140 })), outcome: t.opt(t.str()), finish: t.opt(finish), deadline: t.opt(t.ts()), budget: t.opt(budget), rhythm: t.opt(rhythm),
        quiet: t.opt(t.nullable(quiet)), zone: t.opt(t.str()), helpers: t.opt(t.arr(who, { maxItems: 20 })), projectId: t.opt(t.nullable(id.project)), recordIds: t.opt(t.arr(id.record, { maxItems: 50 })),
        permissions: t.opt(t.arr(permission, { maxItems: 10 })), stuckAfter: t.opt(t.int({ minimum: 1, maximum: 20 })),
      },
      out: { goal: goalRow }, level: 'member', emits: EMITS, tool: 'tasks', errors: ['validation.precondition_failed', 'validation.not_found'],
    }),
    write('goals.pause', 'Pause a goal: no wake-ups and none of its tasks wake their agents until it is resumed', {
      in: { ...target, reason: t.opt(t.str()) }, out: { goal: goalRow }, level: 'member', emits: EMITS, tool: 'tasks', errors: ['validation.precondition_failed', 'validation.not_found'],
    }),
    write('goals.resume', 'Resume a paused goal', { in: target, out: { goal: goalRow }, level: 'member', emits: EMITS, tool: 'tasks', errors: ['validation.precondition_failed', 'validation.not_found'] }),
    write('goals.stop', 'Stop a goal for good: its open tasks are withdrawn and its permissions end', {
      in: { ...target, reason: t.opt(t.str()) }, out: { goal: goalRow }, level: 'member', emits: EMITS, tool: 'tasks', errors: ['validation.precondition_failed', 'validation.not_found'],
    }),
    write('goals.finish', 'The owner says a goal is done (the finish line of an owner-says-done goal, or done early)', {
      in: { ...target, note: t.opt(t.str()) }, out: { goal: goalRow }, level: 'member', emits: EMITS, tool: 'tasks', errors: ['validation.precondition_failed', 'validation.not_found'],
    }),
    write('goals.extend', 'Move the deadline of a goal; a missed goal starts again', {
      in: { ...target, deadline: t.ts() }, out: { goal: goalRow }, level: 'member', emits: EMITS, tool: 'tasks', errors: ['validation.precondition_failed', 'validation.not_found'],
    }),
    write('goals.progress', 'Where a goal stands: the number from its source, read now when asked, and its history', {
      in: { ...target, refresh: t.opt(t.bool()) }, out: { progress, readings: t.arr(reading) }, level: 'member', tool: 'tasks', mcpName: 'goals_progress_read', emits: EMITS, errors: ['validation.not_found'],
    }),
    write('goals.number.set', 'The owner updates the number of a goal whose source is a number they keep', {
      in: { ...target, value: t.num() }, out: { goal: goalRow }, level: 'member', emits: EMITS, errors: ['validation.precondition_failed', 'validation.not_found'],
    }),
    write('goals.checklist.tick', 'The owner ticks or unticks one condition of a checklist goal', {
      in: { ...target, itemId: t.str(), done: t.bool() }, out: { goal: goalRow }, level: 'member', emits: EMITS, errors: ['validation.precondition_failed', 'validation.not_found'],
    }),
    write('goals.plan', 'Add tasks to the plan of a goal: each with its brief, what done means, who does it (an agent, a person, a group) and what it waits on. They are tasks like any other and show "Part of" the goal', {
      in: { ...target, children: t.arr(planChild, { minItems: 1, maxItems: 50 }) },
      out: { tasks: t.arr(t.obj({ key: t.str(), taskId: id.task, created: t.bool() })) }, level: 'member', emits: EMITS, tool: 'tasks', mcpName: 'goals_plan_update',
      errors: ['validation.precondition_failed', 'validation.not_found'],
    }),
    write('goals.report', 'Post the check-in in the goal chat: the real number against the pace, what changed and why, what was done, the next best step. One per wake-up; short and specific', {
      in: {
        ...target, wakeId: t.opt(t.str()), summary: t.str({ minLength: 1, maxLength: 600 }), done: t.opt(t.arr(t.str(), { maxItems: 10 })), next: t.opt(t.arr(t.str(), { maxItems: 10 })),
      },
      out: { posted: t.bool(), messageId: t.opt(id.message), value: t.opt(t.num()) }, level: 'member', emits: EMITS, tool: 'tasks', mcpName: 'goals_checkin_post',
      errors: ['validation.precondition_failed', 'validation.not_found'],
    }),
    write('goals.ask', 'Ask the owner (or a named person) for a decision only they can make: one Waiting-on item, with the options. The same decision asked again returns the first ask; the answer wakes you', {
      in: {
        ...target, decision: t.str({ minLength: 1, maxLength: 80, description: 'A short id for the decision, so it is never asked twice', examples: ['lab7-reminder-audience'] }),
        question: t.str({ minLength: 1, maxLength: 600 }), options: t.opt(t.arr(t.str({ minLength: 1 }), { maxItems: 6 })), to: t.opt(id.user),
      },
      out: { taskId: id.task, asked: t.bool(), answer: t.opt(t.str()) }, level: 'member', emits: EMITS, tool: 'tasks', mcpName: 'goals_ask',
      errors: ['validation.precondition_failed', 'validation.not_found'],
    }),
    write('goals.mark_stuck', 'Say plainly that the goal cannot move: the reason and two options for the owner. The owner hears once; the goal shows Stuck until the number moves or the owner picks', {
      in: { ...target, reason: t.str({ minLength: 1, maxLength: 400 }), options: t.arr(t.str({ minLength: 1, maxLength: 200 }), { minItems: 2, maxItems: 2 }) },
      out: { goal: goalRow }, level: 'member', emits: EMITS, tool: 'tasks', mcpName: 'goals_mark_stuck', errors: ['validation.precondition_failed', 'validation.not_found'],
    }),
    write('goals.complete', 'When a goal ends (done or missed), write its retrospective: what worked, what did not, and a playbook worth repeating. It is saved to the goal, its project and Space memory. On an owner-says-done goal whose work is finished, it asks the owner to confirm instead', {
      in: { ...target, retro },
      out: { saved: t.bool(), askedOwner: t.bool(), taskId: t.opt(id.task) }, level: 'member', emits: EMITS, tool: 'tasks', mcpName: 'goals_complete',
      errors: ['validation.precondition_failed', 'validation.not_found'],
    }),
    read('goals.search_past', 'Past goals in this Space with their outcome and retrospective, to learn what worked before planning', {
      in: { query: t.opt(t.str()), limit: t.opt(t.int({ minimum: 1, maximum: 20 })) }, out: { goals: t.arr(pastGoal) }, level: 'member', tool: 'tasks', mcpName: 'goals_search_past', label: 'filter',
    }),
    read('goals.sources', 'What a goal could count, for drafting a measurable finish line: record types with their counts, connections, and the outside MCP servers the lead can read', {
      in: { leadAgentId: t.opt(id.agent) },
      out: { records: t.arr(t.obj({ type: t.str(), title: t.str(), count: t.opt(t.int()) })), connections: t.arr(t.obj({ connectionId: t.str(), connector: t.str(), name: t.str() })), mcp: t.arr(t.obj({ server: t.str(), tools: t.arr(t.str()) })) },
      level: 'member', tool: 'tasks', mcpName: 'goals_sources', label: 'check',
    }),
    write('goals.step', 'Before a step with an effect (a send, a post, a record change), claim it by id; a step already done answers done with its result, so a retried wake-up never repeats it. Finish it with finish true', {
      in: { ...target, stepId: t.str({ minLength: 1, maxLength: 120, examples: ['reminder-email-lab7'] }), title: t.opt(t.str()), finish: t.opt(t.bool()), result: t.opt(t.str({ maxLength: 2000 })) },
      out: { state: t.enm('started', 'already_done', 'done'), result: t.opt(t.str()), idempotencyKey: t.str({ description: 'Pass this as the idempotencyKey of the act' }) }, level: 'member',
      emits: EMITS, tool: 'tasks', mcpName: 'goals_step', errors: ['validation.precondition_failed', 'validation.not_found'],
    }),
    write('goals.folder', 'The Files folder of a goal, where its plan, drafts, research and reports go; asking for a subfolder makes it the first time it is needed', {
      in: { ...target, sub: t.opt(t.enm('Plan', 'Drafts', 'Research', 'Reports')) }, out: { folderId: id.folder, path: t.str() }, level: 'member', tool: 'tasks', mcpName: 'goals_folder',
      errors: ['validation.precondition_failed', 'validation.not_found'],
    }),
    read('goals.brief', 'What the lead agent of a goal reads at each wake-up: the finish line and where it stands, why it was woken, the plan, what waits, the budget and the rules', {
      in: { ...target, agentId: t.opt(id.agent) }, out: { text: t.str() }, level: 'member', label: 'check', errors: ['validation.not_found'],
    }),
    write('goals.wake_claim', 'System: the engine claims one wake-up of a goal before it starts the turn, so a wake-up read twice runs once. Only the server may call it', {
      in: { ...target, wakeId: t.str(), attempt: t.int({ minimum: 1 }) }, out: { claimed: t.bool(), threadId: t.opt(id.thread), leadAgentId: t.opt(id.agent), owner: t.opt(id.user) }, level: 'member',
    }),
    read('goals.go', 'System: may the work of a goal wake its agents now (false while it is a draft, paused or ended)', {
      in: target, out: { go: t.bool(), status: t.opt(status) }, level: 'member',
    }),
  ],
  blocks: [
    block('goal', {
      goalId, threadId: id.thread, kind: t.enm('draft', 'update', 'stuck', 'ended'), title: t.str(), line: t.str(), status,
      value: t.opt(t.num()), prev: t.opt(t.num()), target: t.opt(t.num()), unit: t.opt(t.str()), deadline: t.ts(), summary: t.opt(t.str()),
      done: t.opt(t.arr(t.str())), next: t.opt(t.arr(t.str())), needs: t.opt(t.arr(t.str())), plan: t.opt(t.arr(t.str())), permissions: t.opt(t.arr(t.str())), outcome: t.opt(outcome),
    }, 'Goal {{title}}: {{line}}', {
      opens: { tab: 'goal', input: { goalId: '/goalId' } },
      actions: [
        { key: 'start', label: 'Start goal', cap: 'goals.confirm', input: { goalId: '/goalId' } },
        { key: 'extend', label: 'Extend', cap: 'goals.extend', input: { goalId: '/goalId' } },
        { key: 'resume', label: 'Resume', cap: 'goals.resume', input: { goalId: '/goalId' } },
      ],
    }),
  ],
});
