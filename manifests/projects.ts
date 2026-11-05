// projects (lane L3): the built-in Project record type (the template Journeys clone), the system Task record type, the plan, the cascade and project roles (spec 3.4, architecture 4.12 and 7.4).
// DECISION: a project is addressed by projectId (prj_), its resource id; recordId (rec_) is its row in the project record type. Journey-derived types use the same ids.
// DECISION: project roles write grants through access.share with source 'project:<id>' (Lead = manage, Member = edit, Reviewer = view plus edit on tasks assigned to them, Guest = view) and revoke by that source.
// DECISION: stages are an ordered multichoice field on the project; a task keeps its stage key as text, because stages differ per project.
// DECISION: assigned, reviewer and approver are principal strings ('usr_...', 'agt_...', 'grp_...', 'rol_...', 'aut_...'), because a slot may hold a person, agent, group, role or automation.
import { create, defineManifest, ev, field, outward, read, rtype, screen, t, write } from '../packages/contracts/src/index.ts';
import { id, pageIn, pageOut } from './_common.ts';

const role = t.enm('lead', 'member', 'reviewer', 'guest');
const principal = t.str({ description: 'Principal id: person, agent, group, role or automation', examples: ['usr_a1b2c3'] });
const stageKey = t.str({ pattern: '^[a-z][a-z0-9_]*$', examples: ['draft'] });
const proposalId = t.id('csc');

const health = t.enm('on', 'risk', 'off', 'hold', 'done');
const linkKind = t.enm('record', 'file', 'chat', 'task', 'artifact', 'mail_thread', 'calendar_event', 'github.pr', 'github.commit', 'ci.run', 'url');
const linkRow = t.obj({
  linkId: t.str({ examples: ['lnk_a1b2c3'] }), projectId: id.project, kind: linkKind, ref: t.str({ examples: ['vyre-ai/website#12'] }), source: t.enm('manual', 'agent', 'rule'), addedBy: t.str(), ruleId: t.opt(t.str()), addedAt: t.ts(),
  state: t.opt(t.str({ description: 'Read live from the source: a pull request Open, Merged or Closed; an invoice Paid or Overdue; a file when it was last edited' })), label: t.opt(t.str()), url: t.opt(t.str()),
});
const ruleBody = {
  kind: t.enm('repo', 'record_filter', 'email_domain'), repo: t.opt(t.str({ examples: ['vyre-ai/website'] })), recordType: t.opt(id.recordType), field: t.opt(t.str()), equals: t.opt(t.str()), domain: t.opt(t.str({ examples: ['client.com'] })),
};
const ruleRow = t.obj({ ruleId: t.str({ examples: ['rul_a1b2c3'] }), ...ruleBody, by: t.str(), at: t.ts() });
const liveType = t.enm('tasks', 'milestones', 'links', 'records', 'metric', 'ci', 'goal', 'people', 'status');
const liveBody = t.obj({ type: liveType, spec: t.rec(t.json()), view: t.opt(t.enm('list', 'table', 'count', 'cards')) });
const pageBlock = t.obj({ id: t.str({ examples: ['blk_a1b2c3'] }), kind: t.enm('text', 'heading', 'live'), text: t.opt(t.str()), level: t.opt(t.int({ minimum: 1, maximum: 3 })), live: t.opt(liveBody), by: t.opt(t.str()), at: t.opt(t.ts()) });
const pageBlockIn = t.obj({ id: t.opt(t.str()), kind: t.enm('text', 'heading', 'live'), text: t.opt(t.str()), level: t.opt(t.int({ minimum: 1, maximum: 3 })), live: t.opt(liveBody) });
const pageOp = t.obj({
  op: t.enm('insert', 'update', 'move', 'delete', 'set_property'), id: t.opt(t.str({ description: 'The block to change, move or delete' })), after: t.opt(t.str({ description: 'Insert or move after this block id; start or end' })),
  block: t.opt(pageBlockIn), key: t.opt(t.str({ description: 'A custom field of the project, for set_property' })), value: t.opt(t.json()),
});
const pageProp = t.obj({ key: t.str(), title: t.str(), type: t.str(), value: t.opt(t.json()) });
const revRow = t.obj({ rev: t.int({ minimum: 1 }), by: t.str(), authorKind: t.enm('person', 'agent'), summary: t.str(), undoOf: t.opt(t.int()), at: t.ts() });
const pageTemplate = t.obj({ templateId: t.str({ examples: ['tpl_client_account'] }), title: t.str(), summary: t.opt(t.str()), builtin: t.bool(), blocks: t.int({ minimum: 0 }), by: t.str(), at: t.ts() });
const liveRow = t.obj({ id: t.str(), title: t.str(), state: t.opt(t.str()), detail: t.opt(t.str()), url: t.opt(t.str()), who: t.opt(t.str({ description: 'The person or agent a task is assigned to' })), due: t.opt(t.ts()) });
const helperRow = t.obj({
  jobId: t.str(), threadId: id.thread, agentId: id.agent, name: t.opt(t.str()), title: t.str(), state: t.enm('working', 'done', 'needs_you', 'stopped'), startedAt: t.ts(), endedAt: t.opt(t.ts()),
});
const projectRow = t.obj({
  projectId: id.project, recordId: id.record, type: id.recordType, title: t.str(), summary: t.opt(t.str()),
  status: t.str({ examples: ['active'] }), lead: t.opt(principal), start: t.opt(t.ts()), due: t.opt(t.ts()),
  channelId: id.channel, folderId: id.folder, memberCount: t.int({ minimum: 0 }), openTasks: t.int({ minimum: 0 }), lateTasks: t.int({ minimum: 0 }),
  // set only while a manager's override holds: the value, who set it and when ("Set by <name>"); absent means the health is read from the late tasks
  health: t.opt(health), healthSetBy: t.opt(principal), healthSetAt: t.opt(t.ts()),
  archivedAt: t.opt(t.ts({ description: 'Set when the project is archived: it is left out of the lists and still opens' })),
});

