// runs (lane L6): the one Run model (spec 2.13, 4.3; architecture 4.7): automation runs, routines, campaign sends, deployments,
// runbook runs, agent background waits, terminal sessions. Owns the durable step log and `runs.undo`.
// DECISION: stop and retry need Manage on the run (the owner has it implicitly); admins hold it through the `runs.manage` role permission in the handler.
// DECISION: `runs.replay` is the sandbox replay of section b9 (outward capabilities stubbed, needs `server.logs`); `automations.replay` re-runs for real.
// DECISION: the lifecycle capabilities runs.start, mark_waiting, resume, finish and record_step are system calls (no tool) used by the engine, the Gate and other modules.
import { defineManifest, entity, ev, health, read, screen, t, write } from '../packages/contracts/src/index.ts';
import { id, ok, pageIn, pageOut, purgeOut, resourceRef, runStarted } from './_common.ts';

const runKind = t.enm('automation', 'automation_test', 'journey', 'journey_migrate', 'routine', 'campaign', 'deployment', 'connector_sync', 'connector_build', 'import', 'runbook', 'wait', 'terminal', 'replay', 'other');
const runStatus = t.enm('queued', 'running', 'waiting', 'succeeded', 'failed', 'stopped');
const waitReason = t.enm('approval', 'background', 'key');
const stepState = t.enm('pending', 'running', 'succeeded', 'failed', 'skipped', 'waiting', 'stopped');

// What woke a Run that an event started: the message, its thread and the channel (a watcher routine), so the agent answers that message.
const runTrigger = t.obj({ messageId: id.message, threadId: id.thread, channelId: t.opt(id.channel) });
const runRow = t.obj({
  id: id.run, kind: runKind, name: t.opt(t.str()), owner: t.str({ examples: ['usr_a1b2c3'] }), startedBy: t.str(), subject: t.opt(resourceRef),
  status: runStatus, waitReason: t.opt(waitReason), definitionVersion: t.opt(t.int()), keyUsed: t.opt(t.str()), modelUsed: t.opt(t.str()),
  costMicros: t.int({ minimum: 0 }), startedAt: t.ts(), endedAt: t.opt(t.ts()), parentRun: t.opt(id.run), threadId: t.opt(id.thread),
  traceId: id.trace, summary: t.opt(t.str({ description: 'One-line result' })), trigger: t.opt(runTrigger),
});
const stepRow = t.obj({
  step: t.str({ examples: ['step_1'] }), attempt: t.int({ minimum: 1 }), state: stepState, branch: t.opt(t.str()),
  inputRef: t.opt(t.str()), outputRef: t.opt(t.str()), error: t.opt(t.obj({ code: t.str(), message: t.str() })),
  startedAt: t.opt(t.ts()), endedAt: t.opt(t.ts()), traceSpan: t.opt(t.str()),
});
const target = { runId: id.run };
const undoReport = {
  undone: t.arr(t.obj({ eventId: id.event, summary: t.str() })),
  skipped: t.arr(t.obj({ eventId: id.event, summary: t.str(), reason: t.enm('changed_since', 'not_undoable', 'sent', 'deployed') })),
};
const waitOn = t.union(
  t.obj({ event: t.str({ examples: ['record.updated'] }), filter: t.opt(t.json()) }),
  t.obj({ run: id.run }),
  t.obj({ at: t.ts() }),
);

