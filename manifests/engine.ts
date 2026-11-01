// engine (lane L2): bridges @vyre/agent into capabilities. Turns, queue, lease, placement, accounts, models, spend, incidents,
// mode and engine switching, warm pool hints. Sources: ARCHITECTURE-V1.md 6.1 to 6.9, 7.2, 7.10 (AI pages); spec 2.5, 3.2, 3.9, 4.6, 4.13, 4.14.
// Threads and messages belong to module chat; the `turns` and `thread_queue` tables are written only through the system capabilities below.
// DECISION: turn lifecycle events (turn.queued .. turn.cancelled) are emitted by system capabilities (engine.turn.*) that the worker in
//   @vyre/agent calls through invoke, so every event has an owning capability and trace id. These have no `tool`.
// DECISION: AI incidents are flagged AI misbehaviour or policy events (label denied for a provider, scrubber miss, runaway spend, repeated
//   failures, a person report). The spec names the Console page and the ai.incidents permission but no fields; these are the plainest ones.
// DECISION: `engine.probe_account` is declared as a read: it sends the provider a model-list call with no Space data.
// DECISION: the three hop and loop limits (agent_hops, review_loops, ci_fix_loops) are declared here; route() reads agent_hops and
//   tasks.transition reads the other two.
import { create, defineManifest, ev, health, outward, read, screen, setting, t, write } from '../packages/contracts/src/index.ts';
import { id, label, pageIn, pageOut } from './_common.ts';

const effort = t.enm('low', 'medium', 'high', 'max');
// Outside tools (CHAT-DESIGN ruling 6): the MCP servers of plugins and connections, run in the sandbox. A call is one capability, so access, the Gate and the audit trail apply to it like any other.
const mcpTool = t.obj({ name: t.str(), description: t.str(), inputSchema: t.json(), readOnly: t.bool() });
const mcpServerRow = t.obj({ key: t.str({ examples: ['greeter/echo'] }), name: t.str(), from: t.enm('plugin', 'connection'), ok: t.bool(), error: t.opt(t.str()), tools: t.arr(mcpTool), hub: t.opt(t.enm('composio', 'pipedream')), oauth: t.opt(t.bool()) });
const mcpCallIn = { agentId: id.agent, server: t.str({ examples: ['greeter/echo'] }), tool: t.str(), input: t.opt(t.json()) };
const mcpCallOut = { isError: t.bool(), text: t.str(), structured: t.opt(t.json()) };
const agentMode = t.enm('lead', 'listen');
// The crew (DESIGN-crew.md): a teammate working in its own copy of the project repository, on its own branch, in its own thread under the lead's chat.
const crewState = t.enm('working', 'waiting', 'done', 'failed', 'stopped', 'merged');
const crewJob = t.obj({
  jobId: t.str({ examples: ['crw_01a1b2'] }), threadId: id.thread, leadThreadId: id.thread, projectId: id.project, agentId: id.agent, name: t.opt(t.str()), title: t.str(), branch: t.str({ examples: ['crew/ember-1'] }),
  base: t.str({ examples: ['main'] }), state: crewState, startedAt: t.ts(), endedAt: t.opt(t.ts()), result: t.opt(t.rec()),
});
const crewWait = t.obj({ waitId: t.str(), kind: t.enm('checks'), label: t.str({ examples: ['acme/site#12'] }), state: t.enm('pending', 'passing', 'failing', 'none'), done: t.int(), total: t.int(), startedAt: t.ts() });
const crewRepo = t.obj({ projectId: id.project, path: t.str(), baseBranch: t.str(), branch: t.str({ description: 'The branch the repository is on now' }) });
const turnState = t.enm('queued', 'running', 'waiting', 'completed', 'failed', 'cancelled');
const driverId = t.enm('anthropic', 'openai', 'openrouter', 'google', 'xai', 'opencode_go', 'local', 'custom', 'claude_code', 'codex', 'grok');
const accountRef = t.str({ description: 'Vault handle or subscription account reference; never a secret value', examples: ['#Team_Anthropic_Key'] });
const errShape = t.obj({ code: t.str(), message: t.str(), next: t.arr(t.obj({ kind: t.str(), label: t.str() })), traceId: id.trace });
const modelInfo = t.obj({
  provider: t.str({ examples: ['anthropic'] }), model: t.str({ examples: ['claude-sonnet-5-5'] }), title: t.str(), driver: driverId, contextTokens: t.opt(t.int()),
  allowed: t.bool(), reason: t.opt(t.enm('label_provider', 'policy_model', 'not_connected')),
});
const accountRow = t.obj({
  ref: accountRef, driver: driverId, kind: t.enm('api_key', 'subscription'), title: t.str(), name: t.opt(t.str({ description: 'The name the person gave this account in the Vault; title is the provider', examples: ['Dana Claude Max'] })), mine: t.bool(), ownerId: t.opt(id.user),
  status: t.enm('ok', 'expired', 'failed', 'untested'), lastProbeAt: t.opt(t.ts()),
  base: t.opt(t.str({ description: 'The address of a local or custom OpenAI-compatible endpoint' })), keyless: t.opt(t.bool()),
});
const turnRow = t.obj({
  turnId: id.turn, threadId: id.thread, agentId: id.agent, asker: t.str(), accountRef: t.opt(accountRef), engine: t.str(), model: t.str(), state: turnState,
  traceId: id.trace, runId: t.opt(id.run), startedAt: t.ts(), endedAt: t.opt(t.ts()), tokensIn: t.int(), tokensOut: t.int(), costMicros: t.int(), error: t.opt(errShape), nodeId: t.opt(t.str({ description: 'The server of the asker\'s the turn ran on, when the chat was pinned to one' })),
});
const whatHappened = t.obj({
  turn: turnRow, machine: t.enm('host', 'device'), keyUsed: t.opt(t.str()), steps: t.arr(t.obj({ idx: t.int(), kind: t.str(), title: t.str(), durationMs: t.int(), ok: t.bool() })),
  denials: t.arr(t.obj({ cap: t.str(), reason: t.str() })), fallbacks: t.arr(t.obj({ kind: t.str(), to: t.str(), at: t.ts() })),
});
const incidentRow = t.obj({
  incidentId: t.id('inc'), kind: t.enm('label_denied', 'scrub_miss', 'runaway_spend', 'repeated_failure', 'person_report', 'other'), title: t.str(),
  state: t.enm('open', 'assigned', 'resolved'), ownerId: t.opt(id.user), agentId: t.opt(id.agent), turnId: t.opt(id.turn), openedAt: t.ts(), resolvedAt: t.opt(t.ts()),
  notes: t.arr(t.obj({ by: t.str(), at: t.ts(), text: t.str() })),
});
const scope = t.enm('space', 'person', 'agent');
const caps = t.obj({ run: t.opt(t.int()), dayMicros: t.opt(t.int()), monthMicros: t.opt(t.int()), turnsPerDay: t.opt(t.int()), timeMinutesPerRun: t.opt(t.int()) });
const usageTotals = t.obj({ turns: t.int(), tokensIn: t.int(), tokensOut: t.int(), costMicros: t.int() });
const threadT = { threadId: id.thread };

