// agents (lane L2): the agent record type, lifecycle, role line, routines, suggestions, template propagation, versions, and the
// agent-only tools of the native environment. Sources: spec 2.6, 3.2 (Agent page), 4.13, "Vyre is the agent's native environment";
// ARCHITECTURE-V1.md 6.7, 6.10, 7.2.
// One agent is one record, one folder in Files (Agents/<name>) and one name in Chats. AGENT.md, agent.toml and VYRE.md saves go through
// files.save (snapshot, lint, version); this module owns the record, the lifecycle and the policies around them.
// DECISION: agentTools below are the alias entries for capabilities whose `mcpName` equals the tool name (plus `local` and `blocks`
//   metadata). The generator emits one tool per name. Inputs repeat the capability input; `threadId` is filled from the calling thread.
// DECISION: owner level edits use grants on the agent (no role permission), so agents.manage guards only Space-wide template work.
// DECISION: "All in the Space" is a per-admin view toggle, logged in the audit trail, with no event.
// NOT EXPRESSIBLE: executor placement (host, device, agentd) for terminal, chrome, screen and files tools is stated on AgentToolDef.local only;
//   CapabilityDef has no such field, so the computers and terminal capabilities do not carry it.
import { atool, create, defineManifest, ev, field, list, read, rtype, screen, setting, t, write } from '../packages/contracts/src/index.ts';
import { id, pageIn, pageOut, versionRow } from './_common.ts';

const agentStatus = t.enm('awake', 'working', 'asleep', 'paused');
const captureMode = t.enm('propose', 'auto_low_risk', 'off');
const limits = t.obj({
  runCostMicros: t.opt(t.int()), dayCostMicros: t.opt(t.int()), monthCostMicros: t.opt(t.int()), turnsPerDay: t.opt(t.int()), minutesPerRun: t.opt(t.int()), tokensPerDay: t.opt(t.int()),
});
const agentRow = t.obj({
  agentId: id.agent, name: t.str(), face: t.str({ description: 'DiceBear Notionists seed tinted per Space', examples: ['intake'] }), role: t.opt(t.str({ description: 'The "use me when" line' })),
  status: agentStatus, pausedReason: t.opt(t.str()), pausedBy: t.opt(t.str()), ownerId: id.user, folderId: id.folder,
  model: t.opt(t.str()), fallbackModel: t.opt(t.str()), accountPolicy: t.enm('asker', 'key'), accountKey: t.opt(t.str({ description: 'Vault handle, never a value', examples: ['#Team_Anthropic_Key'] })),
  toolsAllowed: t.arr(t.str()), toolsDenied: t.arr(t.str()), vaultKeys: t.arr(t.str()), limits, captureMode, hasComputer: t.bool(), templateVersion: t.int(),
  createdAt: t.ts(), lastActiveAt: t.opt(t.ts()),
});
const routineRow = t.obj({
  routineId: t.id('rtn'), agentId: id.agent, title: t.str(), cron: t.str({ examples: ['0 9 * * 1-5'] }), prompt: t.str(), channelId: t.opt(id.channel), enabled: t.bool(),
  ownerId: id.user, lastRunAt: t.opt(t.ts()), nextRunAt: t.opt(t.ts()),
});
const suggestionRow = t.obj({
  suggestionId: t.id('sug'), agentId: id.agent, kind: t.enm('agent_md', 'template'), file: t.str({ examples: ['AGENT.md'] }), diff: t.str(), reason: t.opt(t.str()),
  widening: t.bool(), state: t.enm('open', 'accepted', 'dismissed'), proposedBy: t.str(), proposedAt: t.ts(), taskId: t.opt(id.task),
});
const agentFile = t.enm('AGENT.md', 'agent.toml');
const target = { agentId: id.agent };
const listIn = { section: t.opt(t.enm('personal', 'shared', 'space')), folderId: t.opt(id.folder), status: t.opt(t.arr(agentStatus)), ...pageIn };
const effort = t.enm('low', 'medium', 'high', 'max');