export default defineManifest({
  id: 'runs',
  title: 'Runs',
  owner: 'L6',
  entities: [
    entity('run', 'runs_items', 'run_', {
      kind: 'choice', name: 'text', owner: 'person', started_by: 'text', subject: 'text', status: 'status', wait_reason: 'choice',
      definition_version: 'number', key_used: 'text', model_used: 'text', cost_micros: 'number', started_at: 'datetime', ended_at: 'datetime',
      parent_run: 'text', thread_id: 'text', trace_id: 'text', summary: 'text',
    }, 'run', { ownerField: 'owner', sync: { window: { days: 30, recentCount: 300 }, protectedFields: ['status', 'owner', 'key_used'] }, retention: 'run_logs' }),
  ],
  events: [
    // ---- erase and purge (P-CC_39): governance removes data through these; each hard-deletes inside its own store
    ev('run.erased', 'A Run was erased for good with its steps (ids only)', { p: { runId: id.run }, subject: ['entity', '/runId'], retention: 'audit' }),
    ev('runs.purged', 'Runs past their retention were removed with their step logs (a count)', { p: { removed: t.int({ minimum: 0 }) }, subject: ['entity', '/removed'], retention: 'audit' }),
    ev('run.started', 'A Run started', { p: { runId: id.run, kind: runKind, name: t.opt(t.str()), owner: t.str(), subject: t.opt(resourceRef), definitionVersion: t.opt(t.int()), parentRun: t.opt(id.run) }, subject: ['run', '/runId'], retention: 'run_logs' }),
    ev('run.waiting', 'A Run is waiting for approval, background work or a key', { p: { runId: id.run, reason: waitReason, taskId: t.opt(id.task), on: t.opt(t.str()) }, subject: ['run', '/runId'], retention: 'run_logs' }),
    ev('run.resumed', 'A waiting Run continued', { p: { runId: id.run, reason: waitReason }, subject: ['run', '/runId'], retention: 'run_logs' }),
    ev('run.succeeded', 'A Run finished', { p: { runId: id.run, kind: runKind, summary: t.opt(t.str()), costMicros: t.int() }, subject: ['run', '/runId'], retention: 'run_logs', trigger: { title: 'A run succeeds', fields: ['/kind'] } }),
    ev('run.failed', 'A Run failed; it lands in the owner Needs you', { p: { runId: id.run, kind: runKind, step: t.opt(t.str()), code: t.str(), message: t.str(), owner: t.str(), consecutive: t.opt(t.int()) }, subject: ['run', '/runId'], retention: 'run_logs', notify: 'run.failed', trigger: { title: 'A run fails', fields: ['/kind'] } }),
    ev('run.stopped', 'A Run was stopped by its owner or a Manage holder', { p: { runId: id.run, by: t.str(), reason: t.opt(t.str()) }, subject: ['run', '/runId'], retention: 'run_logs' }),
    ev('run.retried', 'A Run was retried; the new Run points at the old one', { p: { runId: id.run, newRunId: id.run, fromStep: t.opt(t.str()) }, subject: ['run', '/runId'], retention: 'run_logs' }),
    ev('run.undone', 'The writes of a Run were undone where possible', { p: { runId: id.run, undone: t.int(), skipped: t.int() }, subject: ['run', '/runId'], retention: 'run_logs', replay: 'stub' }),
    ev('run.key_fallback', 'A lost key fell back to the backup key (the Run chat records it)', { p: { runId: id.run, step: t.opt(t.str()), fromKey: t.str(), toKey: t.opt(t.str()), reason: t.str() }, subject: ['run', '/runId'], retention: 'run_logs' }),
  ],
  capabilities: [
    // ---- erase and purge (P-CC_39)
    write('runs.erase', 'Erase one Run for good with its steps, waits and alerts (governance erase)', { level: 'manage', perm: 'policy.manage', idem: 'key', in: { runId: id.run }, out: { erased: t.bool() }, emits: ['run.erased'], audit: 'always', risk: 'high' }),
    write('runs.purge', 'Remove Runs and step logs older than a time, a batch at a time (retention)', { level: 'manage', perm: 'policy.manage', idem: 'key', in: { before: t.ts(), limit: t.opt(t.int({ minimum: 1, maximum: 5000 })) }, out: purgeOut, emits: ['runs.purged'], audit: 'always', risk: 'high' }),
    read('runs.list', 'List Runs by owner, subject, kind and status; scope all is for Manage holders and the Console', {
      in: {
        scope: t.enm('mine', 'subject', 'owner', 'all'), ownerId: t.opt(t.str()), subject: t.opt(resourceRef), kinds: t.opt(t.arr(runKind)),
        statuses: t.opt(t.arr(runStatus)), since: t.opt(t.ts()), ...pageIn,
      },
      out: { runs: t.arr(runRow), ...pageOut }, tool: 'automations', label: 'filter', cli: 'vyre runs list',
    }),
    read('runs.get', 'Read one Run: status, owner, key and model used, cost, thread, trace', { in: target, out: { run: runRow }, on: ['run', '/runId'], tool: 'automations', label: 'check', cli: 'vyre runs get' }),
    read('runs.steps', 'The durable step log of a Run', { in: { ...target, ...pageIn }, out: { steps: t.arr(stepRow), ...pageOut }, on: ['run', '/runId'], tool: 'automations' }),
    read('runs.count', 'Count Runs by status for badges (failed runs in Needs you, running now)', {
      in: { scope: t.enm('mine', 'all'), statuses: t.opt(t.arr(runStatus)) }, out: { count: t.int() }, tool: 'automations',
    }),
    write('runs.stop', 'Stop a Run (owner or Manage holder); stoppable work halts at the next safe point', {
      in: { ...target, reason: t.opt(t.str()) }, out: { run: runRow }, on: ['run', '/runId'], level: 'manage', emits: ['run.stopped'], tool: 'automations', offline: 'online', cli: 'vyre runs stop',
    }),
    write('runs.retry', 'Retry a failed or stopped Run from the start or from a step', {
      in: { ...target, fromStep: t.opt(t.str()) }, out: runStarted, on: ['run', '/runId'], level: 'manage', emits: ['run.retried', 'run.started'],
      run: { kind: 'retry', stoppable: true }, tool: 'automations', cli: 'vyre runs retry', errors: ['validation.precondition_failed'],
    }),
    read('runs.preview_undo', 'Show what Undo this run would reverse and what it cannot (sent messages and deployments)', { in: target, out: undoReport, on: ['run', '/runId'], tool: 'automations' }),
    write('runs.undo', 'Undo this run: replay the inverse of its writes for events still at the Run version and report the rest', {
      in: { ...target, reason: t.opt(t.str()) }, out: undoReport, on: ['run', '/runId'], level: 'manage', risk: 'high', emits: ['run.undone'], audit: 'always', tool: 'automations',
      errors: ['validation.precondition_failed', 'permission.on_hold'],
    }),
    write('runs.replay', 'Replay a past Run in the sandbox: outward steps are recorded, never executed; sealed and Restricted values are synthetic unless the replayer holds clearance', {
      in: { ...target, version: t.opt(t.enm('same', 'current')), withClearance: t.opt(t.bool()) }, out: runStarted, on: ['run', '/runId'], perm: 'server.logs',
      emits: ['run.started'], run: { kind: 'replay', stoppable: true }, audit: 'always', tool: 'automations', agent: { planMode: 'blocked' },
    }),
    write('runs.wait_for', 'Wait in the background for an event, another Run or a time; ends the turn and wakes the thread on a match (default timeout 30 days)', {
      in: { on: waitOn, timeout: t.opt(t.str({ description: 'Duration such as 30d or 6h', examples: ['30d'] })), subject: t.opt(resourceRef), threadId: t.opt(id.thread), label: t.opt(t.str()) },
      out: runStarted, emits: ['run.started', 'run.waiting'], run: { kind: 'wait', stoppable: true }, tool: 'automations', mcpName: 'wait_for', agent: { planMode: 'allowed' },
    }),
    write('runs.start', 'Create a Run record (engine, Gate and other modules call this for any long-lived work)', {
      in: {
        kind: runKind, name: t.opt(t.str()), owner: t.str(), subject: t.opt(resourceRef), definitionVersion: t.opt(t.int()), parentRun: t.opt(id.run),
        threadId: t.opt(id.thread), keyUsed: t.opt(t.str()), modelUsed: t.opt(t.str()), trigger: t.opt(runTrigger),
      },
      out: runStarted, emits: ['run.started'], idem: 'key',
    }),
    write('runs.mark_waiting', 'Mark a Run as waiting for approval, background work or a key', {
      in: { ...target, reason: waitReason, taskId: t.opt(id.task), on: t.opt(t.str()) }, out: { run: runRow }, on: ['run', '/runId'], level: 'use', emits: ['run.waiting'],
    }),
    write('runs.resume', 'Continue a waiting Run', { in: { ...target, reason: waitReason }, out: { run: runRow }, on: ['run', '/runId'], level: 'use', emits: ['run.resumed'] }),
    write('runs.record_key', 'Record the key and model a step used, or a fallback to the backup key', {
      in: { ...target, step: t.opt(t.str()), keyUsed: t.str(), modelUsed: t.opt(t.str()), fellBackFrom: t.opt(t.str()), reason: t.opt(t.str()) }, out: { run: runRow },
      on: ['run', '/runId'], level: 'use', emits: ['run.key_fallback'],
    }),
    write('runs.record_step', 'Write one row of the durable step log (state, input and output refs, error, trace span)', {
      in: { ...target, step: t.str(), attempt: t.int({ minimum: 1 }), state: stepState, branch: t.opt(t.str()), inputRef: t.opt(t.str()), outputRef: t.opt(t.str()), error: t.opt(t.obj({ code: t.str(), message: t.str() })), traceSpan: t.opt(t.str()) },
      out: ok, on: ['run', '/runId'], level: 'use', idem: 'natural',
    }),
    write('runs.finish', 'Finish a Run as succeeded, failed or stopped with cost and a one-line result', {
      in: { ...target, status: t.enm('succeeded', 'failed', 'stopped'), summary: t.opt(t.str()), costMicros: t.opt(t.int({ minimum: 0 })), error: t.opt(t.obj({ code: t.str(), message: t.str(), step: t.opt(t.str()) })) },
      out: { run: runRow }, on: ['run', '/runId'], level: 'use', emits: ['run.succeeded', 'run.failed', 'run.stopped'],
    }),
    read('runs.status', 'Cheap health probe of the Run engine: queue depth, oldest queued Run, stuck Runs', {
      in: {}, out: { state: t.enm('healthy', 'degraded', 'down'), detail: t.opt(t.str()), latencyMs: t.opt(t.int()), queued: t.int(), stuck: t.int() },
    }),
  ],
  health: [
    health('run_engine', 'Run engine', 'runs.status', 'Open Failed runs and stop the stuck ones, or restart the server from the Console.', { pauses: ['automations'] }),
  ],
  screens: [
    screen('runs.history', 'automations', 'ui:RunHistory', {
      q: { runs: ['runs.list', { scope: '/state/scope', subject: '/state/subject', statuses: '/state/statuses' }, true] },
      a: { stop: ['runs.stop', { runId: '/state/runId' }], retry: ['runs.retry', { runId: '/state/runId', fromStep: '/state/fromStep' }] },
      empty: 'No runs yet',
    }),
    screen('runs.failed', 'automations', 'ui:FailedRuns', {
      q: { runs: ['runs.list', { scope: '/state/scope', statuses: '/state/statuses' }, true], count: ['runs.count', { scope: '/state/scope', statuses: '/state/statuses' }, true] },
      a: { retry: ['runs.retry', { runId: '/state/runId' }], undo: ['runs.undo', { runId: '/state/runId' }, 'Undo what this run changed?'] },
      empty: 'No failed runs',
    }),
    screen('runs.chat', 'automations', 'ui:RunChat', {
      slot: 'tab',
      q: { run: ['runs.get', { runId: '/route/runId' }, true], steps: ['runs.steps', { runId: '/route/runId' }, true], undo: ['runs.preview_undo', { runId: '/route/runId' }, false] },
      a: {
        stop: ['runs.stop', { runId: '/route/runId' }], retry: ['runs.retry', { runId: '/route/runId', fromStep: '/state/fromStep' }],
        undo: ['runs.undo', { runId: '/route/runId' }, 'Undo what this run changed?'], replay: ['runs.replay', { runId: '/route/runId', version: '/state/version' }],
      },
      empty: 'This run is not available',
    }),
    screen('runs.my-runs', 'home', 'ui:MyRuns', {
      q: { runs: ['runs.list', { scope: '/state/scope', statuses: '/state/statuses' }, true] },
      a: { stop: ['runs.stop', { runId: '/state/runId' }] },
      empty: 'Nothing is running',
    }),
  ],
});