export default defineManifest({
  id: 'engine',
  title: 'Engine',
  owner: 'L2',
  capabilities: [
    write('engine.crew.repo.set', 'Say which folder on this computer holds the project\'s repository, and the branch teammates start from; the folder must be a git repository', {
      in: { projectId: id.project, path: t.str({ examples: ['/Users/maya/code/site'] }), baseBranch: t.opt(t.str({ examples: ['main'] })) }, out: { repo: crewRepo },
      on: ['project', '/projectId'], level: 'manage', idem: 'natural', audit: 'always', tool: 'chats', errors: ['validation.bad_input'],
    }),
    read('engine.crew.repo.get', 'The project\'s repository for the crew, or nothing when none is set', { in: { projectId: id.project }, out: { repo: t.nullable(crewRepo) }, on: ['project', '/projectId'], tool: 'chats' }),
    write('engine.crew.start', 'Start a teammate on a brief: it gets its own thread under this chat and its own copy of the project repository on its own branch, and works until it is done', {
      in: { ...threadT, projectId: id.project, teammateId: id.agent, title: t.str(), brief: t.str(), model: t.opt(t.str()), provider: t.opt(t.str()), effort: t.opt(effort) }, out: { job: crewJob },
      on: ['thread', '/threadId'], level: 'use', idem: 'key', audit: 'always', emits: ['crew.job_started'], tool: 'chats', mcpName: 'crew_start', agent: { planMode: 'blocked', blocks: ['helper'] },
      errors: ['validation.bad_input', 'validation.precondition_failed'],
    }),
    read('engine.crew.list', 'The crew of a chat: one row per teammate job, newest first, with what each is on and how it stands', {
      in: { ...threadT }, out: { jobs: t.arr(crewJob), waits: t.arr(crewWait) }, on: ['thread', '/threadId'], tool: 'chats', mcpName: 'crew_list', agent: { planMode: 'allowed', blocks: [] },
    }),
    write('engine.crew.message', 'Send a message to a teammate in its own thread; a teammate that stopped picks up where it left off', {
      in: { jobId: t.str(), body: t.str() }, out: { sent: t.bool() }, level: 'use', idem: 'key', audit: 'always', tool: 'chats', mcpName: 'crew_message', agent: { planMode: 'blocked', blocks: [] },
      errors: ['validation.not_found', 'validation.bad_input'],
    }),
    write('engine.crew.stop', 'Stop a teammate: its running turn ends and anything queued for it is dropped; its work stays on its branch', {
      in: { jobId: t.str() }, out: { job: crewJob }, level: 'use', idem: 'key', audit: 'always', tool: 'chats', mcpName: 'crew_stop', agent: { planMode: 'blocked', blocks: [] }, errors: ['validation.not_found'],
    }),
    write('engine.crew.merge', 'Land a teammate\'s branch in the project repository: it is merged into the base branch when the repository is on it and clean, else it waits there as crew/<branch>. A person presses Merge; an agent asking holds at the Gate', {
      in: { jobId: t.str() }, out: { job: crewJob, landed: t.bool(), ref: t.str(), note: t.opt(t.str()) }, level: 'use', idem: 'key', audit: 'always', risk: 'high',
      gate: { act: 'push_protected', when: "actor.kind != 'person'" }, emits: ['crew.job_merged', 'crew.job_pushed'], tool: 'chats', mcpName: 'crew_merge', agent: { planMode: 'blocked', blocks: [] },
      errors: ['validation.not_found', 'validation.precondition_failed', 'permission.needs_approval'],
    }),
    write('engine.crew.wait', 'Wake me when the checks of a pull request end: the host looks at them, not the model, shows the progress in the Crew tab, and posts one message here that wakes the lead when they finish', {
      in: { ...threadT, repo: t.str({ examples: ['acme/site'] }), number: t.int({ minimum: 1 }) }, out: { wait: crewWait }, on: ['thread', '/threadId'], level: 'use', idem: 'key', audit: 'always', tool: 'chats', mcpName: 'crew_wait',
      agent: { planMode: 'blocked', blocks: [] }, errors: ['validation.bad_input'],
    }),
    write('engine.crew.push', 'Push the project repository\'s base branch, with a teammate\'s merged work in it, to its remote. It is an outward act from the host and always holds at the Gate for a person\'s approval', {
      in: { jobId: t.str() }, out: { job: crewJob, pushed: t.bool(), note: t.opt(t.str()) }, level: 'use', idem: 'key', audit: 'always', risk: 'high', gate: { act: 'push_protected' },
      emits: ['crew.job_merged', 'crew.job_pushed'], tool: 'chats', mcpName: 'crew_push', agent: { planMode: 'blocked', blocks: [] }, errors: ['validation.not_found', 'validation.precondition_failed', 'permission.needs_approval'],
    }),
    read('engine.crew.workspace', 'System: the repository copy a teammate thread works in, so the engine can make it before the first turn', {
      in: { ...threadT }, out: { workspace: t.nullable(t.obj({ jobId: t.str(), repo: t.str(), base: t.str(), branch: t.str(), name: t.str() })) }, on: ['thread', '/threadId'],
    }),
    read('engine.mcp.tools', 'The MCP servers a chat with this agent connects to and the tools each offers (starts the server in the sandbox if it is not running)', {
      in: { agentId: id.agent, server: t.opt(t.str()) }, out: { servers: t.arr(mcpServerRow) }, perm: null, level: 'view', tool: 'agents', mcpName: 'mcp_tools', agent: { planMode: 'allowed' },
    }),
    read('engine.mcp.read', 'Call an outside MCP tool that only reads (the server says so); runs in the sandbox or at the remote server', {
      in: mcpCallIn, out: mcpCallOut, perm: null, level: 'use', errors: ['validation.not_found', 'provider.unavailable', 'permission.no_grant'],
    }),
    write('engine.mcp.oauth_start', 'Begin signing a remote outside-tool connection in with OAuth (the MCP authorization flow). Answers the address to send the person to; the token that comes back is sealed and never answered.', {
      in: { connectionId: t.str(), redirectUri: t.str() }, out: { authUrl: t.str(), state: t.str() }, perm: 'agents.manage', level: 'manage', audit: 'always', agent: false,
      errors: ['validation.not_found', 'validation.precondition_failed', 'provider.unavailable'],
    }),
    write('engine.mcp.oauth_complete', 'Finish an OAuth sign-in with the state and code the server sent back, or the error it sent when the person declined. Only the person who started it can finish it.', {
      in: { state: t.str(), code: t.opt(t.str()), error: t.opt(t.str()) }, out: { connectionId: t.str() }, perm: null, level: 'view', audit: 'always', agent: false,
      errors: ['auth.invalid_code', 'permission.no_grant', 'validation.bad_input', 'provider.unavailable'],
    }),
    read('engine.mcp.oauth_status', 'Has this remote connection signed in? A yes or no, never the token.', { in: { connectionId: t.str() }, out: { signedIn: t.bool() }, perm: null, level: 'view', agent: false }),
    outward('engine.mcp.call', 'Call an outside MCP tool that may change things; an agent\'s call goes through the Gate', {
      in: mcpCallIn, out: mcpCallOut, perm: null, level: 'use', risk: 'medium', gate: { act: 'send', when: "actor.kind != 'person'" }, errors: ['validation.not_found', 'provider.unavailable', 'permission.no_grant', 'validation.precondition_failed'],
    }),
    // ---- control of a running thread (K list)
    write('engine.interrupt', 'Interrupt now: cancel the current turn and queue the message at top priority ("stop and send")', {
      in: { ...threadT, messageId: t.opt(id.message) }, out: { queued: t.bool() }, on: ['thread', '/threadId'], level: 'use', emits: ['turn.cancelled', 'turn.queued'],
      tool: 'chats', offline: 'online', idem: 'natural', risk: 'low',
    }),
    write('engine.drop_queued', 'Take a message that is waiting behind a running turn out of the queue so it can be edited and sent again; it stays in the chat and the agent will not answer it', {
      in: { ...threadT, messageId: id.message }, out: { dropped: t.bool() }, on: ['thread', '/threadId'], level: 'use', tool: 'chats', offline: 'online', idem: 'natural', risk: 'low',
    }),
    write('engine.stop', 'Stop one agent working in a thread (per-agent Stop)', {
      in: { ...threadT, agentId: t.opt(id.agent) }, out: { stopped: t.int() }, on: ['thread', '/threadId'], level: 'use', emits: ['turn.cancelled'],
      tool: 'chats', offline: 'online', idem: 'natural', risk: 'low',
    }),
    write('engine.stop_all', 'Stop every agent working in a thread (Stop all in the conversation header)', {
      in: threadT, out: { stopped: t.int() }, on: ['thread', '/threadId'], level: 'use', emits: ['turn.cancelled'], tool: 'chats', offline: 'online', idem: 'natural', risk: 'low',
    }),
    write('engine.set_mode', 'Set an agent to Leading or Listening in a thread; exactly one lead per thread', {
      in: { ...threadT, agentId: id.agent, mode: agentMode }, out: { mode: agentMode, leadAgentId: t.nullable(id.agent) }, on: ['thread', '/threadId'], level: 'use',
      emits: ['agent.mode_changed'], tool: 'chats', offline: 'queue', idem: 'natural',
    }),
    write('engine.reviewer.set', 'Give a chat a reviewer, an agent or a person, who checks the lead agent\'s work before it counts; none clears the seat. An agent reviewer is asked in the chat after each lead turn ("Asking Reviewer to check this"), a person gets a Review task', {
      in: { ...threadT, reviewer: t.nullable(t.obj({ kind: t.enm('agent', 'person'), id: t.str({ examples: ['agt_a1b2c3'] }) })) }, out: { reviewer: t.nullable(t.obj({ kind: t.enm('agent', 'person'), id: t.str() })) },
      on: ['thread', '/threadId'], level: 'use', emits: ['thread.reviewer_changed'], tool: 'chats', offline: 'online', idem: 'natural', errors: ['validation.not_found', 'validation.bad_input'],
    }),
    read('engine.reviewer.get', 'The reviewer of a chat, if one is set', {
      in: threadT, out: { reviewer: t.nullable(t.obj({ kind: t.enm('agent', 'person'), id: t.str() })) }, on: ['thread', '/threadId'], tool: 'chats', label: 'check',
    }),
    write('engine.set_model', 'Set the model, provider, effort and paying account of an agent in a thread', {
      in: { ...threadT, agentId: id.agent, model: t.opt(t.str()), provider: t.opt(t.str()), effort: t.opt(effort), accountRef: t.opt(accountRef) },
      out: { model: t.str(), provider: t.str(), effort: t.opt(effort), accountRef: t.opt(accountRef) }, on: ['thread', '/threadId'], level: 'use',
      emits: ['agent.model_changed'], tool: 'chats', offline: 'queue', idem: 'natural', errors: ['permission.provider_label', 'validation.precondition_failed'],
    }),
    write('engine.switch', 'Switch engine mid-chat: the new engine starts from the rolling summary, the last turns and a pointer to the transcript', {
      in: { ...threadT, agentId: t.opt(id.agent), driver: driverId, model: t.str(), provider: t.opt(t.str()), effort: t.opt(effort), accountRef: t.opt(accountRef) },
      out: { engine: t.str(), model: t.str(), quietLine: t.str({ examples: ['Switched to Codex, picked up from the summary and the last 20 turns'] }), handoffTurns: t.int() },
      on: ['thread', '/threadId'], level: 'use', emits: ['turn.engine_switched', 'agent.model_changed'], tool: 'meta', mcpName: 'switch_model',
      agent: { planMode: 'blocked', blocks: ['model_switch'] }, errors: ['permission.provider_label', 'permission.limit', 'provider.auth_failed'],
    }),
    write('engine.warm', 'Hint that a thread was opened or the composer got focus: warm the engine session (drivers pool, prefix cache)', {
      in: { ...threadT, agentId: t.opt(id.agent) }, out: { warm: t.bool() }, on: ['thread', '/threadId'], level: 'view', offline: 'online', idem: 'none', risk: 'low',
    }),
    read('engine.route.preview', 'Who will answer a draft message ("Intake will reply" or "No agent will reply, type @ to ask one"); same route() the client runs locally', {
      in: { ...threadT, mentions: t.opt(t.arr(t.obj({ kind: t.enm('person', 'agent'), id: t.str() }))) },
      out: { responders: t.arr(id.agent), line: t.str({ examples: ['Intake will reply'] }) }, on: ['thread', '/threadId'], tool: 'chats',
    }),
    // ---- turns
    read('engine.turn.get', 'What happened: steps, durations, machine, model, key used and denials of one turn', {
      in: { turnId: id.turn }, out: { what: whatHappened }, label: 'check', tool: 'chats', errors: ['validation.not_found'],
    }),
    read('engine.turns.list', 'Turns of a thread, newest first', {
      in: { ...threadT, state: t.opt(t.arr(turnState)), ...pageIn }, out: { turns: t.arr(turnRow), ...pageOut }, on: ['thread', '/threadId'], tool: 'chats',
    }),
    write('engine.turn.retry', 'Retry a failed turn, optionally on another model or backup key (the next step on a turn error)', {
      in: { turnId: id.turn, model: t.opt(t.str()), provider: t.opt(t.str()), accountRef: t.opt(accountRef) }, out: { turn: turnRow }, level: 'use',
      emits: ['turn.queued'], tool: 'chats', offline: 'queue', errors: ['permission.provider_label', 'permission.limit'],
    }),
    read('engine.queue.list', 'Messages waiting in a thread queue (steering, wakes, handoffs)', {
      in: threadT, out: { items: t.arr(t.obj({ qseq: t.int(), kind: t.enm('message', 'interrupt', 'wake', 'handoff'), messageId: t.opt(id.message), from: t.str(), priority: t.int(), state: t.str() })) },
      on: ['thread', '/threadId'], tool: 'chats',
    }),
    // ---- system: the turn worker
    write('engine.turn.enqueue', 'Queue a turn for a responder (message, interrupt, wake or handoff)', {
      in: { ...threadT, agentId: id.agent, kind: t.enm('message', 'interrupt', 'wake', 'handoff'), messageId: t.opt(id.message), priority: t.opt(t.int()), from: t.str() },
      out: { qseq: t.int() }, on: ['thread', '/threadId'], emits: ['turn.queued'], idem: 'natural', risk: 'low',
    }),
    write('engine.turn.start', 'Start a queued turn on the placement chosen (host or device); records account, engine and model', {
      in: { ...threadT, agentId: id.agent, qseq: t.int(), placement: t.enm('host', 'device'), nodeId: t.opt(t.str({ description: 'One of the asker\'s own servers the chat is pinned to; the turn is recorded as running there' })), accountRef: t.opt(accountRef), engine: t.str(), model: t.str() },
      out: { turn: turnRow }, on: ['thread', '/threadId'], emits: ['turn.started'], idem: 'natural', risk: 'low',
    }),
    write('engine.turn.append', 'Persist a coalesced chunk of a running turn (text, tool call, tool result, block)', {
      in: { turnId: id.turn, kind: t.enm('text', 'thinking', 'tool_call', 'tool_result', 'block'), data: t.json() }, out: { idx: t.int() },
      emits: ['turn.block'], idem: 'none', risk: 'low',
    }),
    write('engine.turn.wait', 'Park a turn until a task, an answered block, a run or a time', {
      in: { turnId: id.turn, taskId: t.opt(id.task), blockId: t.opt(id.block), runId: t.opt(id.run), until: t.opt(t.ts()) }, out: { ok: t.bool() },
      emits: ['turn.waiting'], idem: 'natural', risk: 'low',
    }),
    write('engine.turn.record', 'Record a turn the in-process engine ran for a chat (started, then completed, failed or cancelled) under the engine\'s own turn id, so the turn list, review sampling and the agent\'s Working status see it; a repeat answers with what is already recorded', {
      in: {
        ...threadT, turnId: id.turn, agentId: id.agent, phase: t.enm('started', 'completed', 'failed', 'cancelled'), qseq: t.int(), asker: t.opt(t.str()), engine: t.opt(t.str()), model: t.opt(t.str()), accountRef: t.opt(accountRef),
        tokensIn: t.opt(t.int()), tokensOut: t.opt(t.int()), costMicros: t.opt(t.int()), code: t.opt(t.str()),
      },
      out: { turn: turnRow }, emits: ['turn.started', 'turn.completed', 'turn.failed', 'turn.cancelled', 'agent.task_finished'], idem: 'natural', risk: 'low',
    }),
    write('engine.turn.finish', 'End a turn as completed, failed or cancelled; always releases the lease', {
      in: { turnId: id.turn, outcome: t.enm('completed', 'failed', 'cancelled'), error: t.opt(errShape), tokensIn: t.opt(t.int()), tokensOut: t.opt(t.int()), costMicros: t.opt(t.int()) },
      out: { turn: turnRow }, emits: ['turn.completed', 'turn.failed', 'turn.cancelled', 'agent.task_finished', 'agent.blocked'], idem: 'natural', risk: 'low',
    }),
    write('engine.turn.record_usage', 'Meter usage during a turn; over an agent.toml or Space limit it stops the turn and raises agent.limit_hit', {
      in: { turnId: id.turn, tokensIn: t.int(), tokensOut: t.int(), costMicros: t.int(), itemId: t.opt(id.vaultItem) },
      out: { overLimit: t.opt(t.enm('run', 'day', 'month', 'turns', 'time')) }, emits: ['agent.limit_hit'], idem: 'none', risk: 'low',
    }),
    write('engine.turn.fallback', 'Record a fallback during a turn error: another model or the backup key', {
      in: { turnId: id.turn, kind: t.enm('switch_model', 'backup_key'), to: t.str() }, out: { ok: t.bool() }, emits: ['turn.fallback_used'], idem: 'none', risk: 'low',
    }),
    write('engine.lease.acquire', 'Take the lease on a thread (compare and set; heartbeat every 5 s, expires after 20 s)', {
      in: { ...threadT, holder: t.str({ examples: ['host:spc_a1b2c3'] }), kind: t.enm('turn', 'wait') }, out: { acquired: t.bool(), expiresAt: t.ts() }, idem: 'none', risk: 'low',
    }),
    write('engine.lease.heartbeat', 'Extend the lease on a thread', {
      in: { ...threadT, holder: t.str() }, out: { expiresAt: t.ts() }, idem: 'none', risk: 'low',
    }),
    write('engine.lease.release', 'Release the lease on a thread', {
      in: { ...threadT, holder: t.str() }, out: { ok: t.bool() }, idem: 'natural', risk: 'low',
    }),
    read('engine.queue.peek', 'Steering check between tool calls: the next queued messages for a running turn', {
      in: threadT, out: { messages: t.arr(id.message) }, on: ['thread', '/threadId'],
    }),
    read('engine.placement.decide', 'Decide where a turn runs: host or the asker device (private chat rules, computers, routines, phone and web askers)', {
      in: { ...threadT, agentId: id.agent, kind: t.enm('message', 'interrupt', 'wake', 'handoff') },
      out: { placement: t.enm('host', 'device', 'wait'), reason: t.str(), wakeLine: t.opt(t.str({ examples: ['Your computer is off'] })), nodeId: t.opt(t.str()) }, on: ['thread', '/threadId'],
    }),
    write('engine.placement.set', 'Pin a private chat to where it runs: this computer, the Space (Team Space), or one of your own servers. The next turn goes there; a teammate\'s machine is never a choice', {
      in: { ...threadT, target: t.enm('device', 'space', 'server'), serverId: t.opt(t.str()) }, out: { target: t.enm('device', 'space', 'server'), serverId: t.opt(t.str()) },
      on: ['thread', '/threadId'], perm: null, level: 'use', tool: 'chats', errors: ['permission.no_grant', 'validation.precondition_failed', 'validation.bad_input'],
    }),
    read('engine.placement.options', 'What the runs-on chip of a chat offers: this computer, the Space in a Team Space and each of your servers, with whether each is on and why not; and where the chat runs now', {
      in: { ...threadT, agentId: t.opt(id.agent) },
      out: {
        private: t.bool(), effective: t.obj({ target: t.enm('device', 'space', 'server'), serverId: t.opt(t.str()) }),
        options: t.arr(t.obj({ target: t.enm('device', 'space', 'server'), serverId: t.opt(t.str()), name: t.str(), online: t.bool(), reason: t.opt(t.str()) })),
      },
      on: ['thread', '/threadId'], tool: 'chats', label: 'check',
    }),
    read('engine.account.resolve', 'Resolve the account that pays for a turn: starter, steerer, step key, backup key, else an Unblock', {
      in: { ...threadT, agentId: id.agent, askerId: t.opt(id.user), stepKey: t.opt(t.str()), unavailable: t.opt(t.arr(t.str(), { description: 'Accounts that already failed this turn: the answer is the next one in the agent\'s order' })) },
      out: { accountRef: t.nullable(accountRef), payer: t.nullable(id.user), reason: t.enm('starter', 'steerer', 'step_key', 'backup_key', 'none'), allowed: t.bool(), itemId: t.opt(id.vaultItem) }, on: ['thread', '/threadId'],
    }),
    write('engine.step_turn', 'Run one AI turn for an automation step: on the owner\'s own account (Personal) or a Space-shared key (Space), optionally as an agent, with no tools. A repeat of the same key returns the first answer.', {
      in: {
        prompt: t.str({ minLength: 1 }), agentId: t.opt(id.agent), keyId: t.opt(accountRef), backupKeyId: t.opt(accountRef), timeoutMinutes: t.opt(t.int({ minimum: 1, maximum: 30 })), recordIds: t.opt(t.arr(id.record, { maxItems: 200 })), runId: id.run, stepId: t.str(),
      },
      out: { text: t.str(), keyUsed: accountRef, modelUsed: t.str(), tokensIn: t.int({ minimum: 0 }), tokensOut: t.int({ minimum: 0 }), agentName: t.opt(t.str()) },
      level: 'view', idem: 'key', risk: 'medium', audit: 'sensitive', agent: false,
      errors: ['provider.auth_failed', 'provider.rate_limited', 'provider.unavailable', 'provider.overloaded', 'permission.limit', 'permission.provider_label', 'timeout.deadline', 'internal.unavailable'],
    }),
    // ---- accounts and models
    read('engine.accounts.list', 'Accounts the caller can run on: API keys by handle and subscription sign-ins (Mine), with status', {
      out: { accounts: t.arr(accountRow) }, tool: 'meta',
    }),
    read('engine.usage.get', 'For a chat and an account: the context used against the model window (from the latest turn and the model catalog) and the session and week limits exactly as the provider reported them. A provider that reports nothing gives null; nothing is estimated', {
      in: { ...threadT, agentId: id.agent, accountRef: t.opt(accountRef) },
      out: {
        account: t.nullable(t.obj({ ref: accountRef, name: t.str({ description: 'The name the person gave the account in the Vault', examples: ['Dana Claude Max'] }), provider: t.str({ examples: ['anthropic'] }), plan: t.opt(t.str()) })),
        context: t.nullable(t.obj({ used: t.int({ minimum: 0 }), window: t.int({ minimum: 1 }) })),
        session: t.nullable(t.obj({ pct: t.num({ minimum: 0, maximum: 100 }), resetsAt: t.opt(t.ts()) })),
        week: t.nullable(t.obj({ pct: t.num({ minimum: 0, maximum: 100 }), resetsAt: t.opt(t.ts()) })),
        source: t.enm('provider', 'estimate', 'none'),
      },
      on: ['thread', '/threadId'], tool: 'meta', errors: ['validation.not_found'],
    }),
    read('engine.probe_account', 'Test an account: reachable, signed in, models it can use', {
      in: { accountRef }, out: { ok: t.bool(), models: t.opt(t.int()), error: t.opt(errShape) }, tool: 'meta', errors: ['provider.auth_failed', 'provider.unavailable', 'provider.network'],
    }),
    read('engine.models.list', 'Models the account can reach; models that the open labels or policy forbid are listed greyed with the reason', {
      in: { accountRef: t.opt(accountRef), threadId: t.opt(id.thread), recordLabel: t.opt(label) }, out: { models: t.arr(modelInfo) }, tool: 'meta',
    }),
    read('engine.providers.list', 'AI providers and engines (API and CLI) with whether each is connected and allowed for the open labels', {
      in: { threadId: t.opt(id.thread) },
      out: { providers: t.arr(t.obj({ driver: driverId, kind: t.enm('api', 'cli'), title: t.str(), connected: t.bool(), allowed: t.bool(), reason: t.opt(t.str()) })) }, tool: 'meta',
    }),
    read('engine.defaults.get', 'The caller default model, provider, effort and fallback order in this Space', {
      out: { provider: t.opt(t.str()), model: t.opt(t.str()), effort: t.opt(effort), fallback: t.arr(t.obj({ provider: t.str(), model: t.str(), accountRef: t.opt(accountRef) })) }, tool: 'meta',
    }),
    write('engine.defaults.set', 'Set the caller default model, provider, effort and fallback order (the chat default)', {
      in: { provider: t.opt(t.str()), model: t.opt(t.str()), effort: t.opt(effort), fallback: t.opt(t.arr(t.obj({ provider: t.str(), model: t.str(), accountRef: t.opt(accountRef) }))) },
      out: { ok: t.bool() }, tool: 'meta', offline: 'patch', idem: 'natural', risk: 'low',
    }),
    write('engine.subscription_share.set', 'Let the Space run work on my subscription (server runs for my chats, routines and personal automations); off kills my sandbox', {
      in: { enabled: t.bool() }, out: { enabled: t.bool(), sandboxStopped: t.bool() }, emits: ['engine.subscription_share_changed'], tool: 'meta', audit: 'always', idem: 'natural',
    }),
    write('engine.runtime.opt_in', 'Let the Space continue my chats when my computer is off, by wrapping my runtime key for the Space; revocable', {
      in: { enabled: t.bool(), wrappedRuntimeKey: t.opt(t.str({ description: 'Key material wrapped for the Space runtime key (ciphertext)' })) },
      out: { enabled: t.bool() }, emits: ['engine.runtime_opt_in_changed'], tool: 'meta', audit: 'always', idem: 'natural', risk: 'high',
    }),
    // ---- Console AI: policies, spend, usage, incidents, review
    read('engine.policy.get', 'AI policies: allowed accounts, allowed models and providers, and which providers each label may reach', {
      out: {
        allowedAccounts: t.enm('any', 'company'), allowedModels: t.arr(t.str()), allowedProviders: t.arr(t.str()),
        labelProviders: t.rec(t.arr(t.str())), hops: t.obj({ agentHops: t.int(), reviewLoops: t.int(), ciFixLoops: t.int() }),
      },
      perm: null, level: 'view', tool: 'meta',
    }),
    write('engine.policy.set', 'Change AI policies (models and providers, per label provider rules, allowed accounts)', {
      in: {
        allowedAccounts: t.opt(t.enm('any', 'company')), allowedModels: t.opt(t.arr(t.str())), allowedProviders: t.opt(t.arr(t.str())),
        labelProviders: t.opt(t.rec(t.arr(t.str()))),
      },
      out: { ok: t.bool() }, perm: 'ai.models', level: 'manage', emits: ['engine.policy_changed'], tool: 'meta', audit: 'always', risk: 'medium',
    }),
    read('engine.spend.get', 'Spend against caps for the Space, a person or an agent (today, this month, pause state)', {
      in: { scope, scopeId: t.opt(t.str()) },
      out: { caps, todayMicros: t.int(), monthMicros: t.int(), turnsToday: t.int(), paused: t.bool(), pausedBy: t.opt(t.str()) }, tool: 'meta',
    }),
    write('engine.spend.caps.set', 'Set spend and usage caps for the Space, a person or an agent; agent.toml can never exceed them', {
      in: { scope, scopeId: t.opt(t.str()), caps }, out: { caps }, perm: 'ai.spend', level: 'manage', emits: ['spend.caps_changed'], tool: 'meta', audit: 'always', risk: 'medium',
    }),
    write('engine.spend.pause_all', 'Pause all AI spend in the Space', {
      in: { reason: t.opt(t.str()) }, out: { paused: t.bool() }, perm: 'ai.spend', level: 'manage', emits: ['spend.paused'], tool: 'meta', audit: 'always', idem: 'natural', risk: 'high',
    }),
    write('engine.spend.resume_all', 'Resume AI spend after a pause', {
      in: {}, out: { paused: t.bool() }, perm: 'ai.spend', level: 'manage', emits: ['spend.resumed'], tool: 'meta', audit: 'always', idem: 'natural',
    }),
    write('engine.spend.raise', 'Raise a limit once or for good (the Needs you card "Raise once or Stop"); an agent asking passes the Gate', {
      in: { scope, scopeId: t.opt(t.str()), limit: t.enm('run', 'day', 'month', 'turns', 'time'), mode: t.enm('once', 'permanent'), amountMicros: t.opt(t.int()) },
      out: { raised: t.bool() }, perm: 'ai.spend', level: 'manage', emits: ['spend.raised'], gate: { act: 'spend_raise', when: "actor.kind != 'person'" }, tool: 'meta', audit: 'always', risk: 'high',
    }),
    read('engine.usage.query', 'Usage by day, person, agent or model; people see their own, managers their agents, admins all', {
      in: { by: t.enm('day', 'person', 'agent', 'model'), from: t.opt(t.ts()), to: t.opt(t.ts()), personId: t.opt(id.user), agentId: t.opt(id.agent), itemId: t.opt(id.vaultItem) },
      out: { rows: t.arr(t.obj({ key: t.str(), title: t.str(), face: t.opt(t.str()), totals: usageTotals })), totals: usageTotals }, label: 'filter', tool: 'meta',
    }),
    read('engine.incidents.list', 'AI incidents for review', {
      in: { state: t.opt(t.arr(t.enm('open', 'assigned', 'resolved'))), ...pageIn }, out: { incidents: t.arr(incidentRow), ...pageOut }, perm: null, level: 'view', tool: 'meta',
    }),
    read('engine.incident.get', 'Read one AI incident with its notes', {
      in: { incidentId: t.id('inc') }, out: { incident: incidentRow }, perm: null, level: 'view', tool: 'meta', errors: ['validation.not_found'],
    }),
    create('engine.incident.open', 'Open an AI incident (people report one; the system opens them for label denials, scrub misses and runaway spend)', {
      in: { kind: t.enm('label_denied', 'scrub_miss', 'runaway_spend', 'repeated_failure', 'person_report', 'other'), title: t.str(), agentId: t.opt(id.agent), turnId: t.opt(id.turn), note: t.opt(t.str()) },
      out: { incident: incidentRow }, emits: ['incident.opened'], tool: 'meta', risk: 'low',
    }),
    write('engine.incident.assign', 'Assign an incident to an owner', {
      in: { incidentId: t.id('inc'), ownerId: id.user }, out: { incident: incidentRow }, perm: 'ai.incidents', level: 'manage', emits: ['incident.assigned'], tool: 'meta',
    }),
    write('engine.incident.resolve', 'Resolve an incident with a note', {
      in: { incidentId: t.id('inc'), note: t.str() }, out: { incident: incidentRow }, perm: 'ai.incidents', level: 'manage', emits: ['incident.resolved'], tool: 'meta',
    }),
    write('engine.incident.note', 'Add a note to an incident', {
      in: { incidentId: t.id('inc'), text: t.str() }, out: { incident: incidentRow }, perm: 'ai.incidents', level: 'edit', tool: 'meta', idem: 'none', risk: 'low',
    }),
    read('engine.review.list', 'Sampled turns waiting for human review', {
      in: { state: t.opt(t.enm('waiting', 'ok', 'flagged')), ...pageIn },
      out: { items: t.arr(t.obj({ turnId: id.turn, threadId: id.thread, agentId: id.agent, sampledAt: t.ts(), state: t.enm('waiting', 'ok', 'flagged') })), ...pageOut },
      perm: null, level: 'view', label: 'filter', tool: 'meta',
    }),
    write('engine.review.mark', 'Mark a sampled turn reviewed: fine, or flagged (which opens an incident)', {
      in: { turnId: id.turn, verdict: t.enm('ok', 'flagged'), note: t.opt(t.str()) }, out: { incidentId: t.opt(t.id('inc')) }, perm: 'ai.incidents', level: 'edit',
      emits: ['review.marked', 'incident.opened'], tool: 'meta', idem: 'natural',
    }),
    read('engine.use_policy.export', 'Export the AI use policy (models, providers, label rules, limits, accounts) as a file', {
      out: { fileId: id.file }, perm: 'policy.manage', level: 'manage', audit: 'always', risk: 'medium', tool: 'meta',
    }),
    write('engine.complete', 'One request and one answer on an account the caller can run on, for work that is not a chat (memory upkeep); returns the text and the token counts and posts nothing', {
      in: { accountRef: t.str(), prompt: t.str(), system: t.opt(t.str()), model: t.opt(t.str()) }, out: { text: t.str(), tokensIn: t.int(), tokensOut: t.int() },
      perm: null, level: 'use', idem: 'none', risk: 'low', errors: ['validation.not_found', 'internal.unavailable'],
    }),
    read('engine.pool.status', 'Warm engine pool: sessions per driver, warm hits, evictions', {
      out: { sessions: t.arr(t.obj({ driver: driverId, warm: t.int(), max: t.int(), hits: t.int(), misses: t.int() })), totalWarm: t.int() }, perm: null, level: 'manage', tool: 'engineer',
    }),
    read('engine.live_turns', 'The turns being written in a thread right now, with the text so far: what a chat opened or reconnected mid-turn shows before it follows the live stream', {
      in: { threadId: id.thread }, out: { turns: t.arr(t.obj({ turnId: t.str(), agentId: id.agent, text: t.str() })) }, on: ['thread', '/threadId'], perm: null, tool: 'chats',
    }),
    read('engine.health', 'Engine health: queue age, lease holders, provider reachability', {
      out: { state: t.enm('healthy', 'degraded', 'down'), detail: t.opt(t.str()), latencyMs: t.opt(t.int()), oldestQueuedMs: t.int() },
    }),
  ],
  events: [
    ev('crew.job_merged', 'A teammate\'s branch was landed in the project repository', {
      p: { jobId: t.str(), threadId: id.thread, leadThreadId: id.thread, branch: t.str(), landed: t.bool() }, subject: ['thread', '/leadThreadId'], vis: 'participants', label: 'subject',
    }),
    ev('crew.job_pushed', 'A crew\'s merged work was pushed to the project\'s remote', {
      p: { jobId: t.str(), threadId: id.thread, leadThreadId: id.thread, branch: t.str() }, subject: ['thread', '/leadThreadId'], vis: 'participants', label: 'subject',
    }),
    ev('crew.job_started', 'A teammate started on a brief in its own thread and its own branch', {
      p: { jobId: t.str(), threadId: id.thread, leadThreadId: id.thread, projectId: id.project, agentId: id.agent, branch: t.str() }, subject: ['thread', '/leadThreadId'], vis: 'participants', label: 'subject',
    }),
    ev('turn.queued', 'A turn was queued for an agent in a thread', {
      p: { threadId: id.thread, agentId: id.agent, kind: t.str(), qseq: t.int(), messageId: t.opt(id.message) }, subject: ['thread', '/threadId'], vis: 'participants', label: 'subject',
    }),
    ev('turn.started', 'A turn started on a host or device', {
      p: { turnId: id.turn, threadId: id.thread, agentId: id.agent, placement: t.str(), nodeId: t.opt(t.str()), engine: t.str(), model: t.str(), accountRef: t.opt(accountRef) },
      subject: ['thread', '/threadId'], vis: 'participants', label: 'subject',
    }),
    ev('turn.block', 'A coalesced chunk of a running turn was persisted', {
      p: { turnId: id.turn, threadId: id.thread, idx: t.int(), kind: t.str() }, subject: ['thread', '/threadId'], vis: 'participants', label: 'subject', retention: 'transcripts',
    }),
    ev('turn.waiting', 'A turn parked and waits on a task, an answer, a run or a time', {
      p: { turnId: id.turn, threadId: id.thread, taskId: t.opt(id.task), blockId: t.opt(id.block), runId: t.opt(id.run) }, subject: ['thread', '/threadId'], vis: 'participants',
    }),
    ev('turn.completed', 'A turn finished', {
      p: { turnId: id.turn, threadId: id.thread, agentId: id.agent, tokensIn: t.int(), tokensOut: t.int(), costMicros: t.int() }, subject: ['thread', '/threadId'], vis: 'participants', label: 'subject',
      trigger: { title: 'An agent turn finishes', fields: ['/agentId'] },
    }),
    ev('turn.failed', 'A turn failed; the thread accepts the next message as a fresh turn', {
      p: { turnId: id.turn, threadId: id.thread, agentId: id.agent, code: t.str(), message: t.str() }, subject: ['thread', '/threadId'], vis: 'participants',
    }),
    ev('turn.cancelled', 'A turn was cancelled by Stop or Interrupt', {
      p: { turnId: id.turn, threadId: id.thread, agentId: id.agent, by: t.str() }, subject: ['thread', '/threadId'], vis: 'participants',
    }),
    ev('turn.engine_switched', 'The engine of a chat changed (the quiet line in the thread)', {
      p: { threadId: id.thread, agentId: id.agent, from: t.str(), to: t.str(), handoffTurns: t.int(), by: t.str() }, subject: ['thread', '/threadId'], vis: 'participants',
    }),
    ev('turn.fallback_used', 'A turn error fell back to another model or the backup key', {
      p: { turnId: id.turn, threadId: id.thread, kind: t.str(), to: t.str() }, subject: ['thread', '/threadId'], vis: 'participants',
    }),
    ev('agent.limit_hit', 'An agent hit a limit from agent.toml or a Space cap; the turn stopped', {
      p: { agentId: id.agent, threadId: t.opt(id.thread), turnId: t.opt(id.turn), limit: t.enm('run', 'day', 'month', 'turns', 'time'), used: t.int(), cap: t.int(), taskId: t.opt(id.task) },
      subject: ['entity', '/agentId'], vis: 'participants', notify: 'limit.hit',
    }),
    ev('agent.task_finished', 'A long agent task finished', {
      p: { agentId: id.agent, threadId: id.thread, turnId: id.turn, durationMs: t.int() }, subject: ['thread', '/threadId'], vis: 'participants', notify: 'agent.task_finished',
    }),
    ev('agent.blocked', 'An agent is blocked (login, key, site down) and asks for what would unblock it', {
      p: { agentId: id.agent, threadId: id.thread, turnId: t.opt(id.turn), taskId: id.task, what: t.str() }, subject: ['thread', '/threadId'], vis: 'participants', notify: 'agent.blocked',
    }),
    ev('thread.reviewer_changed', 'A chat got a reviewer, or lost it', { p: { threadId: id.thread, reviewer: t.nullable(t.obj({ kind: t.enm('agent', 'person'), id: t.str() })), by: t.str() }, subject: ['thread', '/threadId'] }),
    ev('agent.mode_changed', 'An agent switched between Leading and Listening in a thread', {
      p: { threadId: id.thread, agentId: id.agent, mode: t.str(), by: t.str() }, subject: ['thread', '/threadId'], vis: 'participants',
    }),
    ev('agent.model_changed', 'The model, provider, effort or account of an agent in a thread changed', {
      p: { threadId: id.thread, agentId: id.agent, model: t.str(), provider: t.str(), by: t.str() }, subject: ['thread', '/threadId'], vis: 'participants',
    }),
    ev('spend.caps_changed', 'Spend caps changed', { p: { scope: t.str(), scopeId: t.opt(t.str()), by: t.str() }, subject: ['entity', '/scope'] }),
    ev('spend.paused', 'All AI spend was paused', { p: { by: t.str(), reason: t.opt(t.str()) }, subject: ['entity', '/by'] }),
    ev('spend.resumed', 'AI spend resumed', { p: { by: t.str() }, subject: ['entity', '/by'] }),
    ev('spend.raised', 'A limit was raised', { p: { scope: t.str(), scopeId: t.opt(t.str()), limit: t.str(), mode: t.str(), by: t.str() }, subject: ['entity', '/scope'] }),
    ev('incident.opened', 'An AI incident was opened', { p: { incidentId: t.id('inc'), kind: t.str(), ownerId: t.opt(id.user) }, subject: ['entity', '/incidentId'], vis: 'participants', notify: 'incident.owned' }),
    ev('incident.assigned', 'An AI incident was assigned', { p: { incidentId: t.id('inc'), ownerId: id.user }, subject: ['entity', '/incidentId'], vis: 'participants', notify: 'incident.owned' }),
    ev('incident.resolved', 'An AI incident was resolved', { p: { incidentId: t.id('inc'), by: t.str() }, subject: ['entity', '/incidentId'] }),
    ev('review.marked', 'A sampled turn was reviewed', { p: { turnId: id.turn, verdict: t.str(), by: t.str() }, subject: ['entity', '/turnId'] }),
    ev('engine.policy_changed', 'AI policies changed', { p: { keys: t.arr(t.str()), by: t.str() }, subject: ['entity', '/by'] }),
    ev('engine.subscription_share_changed', 'A person changed whether the Space may run work on their subscription', {
      p: { personId: id.user, enabled: t.bool() }, subject: ['entity', '/personId'], vis: 'owner',
    }),
    ev('engine.runtime_opt_in_changed', 'A person changed whether the Space may continue their chats when their computer is off', {
      p: { personId: id.user, enabled: t.bool() }, subject: ['entity', '/personId'], vis: 'owner',
    }),
  ],
  health: [
    health('engine', 'AI engine', 'engine.health', 'Open Settings > Models and usage and test the account, or switch model'),
  ],
  settings: [
    setting('engine.agent_hops', 'space', 'Policies', 'Agent-to-agent hops before a person must reply', t.int({ minimum: 1, maximum: 20 }), 4, { floorable: true }),
    setting('engine.review_loops', 'space', 'Policies', 'Review send-backs before a person decides', t.int({ minimum: 0, maximum: 10 }), 2, { floorable: true }),
    setting('engine.ci_fix_loops', 'space', 'Policies', 'CI fix attempts before a person decides', t.int({ minimum: 0, maximum: 10 }), 3, { floorable: true }),
    setting('engine.allowed_accounts', 'space', 'Models and providers', 'Allowed AI accounts', t.enm('any', 'company'), 'any', { floorable: true }),
    setting('engine.logging', 'space', 'Logging', 'Detail kept for each turn', t.enm('steps', 'steps_and_tool_io'), 'steps'),
    setting('engine.review_sampling', 'space', 'Review sampling', 'Share of turns sampled for human review', t.obj({ percent: t.int({ minimum: 0, maximum: 100 }), labels: t.arr(label) }), { percent: 5, labels: ['confidential', 'restricted'] }),
    setting('engine.local_runs', 'person', 'This computer', 'Run my private chats on this computer', t.bool(), true),
    setting('engine.subscription_share', 'person', 'Models and usage', 'Let the Space run work on my subscription', t.bool(), true),
    setting('engine.runtime_opt_in', 'person', 'Memory and privacy', 'Let the Space continue my chats when my computer is off', t.bool(), true),
  ],
  screens: [
    screen('settings.models-usage', 'settings', 'ui:ModelsUsage', {
      q: {
        accounts: ['engine.accounts.list', {}, true], models: ['engine.models.list', { accountRef: '/state/accountRef' }, true], defaults: ['engine.defaults.get', {}, true],
        usage: ['engine.usage.query', { by: '/state/by', from: '/state/from', to: '/state/to' }, true],
      },
      a: { probe: ['engine.probe_account', { accountRef: '/state/accountRef' }], setDefaults: ['engine.defaults.set', {}], shareSubscription: ['engine.subscription_share.set', {}], runtime: ['engine.runtime.opt_in', {}] },
      empty: 'No accounts yet', primary: 'Open Vault',
    }),
    screen('console.ai-models', 'console', 'ui:ConsoleAiModels', {
      q: { policy: ['engine.policy.get', {}, true], providers: ['engine.providers.list', {}, true], models: ['engine.models.list', {}, true] },
      a: { save: ['engine.policy.set', {}] }, empty: 'No providers connected', primary: 'Connect a provider', needs: ['ai.models'],
    }),
    screen('console.ai-spend', 'console', 'ui:ConsoleAiSpend', {
      q: { spend: ['engine.spend.get', { scope: '/state/scope', scopeId: '/state/scopeId' }, true], usage: ['engine.usage.query', { by: '/state/by', from: '/state/from', to: '/state/to' }, true] },
      a: { setCaps: ['engine.spend.caps.set', { scope: '/state/scope', scopeId: '/state/scopeId' }], pause: ['engine.spend.pause_all', {}, 'Pause all AI spend in this Space?'], resume: ['engine.spend.resume_all', {}], raise: ['engine.spend.raise', { scope: '/state/scope', scopeId: '/state/scopeId' }] },
      empty: 'No spend yet', primary: 'Set a cap', needs: ['ai.spend'],
    }),
    screen('console.ai-incidents', 'console', 'ui:ConsoleAiIncidents', {
      q: { incidents: ['engine.incidents.list', { state: '/filter/state' }, true], incident: ['engine.incident.get', { incidentId: '/state/incidentId' }, true] },
      a: { assign: ['engine.incident.assign', { incidentId: '/state/incidentId' }], resolve: ['engine.incident.resolve', { incidentId: '/state/incidentId' }], note: ['engine.incident.note', { incidentId: '/state/incidentId' }], open: ['engine.incident.open', {}] },
      empty: 'No incidents', primary: 'Open an incident', needs: ['ai.incidents'],
    }),
    screen('console.ai-review', 'console', 'ui:ConsoleAiReview', {
      q: { items: ['engine.review.list', { state: '/filter/state' }, true], turn: ['engine.turn.get', { turnId: '/state/turnId' }, true] },
      a: { mark: ['engine.review.mark', { turnId: '/state/turnId' }], exportPolicy: ['engine.use_policy.export', {}] },
      empty: 'Nothing sampled for review', primary: 'Change sampling', needs: ['ai.incidents'],
    }),
  ],
});