export default defineManifest({
  id: 'agents',
  title: 'Agents',
  owner: 'L2',
  recordTypes: [
    rtype('agent', 'Agent', 'Agents', 'bot', [
      field('name', 'text', 'Name', { required: true }),
      field('face', 'text', 'Face'),
      field('role', 'text', 'Role', { options: { hint: 'The "use me when" line; edits agent.toml description' } }),
      field('status', 'status', 'Status', { options: { stages: [{ key: 'awake', title: 'Awake' }, { key: 'working', title: 'Working' }, { key: 'asleep', title: 'Asleep' }, { key: 'paused', title: 'Paused' }] }, merge: 'assistant' }),
      field('owner', 'person', 'Owner', { merge: 'assistant' }),
      field('model', 'text', 'Model'),
      field('fallback_model', 'text', 'Fallback model'),
      field('account', 'choice', 'Whose account runs it', { options: { choices: [{ key: 'asker', title: 'The person asking' }, { key: 'key', title: 'A shared key' }] }, default: 'asker' }),
      field('account_key', 'text', 'Shared key name'),
      field('tools_allowed', 'multichoice', 'Tools allowed', { options: { choices: [] } }),
      field('tools_denied', 'multichoice', 'Tools denied', { options: { choices: [] } }),
      field('vault_keys', 'multichoice', 'Vault key names', { options: { choices: [] } }),
      field('limit_run_cost', 'money', 'Spend limit per run'),
      field('limit_day_cost', 'money', 'Spend limit per day'),
      field('limit_month_cost', 'money', 'Spend limit per month'),
      field('limit_turns', 'number', 'Turns per day'),
      field('limit_time', 'duration', 'Time limit per run'),
      field('capture', 'choice', 'Memory capture', { options: { choices: [{ key: 'propose', title: 'Propose' }, { key: 'auto_low_risk', title: 'Merge low-risk' }, { key: 'off', title: 'Off' }] }, default: 'propose' }),
      field('computer', 'checkbox', 'Has a computer'),
      field('watchers', 'multichoice', 'Channels it watches', { options: { choices: [] } }),
      field('handoffs', 'multichoice', 'Can hand work to', { options: { choices: [] } }),
      field('template_version', 'number', 'Template version', { merge: 'assistant' }),
      field('folder', 'text', 'Folder'),
    ], { system: true, template: null, label: 'internal', titleField: 'name', summaryField: 'role', statusField: 'status', ownerField: 'owner' }),
  ],
  lists: [
    list('agent', 'Agent', 'Agents', 'agents.list'),
  ],
  capabilities: [
    read('agents.list', 'List agents you are in or that are shared with you (admins may toggle All in the Space)', {
      in: listIn, out: { agents: t.arr(agentRow), ...pageOut }, tool: 'agents', label: 'filter', cli: 'vyre agents list',
    }),
    read('agents.get', 'Read one agent: record, status, limits and the effective configuration', {
      in: target, out: { agent: agentRow }, on: ['agent', '/agentId'], tool: 'agents', label: 'check', errors: ['validation.not_found'],
    }),
    read('agents.status', 'Live status of an agent: Awake (idle 2 minutes), Working, Asleep or Paused with reason and who', {
      in: target, out: { status: agentStatus, since: t.ts(), reason: t.opt(t.str()), by: t.opt(t.str()) }, on: ['agent', '/agentId'], tool: 'agents',
    }),
    read('agents.summary', 'The agent page strip: chats this week, open tasks, runs today, spend against limit, memory facts, proposed facts, Working on, Linked', {
      in: target,
      out: {
        chatsThisWeek: t.int(), openTasks: t.int(), runsToday: t.int(), spendTodayMicros: t.int(), spendLimitMicros: t.opt(t.int()), memoryFacts: t.int(), proposedFacts: t.int(),
        workingOn: t.arr(t.obj({ kind: t.str(), id: t.str(), title: t.str() })), linked: t.arr(t.obj({ kind: t.str(), id: t.str(), title: t.str() })),
        watches: t.arr(id.channel),
      },
      on: ['agent', '/agentId'], tool: 'agents', label: 'filter',
    }),
    create('agents.create', 'Create an agent (the create-agent skill ends in one Approve card): record, Agents/<name> folder with the decided file tree, template files', {
      in: {
        name: t.str({ examples: ['Intake'] }), role: t.opt(t.str()), face: t.opt(t.str()), model: t.opt(t.str()), ownerId: t.opt(id.user), computer: t.opt(t.bool()),
        templateKey: t.opt(t.str()), tools: t.opt(t.obj({ allowed: t.arr(t.str()), denied: t.arr(t.str()) })), limits: t.opt(limits),
      },
      out: { agent: agentRow }, perm: 'agents.create', emits: ['agent.created'], tool: 'agents', offline: 'queue', cli: 'vyre agents create',
      errors: ['validation.duplicate'],
    }),
    write('agents.update', 'Change an agent: name, model, fallback, account, tools, vault key names, limits, memory capture, handoffs; a broken agent.toml keeps the last good version running', {
      in: { ...target, patch: t.rec() }, out: { agent: agentRow }, on: ['agent', '/agentId'], emits: ['agent.config_changed', 'agent.config_error'], tool: 'agents', offline: 'patch',
      errors: ['validation.field_locked', 'validation.bad_input'], hook: true,
    }),
    write('agents.role_line.set', 'Edit the role line in place: saves the description of agent.toml with an inline Undo; read-only without Edit', {
      in: { ...target, description: t.str({ maxLength: 200 }) }, out: { agent: agentRow, undoVersionId: id.version }, on: ['agent', '/agentId'], emits: ['agent.config_changed'], tool: 'agents', offline: 'patch',
    }),
    write('agents.pause', 'Pause an agent with a reason; the status shows who paused it', {
      in: { ...target, reason: t.opt(t.str()) }, out: { agent: agentRow }, on: ['agent', '/agentId'], level: 'manage', emits: ['agent.paused'], tool: 'agents', idem: 'natural',
    }),
    write('agents.resume', 'Resume a paused agent', {
      in: target, out: { agent: agentRow }, on: ['agent', '/agentId'], level: 'manage', emits: ['agent.resumed'], tool: 'agents', idem: 'natural',
    }),
    write('agents.delete', 'Move an agent to Trash (its folder and memory follow the folder rules)', {
      in: target, out: { deleted: t.bool() }, on: ['agent', '/agentId'], level: 'manage', emits: ['agent.deleted'], gate: { act: 'delete', when: "actor.kind != 'person'" }, tool: 'agents', audit: 'sensitive', errors: ['permission.on_hold'],
    }),
    write('agents.restore', 'Restore an agent from Trash', {
      in: target, out: { agent: agentRow }, on: ['agent', '/agentId'], level: 'manage', emits: ['agent.restored'], tool: 'agents',
    }),
    write('agents.visibility.set', 'Admin toggle "All in the Space" for agent lists (logged)', {
      in: { all: t.bool() }, out: { all: t.bool() }, perm: 'access.manage', audit: 'always', tool: 'agents', idem: 'natural', risk: 'low',
    }),
    // ---- configuration
    read('agents.config.get', 'Parsed agent.toml and AGENT.md metadata as the next run will see them, with the last good version and any error', {
      in: target, out: { effective: t.rec(), lastGoodVersionId: t.opt(id.version), error: t.opt(t.obj({ line: t.opt(t.int()), message: t.str() })), lines: t.obj({ agentMd: t.int(), vyreMd: t.int() }) },
      on: ['agent', '/agentId'], tool: 'agents', label: 'check',
    }),
    read('agents.config.validate', 'Validate agent.toml text (app limits first, then precedence) without saving', {
      in: { ...target, toml: t.str() }, out: { ok: t.bool(), errors: t.arr(t.obj({ line: t.opt(t.int()), message: t.str() })), widens: t.arr(t.str()) }, on: ['agent', '/agentId'], tool: 'agents',
    }),
    read('agents.limits.get', 'Effective limits of an agent: agent.toml capped by Space caps', {
      in: target, out: { limits, source: t.rec(t.enm('agent', 'person', 'space')) }, on: ['agent', '/agentId'], tool: 'agents',
    }),
    write('agents.snapshot.take', 'Take the file snapshot a run uses; changes to the files apply between runs', {
      in: { ...target, runId: t.opt(id.run) }, out: { snapshotId: t.id('snp'), version: t.int() }, on: ['agent', '/agentId'], idem: 'natural', risk: 'low',
    }),
    read('agents.versions', 'List versions of an agent definition (AGENT.md, agent.toml) for rollback', {
      in: { ...target, file: t.opt(agentFile) }, out: { versions: t.arr(versionRow) }, on: ['agent', '/agentId'], tool: 'agents',
    }),
    write('agents.restore_version', 'Restore AGENT.md or agent.toml to an earlier version', {
      in: { ...target, versionId: id.version, file: t.opt(agentFile) }, out: { agent: agentRow }, on: ['agent', '/agentId'], emits: ['agent.config_changed'], tool: 'agents', agent: { planMode: 'blocked' },
    }),
    // ---- routines
    read('agents.routines.list', 'Routines of an agent (schedules set by the owner)', {
      in: target, out: { routines: t.arr(routineRow) }, on: ['agent', '/agentId'], tool: 'agents', label: 'filter',
    }),
    create('agents.routine.save', 'Create or change a routine; messages it causes carry "Sent by <agent> on a routine <person> set"', {
      in: { ...target, routineId: t.opt(t.id('rtn')), title: t.str(), cron: t.str({ examples: ['0 9 * * 1-5'] }), prompt: t.str(), channelId: t.opt(id.channel), enabled: t.opt(t.bool()) },
      out: { routine: routineRow }, make: ['agent', '/agentId'], perm: 'agents.schedule', emits: ['agent.routine_changed'], tool: 'agents', idem: 'key',
    }),
    write('agents.routine.delete', 'Delete a routine', {
      in: { ...target, routineId: t.id('rtn') }, out: { deleted: t.bool() }, on: ['agent', '/agentId'], perm: 'agents.schedule', emits: ['agent.routine_changed'], tool: 'agents',
    }),
    // ---- suggestions and the Agent template
    read('agents.suggestions.list', 'Open suggestions for an agent: AGENT.md diffs from the agent and template suggestions', {
      in: { agentId: t.opt(id.agent), kind: t.opt(t.enm('agent_md', 'template')), state: t.opt(t.arr(t.enm('open', 'accepted', 'dismissed'))), ...pageIn },
      out: { suggestions: t.arr(suggestionRow), ...pageOut }, tool: 'agents', label: 'filter',
    }),
    create('agents.suggestion.propose', 'Propose a change to AGENT.md as a diff; people without Edit see Suggest to <owner>; personal preferences go to private memory instead', {
      in: { ...target, file: t.opt(t.str()), diff: t.str(), reason: t.opt(t.str()) }, out: { suggestion: suggestionRow }, make: ['agent', '/agentId'], emits: ['agent.suggestion_proposed'], tool: 'agents', idem: 'key',
    }),
    write('agents.suggestion.accept', 'Accept a suggestion (shown to the owner and editors only); applies it through files.save as a version', {
      in: { suggestionId: t.id('sug') }, out: { suggestion: suggestionRow }, perm: null, level: 'edit', emits: ['agent.suggestion_resolved', 'agent.config_changed'], tool: 'agents', errors: ['validation.precondition_failed'],
    }),
    write('agents.suggestion.dismiss', 'Dismiss a suggestion', {
      in: { suggestionId: t.id('sug') }, out: { suggestion: suggestionRow }, perm: null, level: 'edit', emits: ['agent.suggestion_resolved'], tool: 'agents',
    }),
    read('agents.template.get', 'The Agent template: version, files, and the propagation mode', {
      out: { version: t.int(), files: t.arr(t.str()), mode: t.enm('suggest', 'new_only', 'off'), agents: t.int() }, perm: null, level: 'view', tool: 'agents',
    }),
    read('agents.template.preview', 'Preview propagation before applying ("12 agents, 3 folders added, 2 suggestions")', {
      in: { scope: t.enm('all', 'one'), agentId: t.opt(id.agent) },
      out: { agents: t.int(), foldersAdded: t.int(), filesAdded: t.int(), suggestions: t.int(), widening: t.int() }, perm: null, level: 'view', tool: 'agents',
    }),
    write('agents.template.apply', 'Apply the template: adds, never removes or overwrites; changed files become suggestions; widening ones need admin approval; try one agent first', {
      in: { scope: t.enm('all', 'one'), agentId: t.opt(id.agent) }, out: { applied: t.int(), suggestions: t.int(), taskId: t.opt(id.task) },
      perm: 'agents.manage', level: 'manage', emits: ['agent.template_applied'], tool: 'agents', audit: 'always', risk: 'medium',
    }),
  ],
  events: [
    ev('agent.created', 'An agent was created', { p: { agentId: id.agent, name: t.str(), ownerId: id.user, templateVersion: t.int() }, subject: ['agent', '/agentId'], trigger: { title: 'An agent is created' } }),
    ev('agent.paused', 'An agent was paused', { p: { agentId: id.agent, reason: t.opt(t.str()), by: t.str() }, subject: ['agent', '/agentId'], trigger: { title: 'An agent is paused' } }),
    ev('agent.resumed', 'An agent was resumed', { p: { agentId: id.agent, by: t.str() }, subject: ['agent', '/agentId'] }),
    ev('agent.deleted', 'An agent moved to Trash', { p: { agentId: id.agent, by: t.str() }, subject: ['agent', '/agentId'] }),
    ev('agent.restored', 'An agent came back from Trash', { p: { agentId: id.agent, by: t.str() }, subject: ['agent', '/agentId'] }),
    ev('agent.config_changed', 'AGENT.md, agent.toml or the agent record changed (a new version was saved)', {
      p: { agentId: id.agent, fields: t.arr(t.str()), versionId: t.opt(id.version), by: t.str() }, subject: ['agent', '/agentId'], trigger: { title: 'An agent configuration changes', fields: ['/fields'] },
    }),
    ev('agent.config_error', 'An agent.toml failed validation; the last good version keeps running', { p: { agentId: id.agent, message: t.str(), line: t.opt(t.int()) }, subject: ['agent', '/agentId'] }),
    ev('agent.routine_changed', 'A routine was created, changed or deleted', { p: { agentId: id.agent, routineId: t.id('rtn'), op: t.enm('created', 'updated', 'deleted') }, subject: ['agent', '/agentId'], vis: 'owner' }),
    ev('agent.suggestion_proposed', 'A change to an agent was suggested', { p: { suggestionId: t.id('sug'), agentId: id.agent, kind: t.str(), by: t.str() }, subject: ['agent', '/agentId'], vis: 'participants' }),
    ev('agent.suggestion_resolved', 'A suggestion was accepted or dismissed', { p: { suggestionId: t.id('sug'), agentId: id.agent, accepted: t.bool(), by: t.str() }, subject: ['agent', '/agentId'], vis: 'participants' }),
    ev('agent.template_applied', 'The Agent template was applied', { p: { scope: t.str(), agents: t.int(), suggestions: t.int(), by: t.str() }, subject: ['entity', '/scope'] }),
  ],
  agentTools: [
    atool('tool_search', 'Find tools by what you want to do; returns names and schemas, then they are callable', {
      in: { query: t.str(), toolset: t.opt(t.str()), limit: t.opt(t.int({ minimum: 1, maximum: 50 })) },
      out: { tools: t.arr(t.obj({ name: t.str(), summary: t.str(), toolset: t.str(), input: t.json() })) },
      cap: 'mcp.tool.search', effects: 'read', planMode: 'allowed',
    }),
    atool('wait_for', 'End the turn and wake in this thread when an event, a run or a time arrives (a Run of kind wait; shows "Waiting on: build 42")', {
      in: { on: t.union(t.obj({ event: t.str(), filter: t.opt(t.json()) }), t.obj({ run: id.run }), t.obj({ at: t.ts() })), timeout: t.opt(t.str({ examples: ['30d'] })) },
      out: { runId: id.run }, cap: 'runs.wait_for', effects: 'write', planMode: 'allowed',
    }),
    atool('ask_question', 'Ask the person a structured question (single, multi or free text) instead of guessing; the turn parks until answered', {
      in: { prompt: t.str(), mode: t.enm('single', 'multi', 'free'), options: t.opt(t.arr(t.obj({ key: t.str(), label: t.str(), detail: t.opt(t.str()) }))), allowOther: t.opt(t.bool()) },
      out: { blockId: id.block, messageId: id.message }, cap: 'chat.question.ask', effects: 'write', planMode: 'allowed', blocks: ['question'],
    }),
    atool('plan_propose', 'Propose a plan with steps; used when plan mode is on', {
      in: { title: t.str(), steps: t.arr(t.obj({ text: t.str(), detail: t.opt(t.str()) }), { minItems: 1 }), docFileId: t.opt(id.file) },
      out: { planId: id.plan, blockId: id.block }, cap: 'chat.plan.propose', effects: 'write', planMode: 'allowed', blocks: ['plan'],
    }),
    atool('open_tab', 'Open a side tab beside the chat for the person (a file, record, diff, terminal)', {
      in: { targetType: t.str({ examples: ['file'] }), targetId: t.str(), title: t.opt(t.str()) },
      out: { opened: t.bool(), reason: t.opt(t.enm('disabled_by_person', 'no_device')) }, cap: 'chat.open_tab', effects: 'write', planMode: 'blocked', blocks: ['tab_opened'],
    }),
    atool('terminal_run', 'Run a command in a terminal session on the agent computer, the Space server or the person computer; secrets by #handle only', {
      in: {
        command: t.str(), terminalId: t.opt(id.terminal), host: t.opt(t.enm('agent_computer', 'device')), cwd: t.opt(t.str()), timeoutSec: t.opt(t.int({ minimum: 1, maximum: 3600 })),
        env: t.opt(t.rec(t.str({ description: 'Literal or a #Handle.field reference' }))),
      },
      out: { terminalId: id.terminal, exitCode: t.nullable(t.int()), output: t.str(), truncated: t.bool(), durationMs: t.int() },
      cap: 'terminal.run', local: 'terminal', effects: 'write', planMode: 'blocked', blocks: ['terminal'],
    }),
    atool('sub_task_model', 'Run a sub-task as a helper thread on a chosen model, provider and effort', {
      in: { title: t.str(), instruction: t.str(), agentId: t.opt(id.agent), model: t.opt(t.str()), provider: t.opt(t.str()), effort: t.opt(effort) },
      out: { helper: t.rec(), blockId: id.block }, cap: 'chat.helper.start', effects: 'write', planMode: 'blocked', blocks: ['model_switch', 'helper'],
    }),
    atool('switch_model', 'Switch this chat to another engine or model; the new engine starts from the summary and the last turns', {
      in: { driver: t.str(), model: t.str(), provider: t.opt(t.str()), effort: t.opt(effort), accountRef: t.opt(t.str()) },
      out: { engine: t.str(), model: t.str(), quietLine: t.str(), handoffTurns: t.int() }, cap: 'engine.switch', effects: 'write', planMode: 'blocked', blocks: ['model_switch'],
    }),
    atool('handoff', 'Hand work to another agent in a new linked thread (counted against the hop limit)', {
      in: { toAgentId: id.agent, note: t.str() }, out: { thread: t.rec(), depth: t.int() }, cap: 'chat.handoff', effects: 'write', planMode: 'blocked',
    }),
    atool('memory_propose', 'Save a fact to the asker layer of this agent memory with its source', {
      in: { text: t.str(), sourceKind: t.str(), sourceRef: t.str(), layer: t.opt(t.str()), validFrom: t.opt(t.ts()), kind: t.opt(t.str()) },
      out: { fact: t.rec(), merged: t.bool() }, cap: 'memory.propose_fact', effects: 'write', planMode: 'blocked', blocks: ['memory_saved'],
    }),
  ],
  settings: [
    setting('agents.template_mode', 'space', 'Policies', 'Agent template propagation', t.enm('suggest', 'new_only', 'off'), 'suggest'),
  ],
  screens: [
    screen('chats.agent-page', 'chats', 'ui:AgentPage', {
      q: {
        agent: ['agents.get', { agentId: '/state/agentId' }, true], summary: ['agents.summary', { agentId: '/state/agentId' }, true],
        routines: ['agents.routines.list', { agentId: '/state/agentId' }, true], suggestions: ['agents.suggestions.list', { agentId: '/state/agentId' }, true],
        config: ['agents.config.get', { agentId: '/state/agentId' }, true], chats: ['threads.list', {}, true],
      },
      a: {
        chat: ['chat.start', {}], setRoleLine: ['agents.role_line.set', { agentId: '/state/agentId' }], update: ['agents.update', { agentId: '/state/agentId' }],
        pause: ['agents.pause', { agentId: '/state/agentId' }], resume: ['agents.resume', { agentId: '/state/agentId' }], saveRoutine: ['agents.routine.save', { agentId: '/state/agentId' }],
        deleteRoutine: ['agents.routine.delete', { agentId: '/state/agentId', routineId: '/state/routineId' }], acceptSuggestion: ['agents.suggestion.accept', { suggestionId: '/state/suggestionId' }],
        dismissSuggestion: ['agents.suggestion.dismiss', { suggestionId: '/state/suggestionId' }], remove: ['agents.delete', { agentId: '/state/agentId' }, 'Move this agent to Trash?'],
      },
      empty: 'No agent selected', primary: 'Choose an agent', perf: { firstPaintMs: 50, completeMs: 100 },
    }),
    screen('chats.all-agents', 'chats', 'ui:AllAgents', {
      slot: 'popover', q: { agents: ['agents.list', { section: '/state/section', folderId: '/state/folderId' }, true] }, a: { chat: ['chat.start', {}], create: ['agents.create', {}] },
      empty: 'No agents yet', primary: 'New agent', needs: ['agents.create'],
    }),
    screen('console.agents-register', 'console', 'ui:ConsoleAgents', {
      q: { agents: ['agents.list', { section: '/state/section' }, true], summary: ['agents.summary', { agentId: '/state/agentId' }, true] },
      a: {
        pause: ['agents.pause', { agentId: '/state/agentId' }], resume: ['agents.resume', { agentId: '/state/agentId' }], remove: ['agents.delete', { agentId: '/state/agentId' }, 'Move this agent to Trash?'],
        showAll: ['agents.visibility.set', {}],
      },
      empty: 'No agents yet', primary: 'New agent', needs: ['console.access'],
    }),
    screen('console.agent-template', 'console', 'ui:ConsoleAgentTemplate', {
      q: { template: ['agents.template.get', {}, true], preview: ['agents.template.preview', { scope: '/state/scope', agentId: '/state/agentId' }, false], suggestions: ['agents.suggestions.list', { kind: '/state/kind' }, true] },
      a: { apply: ['agents.template.apply', { scope: '/state/scope', agentId: '/state/agentId' }, 'Apply the template?'], accept: ['agents.suggestion.accept', { suggestionId: '/state/suggestionId' }], dismiss: ['agents.suggestion.dismiss', { suggestionId: '/state/suggestionId' }] },
      empty: 'The template has no changes to apply', primary: 'Close', needs: ['agents.manage'],
    }),
  ],
});
