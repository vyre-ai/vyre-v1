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
import { create, defineManifest, ev, health, read, screen, setting, t, write } from '../packages/contracts/src/index.ts';
import { id, label, pageIn, pageOut } from './_common.ts';

const effort = t.enm('low', 'medium', 'high', 'max');
const agentMode = t.enm('lead', 'listen');
const turnState = t.enm('queued', 'running', 'waiting', 'completed', 'failed', 'cancelled');
const driverId = t.enm('anthropic', 'openai', 'openrouter', 'google', 'xai', 'opencode_go', 'local', 'claude_code', 'codex', 'grok');
const accountRef = t.str({ description: 'Vault handle or subscription account reference; never a secret value', examples: ['#Team_Anthropic_Key'] });
const errShape = t.obj({ code: t.str(), message: t.str(), next: t.arr(t.obj({ kind: t.str(), label: t.str() })), traceId: id.trace });
const modelInfo = t.obj({
  provider: t.str({ examples: ['anthropic'] }), model: t.str({ examples: ['claude-sonnet-5-5'] }), title: t.str(), driver: driverId, contextTokens: t.opt(t.int()),
  allowed: t.bool(), reason: t.opt(t.enm('label_provider', 'policy_model', 'not_connected')),
});
const accountRow = t.obj({
  ref: accountRef, driver: driverId, kind: t.enm('api_key', 'subscription'), title: t.str(), mine: t.bool(), ownerId: t.opt(id.user),
  status: t.enm('ok', 'expired', 'failed', 'untested'), lastProbeAt: t.opt(t.ts()),
});
const turnRow = t.obj({
  turnId: id.turn, threadId: id.thread, agentId: id.agent, asker: t.str(), accountRef: t.opt(accountRef), engine: t.str(), model: t.str(), state: turnState,
  traceId: id.trace, runId: t.opt(id.run), startedAt: t.ts(), endedAt: t.opt(t.ts()), tokensIn: t.int(), tokensOut: t.int(), costMicros: t.int(), error: t.opt(errShape),
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
    // ---- control of a running thread (K list)
    write('engine.interrupt', 'Interrupt now: cancel the current turn and queue the message at top priority ("stop and send")', {
      in: { ...threadT, messageId: t.opt(id.message) }, out: { queued: t.bool() }, on: ['thread', '/threadId'], level: 'use', emits: ['turn.cancelled', 'turn.queued'],
      tool: 'chats', offline: 'online', idem: 'natural', risk: 'low',
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
      in: { ...threadT, agentId: id.agent, qseq: t.int(), placement: t.enm('host', 'device'), accountRef: t.opt(accountRef), engine: t.str(), model: t.str() },
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
    write('engine.turn.finish', 'End a turn as completed, failed or cancelled; always releases the lease', {
      in: { turnId: id.turn, outcome: t.enm('completed', 'failed', 'cancelled'), error: t.opt(errShape), tokensIn: t.opt(t.int()), tokensOut: t.opt(t.int()), costMicros: t.opt(t.int()) },
      out: { turn: turnRow }, emits: ['turn.completed', 'turn.failed', 'turn.cancelled', 'agent.task_finished', 'agent.blocked'], idem: 'natural', risk: 'low',
    }),
    write('engine.turn.record_usage', 'Meter usage during a turn; over an agent.toml or Space limit it stops the turn and raises agent.limit_hit', {
      in: { turnId: id.turn, tokensIn: t.int(), tokensOut: t.int(), costMicros: t.int() },
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
      out: { placement: t.enm('host', 'device', 'wait'), reason: t.str(), wakeLine: t.opt(t.str({ examples: ['Your computer is off'] })) }, on: ['thread', '/threadId'],
    }),
    read('engine.account.resolve', 'Resolve the account that pays for a turn: starter, steerer, step key, backup key, else an Unblock', {
      in: { ...threadT, agentId: id.agent, askerId: t.opt(id.user), stepKey: t.opt(t.str()) },
      out: { accountRef: t.nullable(accountRef), payer: t.nullable(id.user), reason: t.enm('starter', 'steerer', 'step_key', 'backup_key', 'none'), allowed: t.bool() }, on: ['thread', '/threadId'],
    }),
    // ---- accounts and models
    read('engine.accounts.list', 'Accounts the caller can run on: API keys by handle and subscription sign-ins (Mine), with status', {
      out: { accounts: t.arr(accountRow) }, tool: 'meta',
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
      in: { by: t.enm('day', 'person', 'agent', 'model'), from: t.opt(t.ts()), to: t.opt(t.ts()), personId: t.opt(id.user), agentId: t.opt(id.agent) },
      out: { rows: t.arr(t.obj({ key: t.str(), title: t.str(), totals: usageTotals })), totals: usageTotals }, label: 'filter', tool: 'meta',
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
    read('engine.pool.status', 'Warm engine pool: sessions per driver, warm hits, evictions', {
      out: { sessions: t.arr(t.obj({ driver: driverId, warm: t.int(), max: t.int(), hits: t.int(), misses: t.int() })), totalWarm: t.int() }, perm: null, level: 'manage', tool: 'engineer',
    }),
    read('engine.health', 'Engine health: queue age, lease holders, provider reachability', {
      out: { state: t.enm('healthy', 'degraded', 'down'), detail: t.opt(t.str()), latencyMs: t.opt(t.int()), oldestQueuedMs: t.int() },
    }),
  ],
  events: [
    ev('turn.queued', 'A turn was queued for an agent in a thread', {
      p: { threadId: id.thread, agentId: id.agent, kind: t.str(), qseq: t.int(), messageId: t.opt(id.message) }, subject: ['thread', '/threadId'], vis: 'participants', label: 'subject',
    }),
    ev('turn.started', 'A turn started on a host or device', {
      p: { turnId: id.turn, threadId: id.thread, agentId: id.agent, placement: t.str(), engine: t.str(), model: t.str(), accountRef: t.opt(accountRef) },
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