const member = t.obj({ principal, role, kind: t.enm('person', 'agent', 'group'), since: t.ts() });
// A teammate is an agent with a role on one project (owner ruling 20 Oct): made by asking any agent with one yes, listed on the project's Teammates tab, and not on the Agents page.
const teammate = t.obj({
  agentId: id.agent, name: t.str(), role, roleLine: t.opt(t.str()), status: t.enm('awake', 'working', 'asleep', 'paused'), madeForProject: t.bool(),
});

const planTask = t.obj({
  taskId: id.task, title: t.str(), stage: t.opt(stageKey), start: t.opt(t.ts()), due: t.opt(t.ts()), milestone: t.bool(),
  status: t.enm('todo', 'doing', 'in_review', 'awaiting_approval', 'done', 'canceled'),
  assigned: t.opt(principal), reviewer: t.opt(principal), approver: t.opt(principal),
  ring: t.opt(t.enm('review', 'approval')), threadId: t.opt(id.thread), order: t.opt(t.num()),
});

const stage = t.obj({ key: stageKey, title: t.str(), order: t.int({ minimum: 0 }) });
const stageIn = t.obj({ key: t.opt(stageKey), title: t.str() });

const move = t.obj({ taskId: id.task, fromStart: t.opt(t.ts()), toStart: t.opt(t.ts()), fromDue: t.opt(t.ts()), toDue: t.opt(t.ts()) });

const createOut = { projectId: id.project, recordId: id.record, channelId: id.channel, folderId: id.folder };

