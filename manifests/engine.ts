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
import { id, label, pageIn, pageOut, replyTurn, spaceUses } from './_common.ts';

const effort = t.enm('low', 'medium', 'high', 'max');
// Outside tools (CHAT-DESIGN ruling 6): the MCP servers of plugins and connections, run in the sandbox. A call is one capability, so access, the Gate and the audit trail apply to it like any other.
const mcpTool = t.obj({ name: t.str(), description: t.str(), inputSchema: t.json(), readOnly: t.bool() });
const mcpServerRow = t.obj({ key: t.str({ examples: ['greeter/echo'] }), name: t.str(), from: t.enm('plugin', 'connection'), ok: t.bool(), error: t.opt(t.str()), tools: t.arr(mcpTool), hub: t.opt(t.enm('composio', 'pipedream')), oauth: t.opt(t.bool()) });
const mcpCallIn = { agentId: id.agent, server: t.str({ examples: ['greeter/echo'], description: 'The server key mcp_tools lists' }), tool: t.str({ description: 'The tool name as the server lists it' }), input: t.opt(t.json()) };
const mcpCallOut = { isError: t.bool(), text: t.str(), structured: t.opt(t.json()) };
const agentMode = t.enm('lead', 'listen');
// The crew (DESIGN-crew.md): a teammate working in its own copy of the project repository, on its own branch, in its own thread under the lead's chat.
// A Job is running (working, waiting on a hold), paused (its agent was paused), lost (the server stopped under it and only a person may run it again), stopped, or ended (done, failed, merged).
const crewState = t.enm('working', 'waiting', 'paused', 'lost', 'done', 'failed', 'stopped', 'merged');
const crewJob = t.obj({
  jobId: t.str({ examples: ['crw_01a1b2'] }), threadId: id.thread, leadThreadId: id.thread, projectId: t.opt(id.project), agentId: id.agent, name: t.opt(t.str()), title: t.str(), branch: t.str({ examples: ['crew/ember-1'] }),
  base: t.str({ examples: ['main'] }), state: crewState, startedAt: t.ts(), endedAt: t.opt(t.ts()), result: t.opt(t.rec()),
});
const crewWait = t.obj({ waitId: t.str(), kind: t.enm('checks'), label: t.str({ examples: ['acme/site#12'] }), state: t.enm('pending', 'passing', 'failing', 'none'), done: t.int(), total: t.int(), startedAt: t.ts() });
const crewRepo = t.obj({ projectId: t.opt(id.project), threadId: t.opt(id.thread), path: t.str(), baseBranch: t.str(), branch: t.str({ description: 'The branch the repository is on now' }) });
const turnState = t.enm('queued', 'running', 'waiting', 'completed', 'failed', 'cancelled');
const driverId = t.enm('anthropic', 'openai', 'openrouter', 'google', 'xai', 'opencode_go', 'local', 'custom', 'claude_code', 'codex', 'grok');
const accountRef = t.str({ description: 'Vault handle or subscription account reference; never a secret value', examples: ['#Team_Anthropic_Key'] });
const errShape = t.obj({ code: t.str(), message: t.str(), next: t.arr(t.obj({ kind: t.str(), label: t.str() })), traceId: id.trace });
const modelInfo = t.obj({
  provider: t.str({ examples: ['anthropic'] }), model: t.str({ examples: ['claude-sonnet-5-5'] }), title: t.str(), driver: driverId, contextTokens: t.opt(t.int()),
  allowed: t.bool(), reason: t.opt(t.enm('label_provider', 'policy_model', 'not_connected', 'usage_limit')),
  resetsAt: t.opt(t.ts()),
  alias: t.opt(t.str({ description: "The engine's own name that resolves to this model today (Claude Code's opus); a pick saved as the alias is this model", examples: ['opus'] })),
  isDefault: t.opt(t.bool()),
  efforts: t.opt(t.arr(t.str({ description: 'A reasoning-effort level the vendor offers for this model, in its words', examples: ['high'] }))),
  defaultEffort: t.opt(t.str({ examples: ['medium'] })),
});
const myUse = t.obj({ turns: t.int(), input: t.int({ description: 'New input tokens: what the provider did not serve from its cache' }), cachedInput: t.int(), output: t.int(), costMicros: t.int() });
const accountRow = t.obj({
  ref: accountRef, driver: driverId, kind: t.enm('api_key', 'subscription'), title: t.str(), name: t.opt(t.str({ description: 'The name the person gave this account in the Vault; title is the provider', examples: ['Dana Claude Max'] })), mine: t.bool(), ownerId: t.opt(id.user),
  status: t.enm('ok', 'expired', 'failed', 'untested'), lastProbeAt: t.opt(t.ts()),
  base: t.opt(t.str({ description: 'The address of a local or custom OpenAI-compatible endpoint' })), keyless: t.opt(t.bool()),
  spaceKey: t.opt(t.bool()),
  aliases: t.opt(t.arr(accountRef, { description: 'Other refs that show as this account: handles folded into it and its older sign-ins. A chat or agent pinned to one of them shows this account' })),
  older: t.opt(t.arr(t.obj({ ref: accountRef, providerId: t.id('prv'), name: t.str() }), { description: 'Older sign-ins of the same provider whose account cannot be read, listed under this one so a person can remove them' })),
  providerId: t.opt(t.id('prv')),
  provider: t.opt(t.str({ examples: ['anthropic'] })),
  itemId: t.opt(id.vaultItem),
  uses: t.opt({ ...spaceUses, description: 'A Space account: what it may pay for. Left out on a Mine account' }),
  models: t.opt(t.arr(t.str(), { description: 'The models the account\'s provider lists, when known' })),
  usable: t.opt(t.bool()),
  code: t.opt(t.str({ description: 'With a place, when usable is false: the reason as a word (expired, failed, space_may_not_use, capped, no_model, not_used_for...)' })),
  capped: t.opt(t.bool()),
  capCents: t.opt(t.nullable(t.int())),
  why: t.opt(t.str({ description: 'With a place, when usable is false: the reason, in plain words' })),
});
const turnRow = t.obj({
  turnId: id.turn, threadId: id.thread, agentId: id.agent, asker: t.str(), accountRef: t.opt(accountRef), engine: t.str(), model: t.str(), state: turnState,
  traceId: id.trace, runId: t.opt(id.run), startedAt: t.ts(), endedAt: t.opt(t.ts()), tokensIn: t.int(), tokensOut: t.int(), costMicros: t.int(), error: t.opt(errShape), nodeId: t.opt(t.str({ description: 'The server of the asker\'s the turn ran on, when the chat was pinned to one' })),
  ranOn: t.opt(t.arr(t.obj({ kind: t.enm('computer', 'server', 'space'), name: t.str({ examples: ['Dana\'s MacBook', 'the Northwind server'] }) }), { description: 'Where the turn ran, in order: two places when its computer went to sleep and it went on elsewhere' })),
});
// A reply's Details (chat.reply_details, reply-info.ts). A count that is absent was not reported by the provider: never shown as 0.
const toolTrace = t.obj({ id: t.str(), name: t.str(), detail: t.opt(t.str()), startedAt: t.ts(), endedAt: t.opt(t.ts()), ok: t.opt(t.bool()), held: t.opt(id.task) });
const turnInfoIn = t.obj({
  effort: t.opt(t.str({ examples: ['high'] })),
  account: t.opt(t.obj({ ref: accountRef, driver: t.str(), provider: t.str(), kind: t.enm('api_key', 'subscription'), shared: t.opt(t.bool()), spaceKey: t.opt(t.bool()) })),
  firstTokenAt: t.opt(t.ts()), cacheReadTokens: t.opt(t.int()), cacheWriteTokens: t.opt(t.int()), reasoningTokens: t.opt(t.int()), contextTokens: t.opt(t.int()),
  costUsd: t.opt(t.num({ description: 'The provider\'s own price for the turn, when every call reported one' })),
  paid: t.opt(t.str({ description: 'Who paid and why, in a plain line' })),
  tools: t.arr(toolTrace), switches: t.arr(t.obj({ at: t.ts(), from: t.str(), to: t.str(), why: t.str() })),
});
const whatHappened = t.obj({
  turn: turnRow, machine: t.enm('host', 'device'), keyUsed: t.opt(t.str()), paid: t.opt(t.str({ description: 'Who paid and why, in a plain line, as stored when the turn ended' })), steps: t.arr(t.obj({ idx: t.int(), kind: t.str(), title: t.str(), durationMs: t.int(), ok: t.bool() })),
  denials: t.arr(t.obj({ cap: t.str(), reason: t.str() })), fallbacks: t.arr(t.obj({ kind: t.str(), to: t.str(), at: t.ts() })),
  reached: t.opt(t.arr(t.str({ examples: ['github.com'] }), { description: 'Hosts the engine reached on the internet while the turn ran (a sample, at most 20)' })),
});
const incidentRow = t.obj({
  incidentId: t.id('inc'), kind: t.enm('label_denied', 'scrub_miss', 'runaway_spend', 'repeated_failure', 'person_report', 'other'), title: t.str(),
  state: t.enm('open', 'assigned', 'resolved'), ownerId: t.opt(id.user), agentId: t.opt(id.agent), turnId: t.opt(id.turn), openedAt: t.ts(), resolvedAt: t.opt(t.ts()),
  notes: t.arr(t.obj({ by: t.str(), at: t.ts(), text: t.str() })),
});
const scope = t.enm('space', 'person', 'agent');
const caps = t.obj({ run: t.opt(t.int()), dayMicros: t.opt(t.int()), monthMicros: t.opt(t.int()), turnsPerDay: t.opt(t.int()), timeMinutesPerRun: t.opt(t.int()) });
const usageTotals = t.obj({ turns: t.int(), tokensIn: t.int({ description: 'Every input token the turns sent, cached ones included' }), tokensOut: t.int(), costMicros: t.int(), cachedIn: t.opt(t.int({ description: 'The part of tokensIn the provider served from its cache: a turn of many requests sends the chat again with each one' })) });
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
    read('engine.crew.chat_repo', 'The repository of a chat that has its own work folder for the crew, or nothing yet', { in: { ...threadT }, out: { repo: t.nullable(crewRepo) }, on: ['thread', '/threadId'], tool: 'chats' }),
    write('engine.crew.start', 'Start a teammate on a brief in any chat. It works on its own branch in its own copy of the repository: the chat\'s project\'s, else the chat\'s own work folder on this computer (made on first use). Nothing to set up first', {
      in: { ...threadT, projectId: t.opt(id.project), teammateId: t.opt(id.agent), name: t.opt(t.str({ description: 'A name for the new teammate; one is chosen when left out' })), title: t.str(), brief: t.str(), model: t.opt(t.str()), provider: t.opt(t.str()), effort: t.opt(effort), taskId: t.opt(id.task) }, out: { job: crewJob },
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
    write('engine.crew.merge', 'Land a teammate\'s branch in the project repository: it is merged into the base branch when the repository is on it and clean, else it waits there as crew/<branch>. It is local: it leaves this computer only when it is pushed', {
      in: { jobId: t.str() }, out: { job: crewJob, landed: t.bool(), ref: t.str(), note: t.opt(t.str()) }, level: 'use', idem: 'key', audit: 'always', risk: 'high',
      emits: ['crew.job_merged', 'crew.job_pushed'], tool: 'chats', mcpName: 'crew_merge', agent: { planMode: 'blocked', blocks: [] },
      errors: ['validation.not_found', 'validation.precondition_failed'],
    }),
    write('engine.crew.wait', 'Wake me when the checks of a pull request end: the host looks at them, not the model, shows the progress in the Crew tab, and posts one message here that wakes the lead when they finish', {
      in: { ...threadT, repo: t.str({ examples: ['acme/site'] }), number: t.int({ minimum: 1 }) }, out: { wait: crewWait }, on: ['thread', '/threadId'], level: 'use', idem: 'key', audit: 'always', tool: 'chats', mcpName: 'crew_wait',
      agent: { planMode: 'blocked', blocks: [] }, errors: ['validation.bad_input'],
    }),
    write('engine.crew.push', 'Push the project repository\'s base branch, with a teammate\'s merged work in it, to its remote. It is an outward act: a person pressing Push is their own act; an agent goes only when the person\'s own message this turn asked for it, else it holds at the Gate', {
      in: { jobId: t.str() }, out: { job: crewJob, pushed: t.bool(), note: t.opt(t.str()) }, level: 'use', idem: 'key', audit: 'always', risk: 'high', gate: { act: 'push_protected', when: "actor.kind != 'person'" },
      emits: ['crew.job_merged', 'crew.job_pushed'], tool: 'chats', mcpName: 'crew_push', agent: { planMode: 'blocked', blocks: [] }, errors: ['validation.not_found', 'validation.precondition_failed', 'permission.needs_approval'],
    }),
    read('engine.crew.workspace', 'System: the repository copy a teammate thread works in, so the engine can make it before the first turn', {
      in: { ...threadT }, out: { workspace: t.nullable(t.obj({ jobId: t.str(), repo: t.str(), base: t.str(), branch: t.str(), name: t.str() })) }, on: ['thread', '/threadId'],
    }),
    read('engine.mcp.tools', 'The MCP servers a chat with this agent connects to and the tools each offers (starts the server in the sandbox if it is not running)', {
      in: { agentId: id.agent, server: t.opt(t.str()) }, out: { servers: t.arr(mcpServerRow) }, perm: null, level: 'view', tool: 'agents', mcpName: 'mcp_tools', agent: { planMode: 'allowed' },
    }),
    read('engine.mcp.read', 'Call a tool of an outside tool server or connection (app hub, OAuth server, remote MCP) that only reads, as mcp_tools lists it with readOnly true; a tool that may change things goes through mcp_call', {
      in: mcpCallIn, out: mcpCallOut, perm: null, level: 'use', tool: 'agents', mcpName: 'mcp_read', agent: { planMode: 'allowed' },
      errors: ['validation.not_found', 'provider.unavailable', 'permission.no_grant', 'validation.precondition_failed'],
    }),
    write('engine.mcp.oauth_start', 'Begin signing a remote outside-tool connection in with OAuth (the MCP authorization flow). Answers the address to send the person to; the token that comes back is sealed and never answered.', {
      in: { connectionId: t.str(), redirectUri: t.str() }, out: { authUrl: t.str(), state: t.str() }, perm: null, level: 'member', audit: 'always', agent: false,
      errors: ['validation.not_found', 'validation.precondition_failed', 'provider.unavailable', 'permission.role_lacks_permission'],
    }),
    write('engine.mcp.oauth_complete', 'Finish an OAuth sign-in with the state and code the server sent back, or the error it sent when the person declined. Only the person who started it can finish it.', {
      in: { state: t.str(), code: t.opt(t.str()), error: t.opt(t.str()) }, out: { connectionId: t.str() }, perm: null, level: 'member', audit: 'always', agent: false,
      errors: ['auth.invalid_code', 'permission.no_grant', 'validation.bad_input', 'provider.unavailable'],
    }),
    read('engine.mcp.oauth_status', 'Has this remote connection signed in? A yes or no, never the token.', { in: { connectionId: t.str() }, out: { signedIn: t.bool() }, perm: null, level: 'member', agent: false }),
    outward('engine.mcp.call', 'Call a tool of an outside tool server or connection (app hub, OAuth server, remote MCP) that may change things, as mcp_tools lists it; an agent\'s call goes through the Gate', {
      in: mcpCallIn, out: mcpCallOut, perm: null, level: 'use', risk: 'medium', gate: { act: 'send', when: "actor.kind != 'person'" }, tool: 'agents', mcpName: 'mcp_call', agent: { planMode: 'blocked', blocks: [] },
      errors: ['validation.not_found', 'provider.unavailable', 'permission.no_grant', 'validation.precondition_failed'],
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
    // engine.compact: Claude Code compacts its own session (/compact with the words); for Codex, Grok and API engines Vyre writes a summary that starts with the words and the engine starts again from
    // it (modules/engine/compact.ts). `always` keeps the words for every compaction of the chat, the engines' automatic ones too; ticked with no words it clears them.
    write('engine.compact', 'Compact a chat: free the context of the agent\'s engine, keeping what the person names, and say so in one line with the context left. With always, the words are kept for every compaction of this chat', {
      in: { ...threadT, agentId: t.opt(id.agent), keep: t.opt(t.str({ maxLength: 2000, examples: ['the open questions about the lease'] })), always: t.opt(t.bool()) },
      out: {
        engine: t.str({ examples: ['claude_code'] }), how: t.enm('engine', 'vyre'), line: t.str({ examples: ['Compacted. Kept: the open questions about the lease. Context now about 14k of 200k tokens.'] }),
        context: t.nullable(t.obj({ used: t.int({ minimum: 0 }), window: t.int({ minimum: 1 }) })), keepEvery: t.str(), fellBack: t.bool(),
      },
      on: ['thread', '/threadId'], level: 'use', emits: ['turn.compacted'], offline: 'online', idem: 'key', risk: 'low', errors: ['validation.precondition_failed', 'internal.unavailable'],
    }),
    write('engine.warm', 'Hint that a thread was opened or the composer got focus: warm the engine session (drivers pool, prefix cache)', {
      in: { ...threadT, agentId: t.opt(id.agent) }, out: { warm: t.bool() }, on: ['thread', '/threadId'], level: 'view', offline: 'online', idem: 'none', risk: 'low',
    }),
    read('engine.route.preview', 'Who will answer a draft message ("Intake will reply" or "No agent will reply, type @ to ask one"); same route() the client runs locally', {
      in: { ...threadT, mentions: t.opt(t.arr(t.obj({ kind: t.enm('person', 'agent'), id: t.str() }))), text: t.opt(t.str({ description: 'The draft, so a message that names the lead in words is answered by it' })) },
      out: { responders: t.arr(id.agent), line: t.str({ examples: ['Intake will reply'] }) }, on: ['thread', '/threadId'], tool: 'chats',
    }),
    // ---- turns
    read('engine.turn.get', 'What happened: steps, durations, machine, model, key used and denials of one turn', {
      in: { turnId: id.turn }, out: { what: whatHappened }, label: 'check', tool: 'chats', errors: ['validation.not_found'],
    }),
    read('engine.turn.of_message', 'The turn behind one reply in a chat: model, effort, account, where it ran, timing, tokens, cost and tool calls; the account, cost and tool arguments only for the asker and managers of AI spend', {
      in: { ...threadT, messageId: id.message }, out: { turn: replyTurn }, on: ['thread', '/threadId'], label: 'check', errors: ['validation.not_found'],
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
        tokensIn: t.opt(t.int()), tokensOut: t.opt(t.int()), costMicros: t.opt(t.int()), code: t.opt(t.str()), message: t.opt(t.str()),
        info: t.opt(turnInfoIn),
      },
      out: { turn: turnRow }, emits: ['turn.started', 'turn.completed', 'turn.failed', 'turn.cancelled', 'agent.task_finished'], idem: 'natural', risk: 'low',
    }),
    write('engine.turn.finish', 'End a turn as completed, failed or cancelled; always releases the lease', {
      in: { turnId: id.turn, outcome: t.enm('completed', 'failed', 'cancelled'), error: t.opt(errShape), tokensIn: t.opt(t.int()), tokensOut: t.opt(t.int()), costMicros: t.opt(t.int()) },
      out: { turn: turnRow }, emits: ['turn.completed', 'turn.failed', 'turn.cancelled', 'agent.task_finished', 'agent.blocked'], idem: 'natural', risk: 'low',
    }),
    write('engine.turn.record_usage', 'Meter usage during a turn; over an agent.toml or Space limit it stops the turn and raises agent.limit_hit', {
      in: { turnId: id.turn, tokensIn: t.int(), tokensOut: t.int(), costMicros: t.int(), model: t.opt(t.str({ description: 'The model the turn ran when its record names none: the engine\'s own default, said so' })), itemId: t.opt(id.vaultItem) },
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
      out: { placement: t.enm('host', 'device', 'wait'), reason: t.str(), wakeLine: t.opt(t.str({ examples: ['Your computer is off'] })), nodeId: t.opt(t.str()), deviceId: t.opt(t.str({ description: 'The computer of the asker\'s the turn runs on, or the pinned one it waits for' })) }, on: ['thread', '/threadId'],
    }),
    write('engine.placement.set', 'Choose where a private chat runs: one of your computers, the Space, one of your own servers, or auto. Never a teammate\'s machine. once with space runs the next turn on the Space once', {
      in: { ...threadT, target: t.enm('auto', 'device', 'space', 'server'), serverId: t.opt(t.str()), deviceId: t.opt(t.str()), once: t.opt(t.bool()) }, out: { target: t.enm('auto', 'device', 'space', 'server'), serverId: t.opt(t.str()), deviceId: t.opt(t.str()) },
      on: ['thread', '/threadId'], perm: null, level: 'use', tool: 'chats', errors: ['permission.no_grant', 'validation.precondition_failed', 'validation.bad_input'],
    }),
    read('engine.placement.options', 'What the runs-on chip of a chat offers: this computer, the Space in a Team Space and each of your servers, with whether each is on and why not; where the chat runs now, and whether the person pinned it (not pinned is Automatic)', {
      in: { ...threadT, agentId: t.opt(id.agent) },
      out: {
        private: t.bool(), pinned: t.bool(), effective: t.obj({ target: t.enm('device', 'space', 'server'), serverId: t.opt(t.str()), deviceId: t.opt(t.str()) }),
        automatic: t.opt(t.obj({ target: t.enm('device', 'space', 'server'), serverId: t.opt(t.str()), deviceId: t.opt(t.str()) }, { description: 'Where Automatic would run the next turn now, the pin set aside' })),
        options: t.arr(t.obj({ target: t.enm('device', 'space', 'server'), serverId: t.opt(t.str()), deviceId: t.opt(t.str()), current: t.opt(t.bool()), name: t.str(), online: t.bool(), reason: t.opt(t.str()) })),
      },
      on: ['thread', '/threadId'], tool: 'chats', label: 'check',
    }),
    read('engine.account.resolve', 'Resolve the account that pays for a turn: a pin (the chat\'s account, the agent\'s key, the step\'s key), the person\'s own, the Space AI accounts whose uses cover the turn (cheapest that fits, not capped), the backups, else an Unblock', {
      in: {
        ...threadT, agentId: id.agent, askerId: t.opt(id.user), stepKey: t.opt(t.str()), unavailable: t.opt(t.arr(t.str(), { description: 'Accounts that already failed this turn: the answer is the next one in the agent\'s order' })),
        dry: t.opt({ ...t.bool(), description: 'The composer\'s check before sending: would the caller\'s next message here find an account. The caller is the asker; nothing is recorded' }),
        kind: t.opt({ ...t.enm('chat', 'wake', 'automation', 'goal', 'agent_work'), description: 'What caused the turn, which says which Space AI accounts may pay: a person\'s chat (team chats), a wake-up of a chat or a goal\'s turn (goals), an automation step (automations), or agent work with no asker (agent work). Default chat; a step key means automation' }),
      },
      out: {
        accountRef: t.nullable(accountRef), payer: t.nullable(id.user), reason: t.enm('starter', 'steerer', 'step_key', 'backup_key', 'none'), allowed: t.bool(), itemId: t.opt(id.vaultItem), fellBack: t.opt(t.bool()),
        pin: t.opt(t.obj({ ref: accountRef, used: t.bool(), why: t.opt(t.enm('unknown', 'expired', 'failed', 'policy_company', 'not_yours', 'space_may_not_use', 'failed_this_turn', 'capped', 'no_model', 'not_used_for')) }, { description: 'The account the chat, agent or step is pinned to; when it did not pay, why' })),
        cappedFrom: t.opt(accountRef),
        via: t.opt({ ...t.enm('thread', 'chat_key', 'work', 'step', 'space', 'backup'), description: 'Which rule chose the account when it was not the asker\'s own: the chat\'s pick, the agent\'s Chat key, its own-work account, a step\'s account, a Space account kept for the work, or a backup' }),
        why: t.opt({ ...t.enm('no_account', 'expired', 'failed', 'policy', 'no_model'), description: 'When no account can pay: why. expired and failed name the person\'s own account; no_model means the model picked in the composer is served by no account that can pay, and servedModels lists what those accounts serve' }),
        model: t.opt(t.str({ description: 'With why no_model: the model that was picked' })),
        servedModels: t.opt(t.arr(t.str(), { description: 'With why no_model: the models the accounts that could pay do serve' })),
        modelFallback: t.opt(t.obj({ from: t.str({ description: 'The model the chat asked for' }), to: t.opt(t.str({ description: 'The account\'s default model the turn runs on instead; absent: the engine\'s own default for that account' })) }, { description: 'No account that serves the chat\'s model could pay: a team chat or agent work runs on this account\'s default model, and the chat says so' })),
      }, on: ['thread', '/threadId'],
    }),
    write('engine.step_turn', 'Run one AI turn for an automation step: on the owner\'s own account (Personal) or a Space-shared key (Space), optionally as an agent, with no tools. A repeat of the same key returns the first answer.', {
      in: {
        prompt: t.str({ minLength: 1 }), agentId: t.opt(id.agent), keyId: t.opt(accountRef), backupKeyId: t.opt(accountRef), keyFrom: t.opt(t.enm('automation')), timeoutMinutes: t.opt(t.int({ minimum: 1, maximum: 30 })), recordIds: t.opt(t.arr(id.record, { maxItems: 200 })), runId: id.run, stepId: t.str(),
      },
      out: { text: t.str(), keyUsed: accountRef, modelUsed: t.str(), tokensIn: t.int({ minimum: 0 }), tokensOut: t.int({ minimum: 0 }), agentName: t.opt(t.str()) },
      level: 'view', idem: 'key', risk: 'medium', audit: 'sensitive', agent: false,
      errors: ['provider.auth_failed', 'provider.rate_limited', 'provider.unavailable', 'provider.overloaded', 'permission.limit', 'permission.provider_label', 'timeout.deadline', 'internal.unavailable'],
    }),
    // ---- accounts and models
    read('engine.accounts.list', 'Accounts the caller can run on: API keys by handle and subscription sign-ins (Mine), with status. With a place (chat, automation, agent, space) each says whether it can run there and why not', {
      in: { place: t.opt(t.enm('chat', 'automation', 'agent', 'space')), model: t.opt(t.str()), agentId: t.opt(id.agent), explicit: t.opt(t.bool()), runsAs: t.opt(t.enm('person', 'space')) },
      out: { accounts: t.arr(accountRow) }, tool: 'meta',
    }),
    read('engine.usage.get', 'For a chat and an account: the context used against the model window (from the latest turn and the model catalog) and the session and week limits exactly as the provider reported them. A provider that reports nothing gives null; nothing is estimated', {
      in: { ...threadT, agentId: id.agent, accountRef: t.opt(accountRef) },
      out: {
        account: t.nullable(t.obj({ ref: accountRef, name: t.str({ description: 'The name the person gave the account in the Vault', examples: ['Dana Claude Max'] }), provider: t.str({ examples: ['anthropic'] }), plan: t.opt(t.str()) })),
        context: t.nullable(t.obj({ used: t.int({ minimum: 0 }), window: t.int({ minimum: 1 }), approximate: t.opt(t.bool({ description: 'The engine reported only a turn\'s total, so used is estimated from the number of requests the turn made' })) })),
        session: t.nullable(t.obj({ pct: t.num({ minimum: 0, maximum: 100 }), resetsAt: t.opt(t.ts()) })),
        week: t.nullable(t.obj({ pct: t.num({ minimum: 0, maximum: 100 }), resetsAt: t.opt(t.ts()) })),
        source: t.enm('provider', 'estimate', 'none'),
        keepEvery: t.opt(t.str({ description: 'What every compaction of this chat keeps ("Keep this every time"), when set' })),
        model: t.opt(t.str({ description: 'The model this chat\'s agent is set to answer with now: the chat\'s own pick (a new chat starts on the person\'s last pick), else the agent\'s' })),
        lastTurn: t.opt(t.obj({
          model: t.opt(t.str({ description: 'The model the latest turn really ran on, as its engine said' })),
          account: t.opt(t.obj({ ref: accountRef, name: t.opt(t.str()), provider: t.str(), shared: t.opt(t.bool()) })),
          paid: t.opt(t.str({ description: 'Who paid and why, for the asker only' })),
        }, { description: 'What the latest turn of this chat ran on, which can differ from the account shown above when the account that would pay now is not the one that paid then' })),
      },
      on: ['thread', '/threadId'], tool: 'meta', errors: ['validation.not_found'],
    }),
    read('engine.my_ai', 'What AI this chat runs on and what else the person may use now: model, account and who paid, each usable account with models and limits (or not readable), and use today and this month. Ask it for what model, what else, what is left, /usage', {
      in: { threadId: t.opt(id.thread), agentId: t.opt(id.agent) },
      out: {
        running: t.opt(t.rec()),
        accounts: t.arr(t.obj({
          ref: accountRef, name: t.str(), provider: t.str(), kind: t.enm('api_key', 'subscription'), usable: t.bool(), why: t.opt(t.str()), models: t.arr(t.str()),
          limits: t.obj({ state: t.enm('read', 'not_readable'), session: t.opt(t.obj({ pct: t.num(), resetsAt: t.opt(t.ts()) })), week: t.opt(t.obj({ pct: t.num(), resetsAt: t.opt(t.ts()) })), note: t.opt(t.str()) }),
        })),
        use: t.obj({ today: myUse, month: myUse }),
      },
      tool: 'meta', mcpName: 'my_ai',
    }),
    read('engine.probe_account', 'Test an account: reachable, signed in, models it can use', {
      in: { accountRef }, out: { ok: t.bool(), models: t.opt(t.int()), error: t.opt(errShape) }, tool: 'meta', errors: ['provider.auth_failed', 'provider.unavailable', 'provider.network'],
    }),
    read('engine.models.list', 'Models the account can reach; models that the open labels or policy forbid are listed greyed with the reason', {
      in: {
        accountRef: t.opt(accountRef), threadId: t.opt(id.thread), recordLabel: t.opt(label),
        refresh: t.opt(t.bool()),
        wait: t.opt(t.bool()),
        // false: the saved or shipped lists only, for a background reader (memory learning); no vendor is asked and no account state changes
        probe: t.opt(t.bool()),
      },
      out: {
        models: t.arr(modelInfo),
        listed: t.opt(t.obj({
          source: t.enm('live', 'saved', 'shipped'), updatedAt: t.opt(t.ts()), refreshing: t.bool(),
          failed: t.bool(),
        }, { description: 'How fresh the subscription engines\' lists are; left out when none is listed' })),
      },
      tool: 'meta',
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
      in: { by: t.enm('day', 'person', 'agent', 'model', 'account'), from: t.opt(t.ts()), to: t.opt(t.ts()), personId: t.opt(id.user), agentId: t.opt(id.agent), itemId: t.opt(id.vaultItem) },
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
    read('engine.now', 'Which agents are working right now: the agent, the person it works for, where it runs (the Space, their computer, their server) and since when; the chat is named only to someone who may read it', {
      in: {}, out: { working: t.arr(t.obj({ agentId: id.agent, forPerson: t.str(), where: t.enm('space', 'computer', 'server'), since: t.ts(), threadId: t.opt(id.thread), title: t.opt(t.str()), channelId: t.opt(id.channel), kind: t.opt(t.str()) })) },
      perm: null, tool: 'chats', team: true,
    }),
    read('engine.live_turns', 'The turns being written in a thread right now, with the text so far: what a chat opened or reconnected mid-turn shows before it follows the live stream', {
      in: { threadId: id.thread }, out: { turns: t.arr(t.obj({ turnId: t.str(), agentId: id.agent, text: t.str(), step: t.opt(t.str({ description: 'What it is doing now, in plain words' })) })) }, on: ['thread', '/threadId'], perm: null, tool: 'chats',
    }),
    read('engine.helper_models', 'The catalogue before you start helpers: every AI account the person may use with its provider, label and models (tools, vision, context, a cost tier cheap, standard or strong, whether it is available now), and where a helper goes by default', {
      in: { threadId: t.opt(id.thread), agentId: t.opt(id.agent) },
      out: {
        accounts: t.arr(t.obj({ ref: accountRef, provider: t.str(), label: t.str({ examples: ['OpenAI · irfad@mylegalacademy.com'] }), mine: t.bool(), shared: t.bool(), spaceKey: t.bool(), models: t.arr(t.obj({ model: t.str(), title: t.opt(t.str()), tier: t.enm('cheap', 'standard', 'strong'), tools: t.bool(), vision: t.bool(), contextTokens: t.opt(t.int()), available: t.bool(), why: t.opt(t.str()) })) })),
        parent: t.obj({ provider: t.opt(t.str()), accountRef: t.opt(accountRef), model: t.opt(t.str()) }), policy: t.enm('same_provider', 'any', 'ask'),
        suggest: t.obj({ read: t.nullable(t.obj({ account: accountRef, accountLabel: t.str(), model: t.str(), why: t.str() })), think: t.nullable(t.obj({ account: accountRef, accountLabel: t.str(), model: t.str(), why: t.str() })) }), rule: t.str(),
      },
      tool: 'chats', mcpName: 'models_for_helpers', agent: { planMode: 'allowed' }, label: 'check',
    }),
    read('engine.helpers.status', 'The helpers of a chat, live: each one working, done, needing a person or failed, the step it is on, one line of what it found, how long it took and what it cost', {
      in: { ...threadT }, out: { helpers: t.arr(t.obj({
        threadId: id.thread, title: t.str(), agentId: id.agent, provider: t.opt(t.str()), accountLabel: t.opt(t.str()), model: t.opt(t.str()), why: t.opt(t.str()), fellBackFrom: t.opt(t.str()), state: t.enm('working', 'done', 'needs_you', 'failed', 'stopped'), step: t.opt(t.str()), found: t.opt(t.str()), startedAt: t.ts(), endedAt: t.opt(t.ts()),
        elapsedMs: t.int({ minimum: 0 }), tokensIn: t.int({ minimum: 0 }), tokensOut: t.int({ minimum: 0 }), costMicros: t.int({ minimum: 0 }),
      })) }, on: ['thread', '/threadId'], tool: 'chats', label: 'check',
    }),
    write('engine.helpers.stop_all', 'Stop every helper still working under a chat; what they did so far is kept', {
      in: { ...threadT }, out: { stopped: t.int({ minimum: 0 }) }, on: ['thread', '/threadId'], level: 'use', idem: 'natural', tool: 'chats', emits: ['turn.cancelled'],
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
      p: { jobId: t.str(), threadId: id.thread, leadThreadId: id.thread, projectId: t.opt(id.project), agentId: id.agent, branch: t.str() }, subject: ['thread', '/leadThreadId'], vis: 'participants', label: 'subject',
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
    ev('turn.compacted', 'A chat was compacted (the quiet line in the thread): by the engine itself or by Vyre\'s summary, with the context it left', {
      p: { threadId: id.thread, agentId: id.agent, engine: t.str(), how: t.enm('engine', 'vyre'), kept: t.bool(), used: t.opt(t.int()), window: t.opt(t.int()), by: t.str() }, subject: ['thread', '/threadId'], vis: 'participants',
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
    // 8 agent turns since a person wrote, helpers and teammates counted, then a Continue card (owner ruling, 3 Nov 2026; was 4)
    setting('engine.agent_hops', 'space', 'Policies', 'Agent turns, helpers and teammates counted, before a person must reply', t.int({ minimum: 1, maximum: 20 }), 8, { floorable: true }),
    setting('engine.allowed_accounts', 'space', 'Models and providers', 'Allowed AI accounts', t.enm('any', 'company'), 'any', { floorable: true }),
    setting('engine.review_sampling', 'space', 'Review sampling', 'Share of turns sampled for human review', t.obj({ percent: t.int({ minimum: 0, maximum: 100 }), labels: t.arr(label) }), { percent: 5, labels: ['confidential', 'restricted'] }),
    setting('engine.local_runs', 'person', 'Models and usage', 'Run my private chats on this computer', t.bool(), true),
    // owner ruling 3 Nov: AI tools use the internet as they do in Claude Code and Codex. Read when each engine process starts, on Space servers and on members' computers (modules/engine/egress-log.ts)
    setting('engine.egress', 'space', 'Internet access', 'What AI tools can reach on the internet', t.obj({
      mode: t.enm('public', 'providers', 'list'),
      hosts: t.arr(t.str({ pattern: '^(\\*\\.)?([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\\.)+[a-z]{2,63}$', maxLength: 253, examples: ['github.com'] }), { maxItems: 500 }),
    }), { mode: 'public', hosts: [] }),
  ],
  screens: [
    screen('settings.models-usage', 'settings', 'ui:ModelsUsage', {
      q: {
        accounts: ['engine.accounts.list', {}, true], models: ['engine.models.list', { accountRef: '/state/accountRef' }, true], defaults: ['engine.defaults.get', {}, true],
        usage: ['engine.usage.query', { by: '/state/by', from: '/state/from', to: '/state/to' }, true],
      },
      // No "Let the Space continue my chats when my computer is off" toggle here (owner ruling, 3 Nov 2026): it is on by default and its screen comes back with sealed chats.
      // engine.runtime.opt_in stays a capability; only the Settings action is gone.
      a: { probe: ['engine.probe_account', { accountRef: '/state/accountRef' }], setDefaults: ['engine.defaults.set', {}], shareSubscription: ['engine.subscription_share.set', {}] },
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
