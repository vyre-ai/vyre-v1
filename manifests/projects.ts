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

const projectRow = t.obj({
  projectId: id.project, recordId: id.record, type: id.recordType, title: t.str(), summary: t.opt(t.str()),
  status: t.str({ examples: ['active'] }), lead: t.opt(principal), start: t.opt(t.ts()), due: t.opt(t.ts()),
  channelId: id.channel, folderId: id.folder, memberCount: t.int({ minimum: 0 }), openTasks: t.int({ minimum: 0 }), lateTasks: t.int({ minimum: 0 }),
});

const member = t.obj({ principal, role, kind: t.enm('person', 'agent', 'group'), since: t.ts() });

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
      field('kind', 'choice', 'Kind', { default: 'work', options: { choices: [{ key: 'work', title: 'Work' }, { key: 'approve', title: 'Approve' }, { key: 'review', title: 'Review' }, { key: 'answer', title: 'Answer' }, { key: 'unblock', title: 'Unblock' }, { key: 'signature', title: 'Signature' }] } }),
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
    ev('project.file_pinned', 'A file was pinned to the Overview', { p: { projectId: id.project, fileId: id.file }, subject: ['project', '/projectId'] }),
    ev('project.file_unpinned', 'A pinned file was removed from the Overview', { p: { projectId: id.project, fileId: id.file }, subject: ['project', '/projectId'] }),
    ev('project.chat_filed', 'A private chat was filed under a project (it stays private)', { p: { projectId: id.project, threadId: id.thread }, subject: ['project', '/projectId'] }),
    ev('project.task_thread_opened', 'A task got its thread in the project channel', { p: { projectId: id.project, taskId: id.task, threadId: id.thread }, subject: ['project', '/projectId'] }),
    ev('project.shared_out', 'A read-only link to the project Overview was made', { p: { projectId: id.project, expiresAt: t.opt(t.ts()) }, subject: ['project', '/projectId'], replay: 'stub' }),
  ],
  capabilities: [
    create('projects.create', 'Make a project: the record, exactly one channel and one folder (Projects/<name>), and an empty plan', {
      in: {
        type: id.recordType, title: t.str(), summary: t.opt(t.str()), goal: t.opt(t.str()), lead: t.opt(principal), start: t.opt(t.ts()), due: t.opt(t.ts()),
        stages: t.opt(t.arr(stageIn)), members: t.opt(t.arr(t.obj({ principal, role }))), template: t.opt(t.str({ description: 'Template (Kit) id to copy tasks and stages from' })),
      },
      out: createOut, make: ['record_type', '/type'], perm: 'records.create', emits: ['project.created', 'record.created'], tool: 'records', cli: 'vyre projects create',
    }),
    write('projects.from_channel', 'Make this channel a project: create the record and attach the channel, a folder and an empty plan', {
      in: { channelId: id.channel, type: t.opt(id.recordType), title: t.opt(t.str()) }, out: createOut,
      on: ['channel', '/channelId'], perm: 'records.create', level: 'manage', idem: 'key', emits: ['project.created', 'record.created'], tool: 'records',
    }),
    read('projects.get', 'Read one project: record fields, channel, folder and counts', { in: { projectId: id.project }, out: { project: projectRow }, on: ['project', '/projectId'], tool: 'records', label: 'check' }),
    read('projects.list', 'List the projects the caller is in (Agents, Projects and Journeys show only those you are in)', {
      in: { type: t.opt(id.recordType), mine: t.opt(t.bool()), status: t.opt(t.str()), ...pageIn }, out: { projects: t.arr(projectRow), ...pageOut }, tool: 'records', label: 'filter',
    }),
    read('projects.overview', 'The Overview: brief and goal, status with its update, next three milestones, what is late or waiting, recent decisions, people, linked records, pinned files, recent threads', {
      in: { projectId: id.project },
      out: {
        project: projectRow, goal: t.opt(t.str()), statusUpdate: t.opt(t.obj({ text: t.str(), at: t.ts(), by: t.str(), drafted: t.bool() })),
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
    // ---- overview upkeep
    write('projects.post_update', 'Post the status update (by the lead, or drafted weekly by an agent) to the project channel and keep it on the Overview', {
      in: { projectId: id.project, text: t.str(), status: t.opt(t.str()) }, out: { postedAt: t.ts() },
      on: ['project', '/projectId'], emits: ['project.update_posted', 'record.updated'], tool: 'records',
    }),
    write('projects.pin_file', 'Pin a file to the Overview', { in: { projectId: id.project, fileId: id.file }, out: { ok: t.bool() }, on: ['project', '/projectId'], emits: ['project.file_pinned', 'record.updated'], tool: 'records' }),
    write('projects.unpin_file', 'Unpin a file from the Overview', { in: { projectId: id.project, fileId: id.file }, out: { ok: t.bool() }, on: ['project', '/projectId'], emits: ['project.file_unpinned', 'record.updated'], tool: 'records' }),
    write('projects.file_chat', 'File a private chat under the project; it stays private and the agent gets the project memory and folder', {
      in: { projectId: id.project, threadId: id.thread }, out: { ok: t.bool() }, on: ['project', '/projectId'], emits: ['project.chat_filed'], tool: 'records',
    }),
    outward('projects.share_out', 'Make a read-only link to the project Overview for a client', {
      in: { projectId: id.project, expiresAt: t.opt(t.ts()) }, out: { url: t.str(), expiresAt: t.opt(t.ts()) },
      on: ['project', '/projectId'], perm: 'records.share_external', level: 'manage', gate: { act: 'send', when: "actor.kind != 'person'" }, emits: ['project.shared_out'], tool: 'records',
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