export default defineManifest({
  id: 'projects',
  title: 'Projects',
  owner: 'L3',
  recordTypes: [
    rtype('project', 'Project', 'Projects', 'folder-kanban', [
      field('title', 'text', 'Name', { required: true }),
      field('summary', 'text', 'Summary'),
      field('status', 'status', 'Status', { default: 'planning', options: { stages: [{ key: 'planning', title: 'Planning' }, { key: 'active', title: 'Active' }, { key: 'at_risk', title: 'At risk' }, { key: 'paused', title: 'Paused' }, { key: 'done', title: 'Done' }] } }),
      field('lead', 'person', 'Lead'),
      field('start', 'datetime', 'Start'),
      field('due', 'datetime', 'Due'),
      field('goal', 'longtext', 'Brief and goal'),
      field('status_update', 'longtext', 'Status update'),
      field('status_update_at', 'datetime', 'Updated', { writeOnlyBy: ['projects.post_update'] }),
      field('stages', 'multichoice', 'Stages', { default: [], writeOnlyBy: ['projects.stages.set', 'projects.create'] }),
      field('channel', 'text', 'Channel', { writeOnlyBy: ['projects.create', 'projects.from_channel'] }),
      field('folder', 'text', 'Folder', { writeOnlyBy: ['projects.create', 'projects.from_channel'] }),
      field('pinned_files', 'files', 'Pinned files', { writeOnlyBy: ['projects.pin_file', 'projects.unpin_file'] }),
    ], {
      template: 'project', workspace: true, group: 'Work', statusField: 'status', ownerField: 'lead', summaryField: 'summary',
      views: [
        { key: 'board', kind: 'board', title: 'Board', config: { group: 'status' } },
        { key: 'timeline', kind: 'timeline', title: 'Timeline', config: { start: 'start', end: 'due' } },
      ],
    }),
    rtype('task', 'Task', 'Tasks', 'check-circle', [
      field('title', 'text', 'Title', { required: true }),
      field('summary', 'text', 'Summary'),
      field('why', 'longtext', 'Why'),
      field('kind', 'choice', 'Kind', { default: 'work', options: { choices: [{ key: 'work', title: 'Work' }, { key: 'approve', title: 'Approval' }, { key: 'review', title: 'Review' }, { key: 'answer', title: 'Answer' }, { key: 'unblock', title: 'Unblock' }, { key: 'signature', title: 'Signature' }] } }),
      field('status', 'status', 'Status', { default: 'todo', writeOnlyBy: ['tasks.transition'], options: { stages: [{ key: 'todo', title: 'To do' }, { key: 'doing', title: 'Doing' }, { key: 'in_review', title: 'In review' }, { key: 'awaiting_approval', title: 'Awaiting approval' }, { key: 'done', title: 'Done' }, { key: 'canceled', title: 'Canceled' }] } }),
      field('project', 'relation', 'Project', { options: { target: 'project', inverse: 'tasks' } }),
      field('stage', 'text', 'Stage'),
      field('assigned', 'text', 'Assigned'),
      field('reviewer', 'text', 'Reviewer'),
      field('approver', 'text', 'Approver'),
      field('start', 'datetime', 'Start'),
      field('due', 'datetime', 'Due'),
      field('effort', 'duration', 'Effort'),
      field('milestone', 'checkbox', 'Milestone', { default: false }),
      field('parent', 'relation', 'Parent task', { options: { target: 'task', inverse: 'subtasks' } }),
      field('depends_on', 'relation', 'Depends on', { options: { target: 'task', inverse: 'blocks' } }),
      field('order', 'number', 'Order'),
      field('source', 'text', 'Source'),
      field('thread', 'text', 'Thread'),
      field('attachments', 'files', 'Files'),
      field('notes', 'longtext', 'Working notes'),
    ], { system: true, group: 'Work', statusField: 'status', ownerField: 'assigned', summaryField: 'summary' }),
  ],
  events: [
    ev('project.created', 'A project was made with its channel, folder and empty plan', {
      p: { projectId: id.project, recordId: id.record, type: id.recordType, channelId: id.channel, folderId: id.folder, source: t.enm('new', 'channel', 'journey', 'template') },
      subject: ['project', '/projectId'], label: 'subject', trigger: { title: 'A project is created', fields: ['/type'] },
    }),
    ev('project.member_set', 'A person or agent was given a project role', { p: { projectId: id.project, principal, role, previous: t.opt(role) }, subject: ['project', '/projectId'] }),
    ev('project.member_removed', 'A project role was removed and its grants revoked', { p: { projectId: id.project, principal }, subject: ['project', '/projectId'] }),
    ev('project.stages_changed', 'The stages of a plan changed', { p: { projectId: id.project, stages: t.arr(stageKey) }, subject: ['project', '/projectId'] }),
    ev('project.task_rescheduled', 'A task moved or was resized on the timeline', { p: { projectId: id.project, taskId: id.task, start: t.opt(t.ts()), due: t.opt(t.ts()), slipped: t.bool() }, subject: ['project', '/projectId'], trigger: { title: 'A task date changes', fields: ['/slipped'] } }),
    ev('project.tasks_linked', 'A dependency was added between two tasks', { p: { projectId: id.project, fromTaskId: id.task, toTaskId: id.task }, subject: ['project', '/projectId'] }),
    ev('project.tasks_unlinked', 'A dependency was removed', { p: { projectId: id.project, fromTaskId: id.task, toTaskId: id.task }, subject: ['project', '/projectId'] }),
    ev('project.cascade_proposed', 'The plan proposed moving later tasks after a slip', { p: { projectId: id.project, proposalId, moves: t.int(), by: t.str() }, subject: ['project', '/projectId'] }),
    ev('project.cascade_applied', 'A cascade proposal was applied', { p: { projectId: id.project, proposalId, moved: t.int() }, subject: ['project', '/projectId'] }),
    ev('project.dates_kept', 'A cascade proposal was declined and dates were kept', { p: { projectId: id.project, proposalId }, subject: ['project', '/projectId'] }),
    ev('project.update_posted', 'A status update was posted to the project channel', { p: { projectId: id.project, by: t.str(), drafted: t.bool() }, subject: ['project', '/projectId'] }),
    ev('project.health_set', 'A manager set how the project stands, or went back to the automatic reading', { p: { projectId: id.project, health: t.opt(health), previous: t.opt(health), by: t.str() }, subject: ['project', '/projectId'] }),
    ev('project.update_drafted', 'The status update has a new draft (written from the project facts, or edited in place)', { p: { projectId: id.project, by: t.str() }, subject: ['project', '/projectId'] }),
    ev('project.item_linked', 'Something was linked to a project, by a person, an agent or a rule', { p: { projectId: id.project, linkId: t.str(), kind: linkKind, ref: t.str(), source: t.enm('manual', 'agent', 'rule'), ruleId: t.opt(t.str()), by: t.str() }, subject: ['project', '/projectId'] }),
    ev('project.item_unlinked', 'A link was taken off a project', { p: { projectId: id.project, linkId: t.str(), kind: linkKind, ref: t.str(), by: t.str() }, subject: ['project', '/projectId'] }),
    ev('project.link_rules_set', 'The rules that link matching new items to a project changed', { p: { projectId: id.project, rules: t.int({ minimum: 0 }), by: t.str() }, subject: ['project', '/projectId'] }),
    ev('project.overview_edited', 'The Overview page changed (an edit, a save, an applied template or an undo), by a person or an agent', { p: { projectId: id.project, rev: t.int({ minimum: 1 }), by: t.str(), authorKind: t.enm('person', 'agent'), summary: t.str(), undoOf: t.opt(t.int()) }, subject: ['project', '/projectId'] }),
    ev('project.overview_template_saved', 'A page template was saved for the Space', { p: { projectId: t.str(), templateId: t.str(), title: t.str(), by: t.str() }, subject: ['project', '/projectId'] }),
    ev('project.archived', 'A project was archived: it left the lists and stays readable', { p: { projectId: id.project, by: t.str() }, subject: ['project', '/projectId'], retention: 'audit' }),
    ev('project.unarchived', 'An archived project was brought back to the lists', { p: { projectId: id.project, by: t.str() }, subject: ['project', '/projectId'], retention: 'audit' }),
    ev('project.file_pinned', 'A file was pinned to the Overview', { p: { projectId: id.project, fileId: id.file }, subject: ['project', '/projectId'] }),
    ev('project.file_unpinned', 'A pinned file was removed from the Overview', { p: { projectId: id.project, fileId: id.file }, subject: ['project', '/projectId'] }),
    ev('project.chat_filed', 'A private chat was filed under a project (it stays private)', { p: { projectId: id.project, threadId: id.thread }, subject: ['project', '/projectId'] }),
    ev('project.task_thread_opened', 'A task got its thread in the project channel', { p: { projectId: id.project, taskId: id.task, threadId: id.thread }, subject: ['project', '/projectId'] }),
    ev('project.shared_out', 'A read-only link to the project Overview was made', { p: { projectId: id.project, expiresAt: t.opt(t.ts()) }, subject: ['project', '/projectId'], replay: 'stub' }),
    ev('project.unshared_out', 'A read-only link to the project Overview was revoked', { p: { projectId: id.project }, subject: ['project', '/projectId'], replay: 'stub' }),
  ],
  capabilities: [
    create('projects.create', 'Make a project: the record, exactly one channel and one folder (Projects/<name>), and an empty plan', {
      in: {
        type: id.recordType, title: t.str(), summary: t.opt(t.str()), goal: t.opt(t.str()), lead: t.opt(principal), start: t.opt(t.ts()), due: t.opt(t.ts()),
        stages: t.opt(t.arr(stageIn)), members: t.opt(t.arr(t.obj({ principal, role }))), template: t.opt(t.str({ description: 'Template (Kit) id to copy tasks and stages from' })),
        overviewTemplate: t.opt(t.str({ description: 'Overview page template id (tpl_client_account, tpl_software_project, tpl_hiring, or one saved since): the project starts on that page', examples: ['tpl_software_project'] })),
      },
      out: createOut, make: ['record', '/type'], perm: 'records.create', emits: ['project.created', 'record.created'], tool: 'records', cli: 'vyre projects create',
    }),
    write('projects.from_channel', 'Make this channel a project: create the record and attach the channel, a folder and an empty plan', {
      in: { channelId: id.channel, type: t.opt(id.recordType), title: t.opt(t.str()) }, out: createOut,
      on: ['channel', '/channelId'], perm: 'records.create', level: 'manage', idem: 'key', emits: ['project.created', 'record.created'], tool: 'records',
    }),
    write('projects.files_folder', 'The folder that holds a record\'s files: a project\'s own, else Files > Projects > Record files > the record (made on first use unless create is false, with the record\'s access mirrored onto it)', {
      in: { type: t.opt(id.recordType), recordId: id.record, create: t.opt(t.bool()) }, out: { folderId: t.nullable(id.folder) }, on: ['record', '/recordId'], level: 'use', tool: 'records',
    }),
    read('projects.get', 'Read one project: record fields, channel, folder and counts', { in: { projectId: id.project }, out: { project: projectRow }, on: ['project', '/projectId'], tool: 'records', label: 'check' }),
    read('projects.list', 'List the projects the caller is in (Agents, Projects and Journeys show only those you are in)', {
      in: { type: t.opt(id.recordType), mine: t.opt(t.bool()), status: t.opt(t.str()), archived: t.opt(t.bool({ description: 'true lists the archived projects instead of the others' })), ...pageIn }, out: { projects: t.arr(projectRow), ...pageOut }, tool: 'records', label: 'filter',
    }),
    read('projects.roles_of', 'The projects where one person holds a role, and which role, limited to the projects the asker can see', {
      in: { personId: id.user }, out: { roles: t.arr(t.obj({ projectId: id.project, title: t.str(), role })) }, tool: 'records', label: 'check',
    }),
    read('projects.overview', 'The Overview: brief and goal, status with its update, next three milestones, what is late or waiting, recent decisions, people, linked records, pinned files, recent threads', {
      in: { projectId: id.project },
      out: {
        project: projectRow, goal: t.opt(t.str()), statusUpdate: t.opt(t.obj({ text: t.str(), at: t.ts(), by: t.str(), drafted: t.bool() })),
        updateDraft: t.opt(t.obj({ text: t.str(), at: t.ts(), by: t.str() })),
        milestones: t.arr(planTask), late: t.arr(planTask), waiting: t.arr(planTask),
        decisions: t.arr(t.obj({ decisionId: id.decision, summary: t.str(), at: t.ts() })),
        people: t.arr(member), linked: t.arr(t.obj({ type: id.recordType, recordId: id.record, title: t.str() })),
        pinnedFiles: t.arr(id.file), recentThreads: t.arr(t.obj({ threadId: id.thread, title: t.str(), at: t.ts() })),
      },
      on: ['project', '/projectId'], tool: 'records', label: 'check',
    }),
    read('projects.templates.list', 'Project templates: record types derived from Project and template projects from installed Kits', {
      out: { templates: t.arr(t.obj({ key: t.str(), title: t.str(), type: id.recordType, stages: t.arr(t.str()), source: t.enm('builtin', 'kit') })) }, tool: 'records',
    }),
    // ---- people (project roles map to grants)
    read('projects.members.list', 'List people and agents on a project with their roles', { in: { projectId: id.project }, out: { members: t.arr(member) }, on: ['project', '/projectId'], tool: 'records' }),
    write('projects.members.set', 'Give a person, agent or group a project role: Lead, Member, Reviewer or Guest (an agent with a role is a teammate there)', {
      in: { projectId: id.project, principal, role }, out: { member }, on: ['project', '/projectId'], level: 'manage', idem: 'key', audit: 'always', emits: ['project.member_set'], tool: 'records', errors: ['permission.not_contained'],
    }),
    write('projects.members.remove', 'Remove a project role and revoke its grants by source', {
      in: { projectId: id.project, principal }, out: { removed: t.bool() }, on: ['project', '/projectId'], level: 'manage', audit: 'always', emits: ['project.member_removed'], tool: 'records',
    }),
    // ---- teammates (project-scoped actors)
    read('projects.teammates.list', 'The teammates of a project: agents with a role there, with the lead first. The lead is the default participant in a new chat in the project.', {
      in: { projectId: id.project }, out: { teammates: t.arr(teammate), leadAgentId: t.opt(id.agent) }, on: ['project', '/projectId'], tool: 'records',
    }),
    create('projects.teammates.create', 'Make a teammate for this project: an agent with no computer and a project role (Lead, Member or Reviewer), by one yes; it shows on the Teammates tab, not on the Agents page', {
      in: { projectId: id.project, name: t.str({ examples: ['Security reviewer'] }), role: t.enm('lead', 'member', 'reviewer'), brief: t.opt(t.str({ description: 'The use-me-when line' })) },
      out: { teammate }, on: ['project', '/projectId'], level: 'manage', audit: 'always', emits: ['project.member_set', 'agent.created'], tool: 'records', errors: ['validation.duplicate', 'permission.not_contained'],
    }),
    write('projects.teammates.remove', 'Take a teammate off the project; one made for this project moves to Trash with it', {
      in: { projectId: id.project, agentId: id.agent }, out: { removed: t.bool() }, on: ['project', '/projectId'], level: 'manage', idem: 'key', audit: 'always', emits: ['project.member_removed', 'agent.deleted'], tool: 'records',
    }),
    // ---- plan
    read('projects.plan', 'The plan: stages, tasks, milestones, dependency links and a today marker; one payload for Timeline, Board, List and Calendar', {
      in: { projectId: id.project, stage: t.opt(stageKey), assigned: t.opt(principal) },
      out: { stages: t.arr(stage), tasks: t.arr(planTask), links: t.arr(t.obj({ from: id.task, to: id.task })), today: t.ts() },
      on: ['project', '/projectId'], tool: 'tasks', label: 'filter',
    }),
    write('projects.stages.set', 'Create, rename, reorder or remove the stages of a plan', {
      in: { projectId: id.project, stages: t.arr(stageIn) }, out: { stages: t.arr(stage) }, on: ['project', '/projectId'], emits: ['project.stages_changed', 'record.updated'], tool: 'tasks', errors: ['validation.precondition_failed'],
    }),
    write('projects.reschedule', 'Move a task bar or resize it on the timeline; if it slips, the response carries a cascade proposal', {
      in: { projectId: id.project, taskId: id.task, start: t.opt(t.ts()), due: t.opt(t.ts()), stage: t.opt(stageKey) },
      out: { taskId: id.task, start: t.opt(t.ts()), due: t.opt(t.ts()), proposalId: t.opt(proposalId) },
      on: ['project', '/projectId'], emits: ['project.task_rescheduled', 'project.cascade_proposed', 'record.updated'], tool: 'tasks', offline: 'patch',
    }),
    write('projects.link_tasks', 'Add a dependency arrow between two tasks', {
      in: { projectId: id.project, fromTaskId: id.task, toTaskId: id.task }, out: { ok: t.bool() }, on: ['project', '/projectId'], emits: ['project.tasks_linked', 'record.updated'], tool: 'tasks', errors: ['validation.precondition_failed'],
    }),
    write('projects.unlink_tasks', 'Remove a dependency arrow', {
      in: { projectId: id.project, fromTaskId: id.task, toTaskId: id.task }, out: { ok: t.bool() }, on: ['project', '/projectId'], emits: ['project.tasks_unlinked', 'record.updated'], tool: 'tasks',
    }),
    write('projects.cascade', 'Propose the cascade after something slips: which later tasks move and which dates still hold (an agent may call this too)', {
      in: { projectId: id.project, taskId: id.task, start: t.opt(t.ts()), due: t.opt(t.ts()) },
      out: { proposalId, moves: t.arr(move), holds: t.arr(t.obj({ taskId: id.task, reason: t.str() })), summary: t.str({ examples: ['3 later tasks move, the Tuesday consult still holds'] }) },
      on: ['project', '/projectId'], emits: ['project.cascade_proposed'], tool: 'tasks',
    }),
    write('projects.apply_cascade', 'Apply a cascade proposal, or keep the dates', {
      in: { projectId: id.project, proposalId, decision: t.enm('apply', 'keep') }, out: { moved: t.int() },
      on: ['project', '/projectId'], idem: 'key', emits: ['project.cascade_applied', 'project.dates_kept', 'record.updated'], tool: 'tasks', errors: ['validation.precondition_failed'],
    }),
    write('projects.open_task_thread', 'Open the thread of a task in the project channel (made when someone first speaks about the task)', {
      in: { projectId: id.project, taskId: id.task }, out: { threadId: id.thread }, on: ['project', '/projectId'], emits: ['project.task_thread_opened'], tool: 'tasks',
    }),
    // ---- how it stands, the update's draft, the crew
    write('projects.set', 'Set how the project stands (On track, At risk, Off track, On hold or Done) by hand, or null to go back to the reading from the late tasks; audited, and the Overview says who set it', {
      in: { projectId: id.project, health: t.nullable(health) }, out: { health: t.opt(health), setBy: t.opt(principal), at: t.opt(t.ts()) },
      on: ['project', '/projectId'], level: 'manage', audit: 'always', emits: ['project.health_set'], tool: 'records', errors: ['validation.bad_input'],
    }),
    write('projects.update.draft', 'Draft the status update again from the project facts, on the asker\'s own AI account; it is kept as the draft and posted only by Post', {
      in: { projectId: id.project }, out: { text: t.str(), at: t.ts(), by: t.str() },
      on: ['project', '/projectId'], emits: ['project.update_drafted'], tool: 'records', errors: ['validation.precondition_failed', 'provider.unavailable'],
    }),
    write('projects.update.edit', 'Edit the status update\'s draft in place', {
      in: { projectId: id.project, text: t.str() }, out: { text: t.str(), at: t.ts(), by: t.str() },
      on: ['project', '/projectId'], emits: ['project.update_drafted'], tool: 'records', errors: ['validation.bad_input'],
    }),
    read('projects.crew', 'The helpers working for a project with a live state (Working, Done or Needs you) and what each is on, from the crews of the project\'s chats, and the project\'s teammates', {
      in: { projectId: id.project },
      out: { helpers: t.arr(helperRow), working: t.int({ minimum: 0 }), needsYou: t.int({ minimum: 0 }), teammates: t.arr(teammate) },
      on: ['project', '/projectId'], tool: 'records', label: 'check',
    }),
    read('projects.for_channel', 'The project a channel belongs to, if there is one the caller may see', {
      in: { channelId: id.channel }, out: { projectId: t.opt(id.project), recordId: t.opt(id.record) }, on: ['channel', '/channelId'], tool: 'records', label: 'check',
    }),
    // ---- links
    read('projects.links.list', 'What is linked to a project (records, files, chats, tasks, artifacts, mail threads, calendar events, pull requests, commits, CI runs, web addresses), each with its state read live from the source, and the rules that link by themselves', {
      in: { projectId: id.project, kind: t.opt(linkKind) }, out: { links: t.arr(linkRow), rules: t.arr(ruleRow) }, on: ['project', '/projectId'], tool: 'records', label: 'filter',
    }),
    write('projects.links.link', 'Link something to a project; an agent that may edit the project can too. A web address or CI run may bring its own state, label and address', {
      in: { projectId: id.project, kind: linkKind, ref: t.str({ examples: ['vyre-ai/website#12'] }), state: t.opt(t.str()), label: t.opt(t.str()), url: t.opt(t.str()) }, out: { link: linkRow },
      on: ['project', '/projectId'], idem: 'natural', audit: 'always', emits: ['project.item_linked'], tool: 'records', errors: ['validation.bad_input'],
    }),
    write('projects.links.unlink', 'Take a link off a project; an item a rule linked is remembered as an exception and never comes back by rule', {
      in: { projectId: id.project, kind: linkKind, ref: t.str() }, out: { removed: t.bool() },
      on: ['project', '/projectId'], audit: 'always', emits: ['project.item_unlinked'], tool: 'records',
    }),
    write('projects.links.rules.set', 'Set the rules that link matching new items to the project: a repository, a record filter or an email domain', {
      in: { projectId: id.project, rules: t.arr(t.obj({ ruleId: t.opt(t.str()), ...ruleBody })) }, out: { rules: t.arr(ruleRow) },
      on: ['project', '/projectId'], audit: 'always', emits: ['project.link_rules_set'], tool: 'records', errors: ['validation.bad_input'],
    }),
    // ---- the Overview as a page
    read('projects.overview_doc.get', 'The Overview page: its blocks (text, headings and live blocks that hold only a spec), its revision and the project\'s custom fields for the page header', {
      in: { projectId: id.project }, out: { rev: t.int({ minimum: 0 }), blocks: t.arr(pageBlock), markdown: t.str({ description: 'The page as Markdown for the shared editor: each block led by <!--b:id-->, a live block as one :::live {json} line' }), properties: t.arr(pageProp), updatedBy: t.opt(t.str()), updatedAt: t.opt(t.ts()), latest: t.opt(revRow) },
      on: ['project', '/projectId'], tool: 'records', label: 'check',
    }),
    write('projects.overview_doc.save', 'Save the whole Overview page from the editor, as Markdown (or blocks); baseRev is the revision it was opened at, and a page changed since says so instead of overwriting', {
      in: { projectId: id.project, markdown: t.opt(t.str()), blocks: t.opt(t.arr(pageBlockIn)), baseRev: t.opt(t.int({ minimum: 0 })) }, out: { rev: t.int({ minimum: 1 }), blocks: t.arr(pageBlock), markdown: t.str() },
      on: ['project', '/projectId'], level: 'edit', audit: 'always', emits: ['project.overview_edited'], tool: 'records', errors: ['validation.bad_input', 'validation.precondition_failed'],
    }),
    write('projects.overview_edit', 'Edit the Overview by ops: insert, update, move, delete a block, or set_property on a custom field of the project. One revision for the call, carrying its author; an agent\'s edit leaves one quiet line in the project channel', {
      in: { projectId: id.project, ops: t.arr(pageOp), baseRev: t.opt(t.int({ minimum: 0 })) }, out: { rev: t.int({ minimum: 1 }), summary: t.str(), blocks: t.arr(pageBlock) },
      on: ['project', '/projectId'], level: 'edit', audit: 'always', emits: ['project.overview_edited'], tool: 'records', mcpName: 'overview_edit', errors: ['validation.bad_input', 'validation.not_found', 'validation.precondition_failed'],
    }),
    read('projects.overview_get', 'Read the Overview as Markdown with every block led by its id, the project\'s custom fields and the kinds of live block, so overview_edit can name what to change', {
      in: { projectId: id.project }, out: { rev: t.int({ minimum: 0 }), markdown: t.str(), properties: t.arr(pageProp), liveTypes: t.arr(liveType) },
      on: ['project', '/projectId'], tool: 'records', mcpName: 'overview_get', label: 'check',
    }),
    write('projects.overview_doc.undo', 'Undo the latest change to the Overview: the blocks and any property it set go back as they were; the undo is a revision too', {
      in: { projectId: id.project, rev: t.opt(t.int({ minimum: 1 })) }, out: { rev: t.int({ minimum: 1 }), undid: t.int({ minimum: 1 }), blocks: t.arr(pageBlock) },
      on: ['project', '/projectId'], level: 'edit', audit: 'always', emits: ['project.overview_edited'], tool: 'records', errors: ['validation.precondition_failed'],
    }),
    write('projects.overview_doc.restore', 'Bring an older version of the Overview back: its blocks become the page again, as a new revision (so the restore can be undone)', {
      in: { projectId: id.project, rev: t.int({ minimum: 1 }), baseRev: t.opt(t.int({ minimum: 0 })) }, out: { rev: t.int({ minimum: 1 }), restored: t.int({ minimum: 1 }), blocks: t.arr(pageBlock) },
      on: ['project', '/projectId'], level: 'edit', audit: 'always', emits: ['project.overview_edited'], tool: 'records', errors: ['validation.precondition_failed', 'validation.not_found'],
    }),
    read('projects.overview_doc.history', 'The Overview\'s revisions, newest first, each with who made it and what changed', {
      in: { projectId: id.project, limit: t.opt(t.int({ minimum: 1, maximum: 100 })) }, out: { revisions: t.arr(revRow) }, on: ['project', '/projectId'], tool: 'records', label: 'filter',
    }),
    read('projects.live_block.query', 'Evaluate a live block for the reader: the rows they may open, how many they may not (hidden), and for a metric its value. The block stores only its spec', {
      in: { projectId: id.project, blockId: t.opt(t.str()), type: t.opt(liveType), spec: t.opt(t.rec(t.json())) },
      out: { type: liveType, rows: t.arr(liveRow), hidden: t.int({ minimum: 0 }), total: t.int({ minimum: 0 }), value: t.opt(t.num()), label: t.opt(t.str()), unit: t.opt(t.str({ description: 'The currency code of a sum of a money field (USD)' })), parts: t.opt(t.arr(t.obj({ unit: t.opt(t.str()), value: t.num() }), { description: 'A sum over more than one currency: one total per currency, never added together (value is then left out)' })) },
      on: ['project', '/projectId'], tool: 'records', label: 'check', errors: ['validation.bad_input', 'validation.not_found'],
    }),
    read('projects.overview_doc.templates.list', 'The Space\'s Overview page templates: Client account, Software project and Hiring, and any saved since', {
      out: { templates: t.arr(pageTemplate) }, tool: 'records',
    }),
    write('projects.overview_doc.templates.save', 'Save a page template for the Space, from a project\'s Overview or from blocks; an agent can too', {
      in: { title: t.str(), summary: t.opt(t.str()), projectId: t.opt(id.project), blocks: t.opt(t.arr(pageBlockIn)), templateId: t.opt(t.str()) }, out: { template: pageTemplate },
      audit: 'always', emits: ['project.overview_template_saved'], tool: 'records', errors: ['validation.bad_input'],
    }),
    write('projects.overview_doc.apply_template', 'Put a template\'s blocks on a project\'s Overview, replacing the page (one revision, so Undo brings the old page back)', {
      in: { projectId: id.project, templateId: t.str(), baseRev: t.opt(t.int({ minimum: 0 })) }, out: { rev: t.int({ minimum: 1 }), blocks: t.arr(pageBlock) },
      on: ['project', '/projectId'], level: 'edit', audit: 'always', emits: ['project.overview_edited'], tool: 'records', errors: ['validation.not_found', 'validation.precondition_failed'],
    }),
    // ---- overview upkeep
    write('projects.post_update', 'Post the status update (by the lead, or drafted weekly by an agent) to the project channel and keep it on the Overview', {
      in: { projectId: id.project, text: t.opt(t.str({ description: 'The update; left out, the draft is posted' })), status: t.opt(t.str()) }, out: { postedAt: t.ts() },
      on: ['project', '/projectId'], emits: ['project.update_posted', 'record.updated'], tool: 'records',
    }),
    write('projects.archive', 'Archive a project: it leaves the lists and stays readable, with its record, channel, folder and plan. A manager of the project', {
      in: { projectId: id.project }, out: { archived: t.bool(), changed: t.bool() }, on: ['project', '/projectId'], level: 'manage', audit: 'always', emits: ['project.archived'], tool: 'records', errors: ['validation.not_found', 'permission.no_grant'],
    }),
    write('projects.unarchive', 'Bring an archived project back to the lists', {
      in: { projectId: id.project }, out: { archived: t.bool(), changed: t.bool() }, on: ['project', '/projectId'], level: 'manage', audit: 'always', emits: ['project.unarchived'], tool: 'records', errors: ['validation.not_found', 'permission.no_grant'],
    }),
    write('projects.pin_file', 'Pin a file to the Overview', { in: { projectId: id.project, fileId: id.file }, out: { ok: t.bool() }, on: ['project', '/projectId'], emits: ['project.file_pinned', 'record.updated'], tool: 'records' }),
    write('projects.unpin_file', 'Unpin a file from the Overview', { in: { projectId: id.project, fileId: id.file }, out: { ok: t.bool() }, on: ['project', '/projectId'], emits: ['project.file_unpinned', 'record.updated'], tool: 'records' }),
    write('projects.file_chat', 'File a private chat under the project; it stays private and the agent gets the project memory and folder', {
      in: { projectId: id.project, threadId: id.thread }, out: { ok: t.bool() }, on: ['project', '/projectId'], emits: ['project.chat_filed'], tool: 'records',
    }),
    outward('projects.share_out', 'Make a read-only link to the project Overview for a client; it expires in 30 days unless expiresAt or expiresInDays says otherwise', {
      in: { projectId: id.project, expiresAt: t.opt(t.ts()), expiresInDays: t.opt(t.int({ minimum: 1, maximum: 365 })) }, out: { url: t.str(), expiresAt: t.opt(t.ts()) },
      on: ['project', '/projectId'], perm: 'records.share_external', level: 'manage', gate: { act: 'send', when: "actor.kind != 'person'" }, emits: ['project.shared_out'], tool: 'records',
    }),
    write('projects.unshare_out', 'Revoke a read-only link to the project Overview; the link answers not found at once', {
      in: { projectId: id.project, url: t.str({ examples: ['/share/project/a1b2c3'] }) }, out: { revoked: t.bool() },
      on: ['project', '/projectId'], perm: 'records.share_external', level: 'manage', audit: 'always', emits: ['project.unshared_out'], tool: 'records',
    }),
    read('projects.shared_view', 'System: what a shared link shows a client (title, status, goal, status update, next milestones; no people, threads or files). Only the host calls it, for /share/project/<token>', {
      in: { token: t.str({ examples: ['a1b2c3'] }) },
      out: {
        title: t.str(), status: t.str(), goal: t.opt(t.str()), statusUpdate: t.opt(t.obj({ text: t.str(), at: t.ts() })),
        milestones: t.arr(t.obj({ title: t.str(), due: t.opt(t.ts()), status: t.str() })), expiresAt: t.opt(t.ts()),
      },
      errors: ['validation.not_found'],
    }),
  ],
  screens: [
    screen('records.projects', 'records', 'ui:ProjectsList', {
      q: { projects: ['projects.list', { type: '/state/type', mine: '/state/mine' }], templates: ['projects.templates.list'] },
      a: { create: ['projects.create', { type: '/state/type', title: '/draft/title', template: '/draft/template' }] },
      empty: 'No projects yet', primary: 'New project',
    }),
    screen('records.project-overview', 'records', 'ui:ProjectOverview', {
      q: { overview: ['projects.overview', { projectId: '/state/projectId' }], members: ['projects.members.list', { projectId: '/state/projectId' }] },
      a: {
        postUpdate: ['projects.post_update', { projectId: '/state/projectId', text: '/draft/text', status: '/draft/status' }],
        pin: ['projects.pin_file', { projectId: '/state/projectId', fileId: '/state/fileId' }],
        unpin: ['projects.unpin_file', { projectId: '/state/projectId', fileId: '/state/fileId' }],
        setMember: ['projects.members.set', { projectId: '/state/projectId', principal: '/draft/principal', role: '/draft/role' }],
        removeMember: ['projects.members.remove', { projectId: '/state/projectId', principal: '/state/principal' }, 'Remove this person from the project?'],
        shareOut: ['projects.share_out', { projectId: '/state/projectId' }],
      },
      empty: 'Nothing here yet',
    }),
    screen('records.project-plan', 'records', 'ui:ProjectPlan', {
      q: { plan: ['projects.plan', { projectId: '/state/projectId', stage: '/state/stage', assigned: '/state/assigned' }] },
      a: {
        reschedule: ['projects.reschedule', { projectId: '/state/projectId', taskId: '/state/taskId', start: '/draft/start', due: '/draft/due', stage: '/draft/stage' }],
        link: ['projects.link_tasks', { projectId: '/state/projectId', fromTaskId: '/draft/from', toTaskId: '/draft/to' }],
        unlink: ['projects.unlink_tasks', { projectId: '/state/projectId', fromTaskId: '/draft/from', toTaskId: '/draft/to' }],
        stages: ['projects.stages.set', { projectId: '/state/projectId', stages: '/draft/stages' }],
        cascade: ['projects.cascade', { projectId: '/state/projectId', taskId: '/state/taskId', start: '/draft/start', due: '/draft/due' }],
        resolveCascade: ['projects.apply_cascade', { projectId: '/state/projectId', proposalId: '/state/proposalId', decision: '/draft/decision' }],
        openThread: ['projects.open_task_thread', { projectId: '/state/projectId', taskId: '/state/taskId' }],
      },
      empty: 'No tasks yet', primary: 'Add a task',
    }),
  ],
});
