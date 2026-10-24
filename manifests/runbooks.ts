// runbooks (lane L4): markdown files with fenced sh or bash blocks that get Run buttons (spec 2.16 Runbooks; architecture 7.5).
// A "Runs on" bar picks the server or an agent computer; Run all stops at the first error; output streams inline; every run is kept in History (who, where, when, exit, duration).
// Execution goes through the terminal module on the chosen target. A runbook run is a Run of kind 'runbook'; a failed run lands in the owner's Needs you through the runs module.
// DECISION: runbooks.run checks terminal.use and Use on the file; running on the server itself also needs server.services, which the handler checks when the target is the server.
// DECISION: the chosen target is saved as metadata of the runbook (not in the file bytes, so it adds no version).
import { defineManifest, ev, read, screen, t, write } from '../packages/contracts/src/index.ts';
import { id, pageIn, pageOut, runStarted } from './_common.ts';

const blockId = t.str({ description: 'Stable id of a fenced block: its index and a hash of the code', examples: ['b2_9fc1'] });
const target = t.obj({ kind: t.enm('server', 'computer'), computerId: t.opt(id.computer) }, { description: 'Where the blocks run' });

const blockRow = t.obj({ blockId, index: t.int({ minimum: 0 }), lang: t.enm('sh', 'bash'), code: t.str(), title: t.opt(t.str()), line: t.int({ minimum: 1 }) });
const runState = t.enm('queued', 'running', 'succeeded', 'failed', 'stopped');

const runRow = t.obj({
  runId: id.run, fileId: id.file, versionId: id.version, by: t.str(), target, at: t.ts(), durationMs: t.opt(t.int()), state: runState, exit: t.opt(t.int()),
  all: t.bool(), blocks: t.arr(t.obj({ blockId, exit: t.opt(t.int()), ms: t.opt(t.int()), state: runState })),
});

export default defineManifest({
  id: 'runbooks',
  title: 'Runbooks',
  owner: 'L4',
  events: [
    ev('runbook.run_started', 'A runbook run began', {
      p: { runId: id.run, fileId: id.file, target, blocks: t.int(), all: t.bool(), by: t.str() }, subject: ['file', '/fileId'], label: 'subject', replay: 'stub',
    }),
    ev('runbook.block_finished', 'One block of a runbook finished', {
      p: { runId: id.run, fileId: id.file, blockId, exit: t.int(), ms: t.int() }, subject: ['file', '/fileId'], label: 'subject', retention: 'run_logs', replay: 'stub',
    }),
    ev('runbook.run_finished', 'A runbook run ended', {
      p: { runId: id.run, fileId: id.file, state: runState, exit: t.opt(t.int()), ms: t.int(), failedBlock: t.opt(blockId) }, subject: ['file', '/fileId'], label: 'subject',
      retention: 'run_logs', replay: 'stub', trigger: { title: 'A runbook finishes', fields: ['/fileId', '/state'] },
    }),
    ev('runbook.target_set', 'The Runs on target of a runbook changed', { p: { fileId: id.file, target }, subject: ['file', '/fileId'], label: 'subject' }),
  ],
  capabilities: [
    read('runbooks.list', 'List runbook files (markdown with fenced shell blocks) the caller can open', {
      in: { folder: t.opt(id.folder), ...pageIn },
      out: { runbooks: t.arr(t.obj({ fileId: id.file, name: t.str(), folderId: id.folder, blocks: t.int(), lastRunAt: t.opt(t.ts()), lastState: t.opt(runState) })), ...pageOut },
      tool: 'terminal', label: 'filter',
    }),
    read('runbooks.parse', 'Find the fenced shell blocks of a runbook and the saved Runs on target', {
      in: { fileId: id.file, versionId: t.opt(id.version) }, out: { title: t.opt(t.str()), blocks: t.arr(blockRow), runsOn: t.opt(target) },
      on: ['file', '/fileId'], tool: 'terminal', label: 'check',
    }),
    read('runbooks.targets', 'Places the caller may run on: the server and the agent computers they can use', {
      out: { targets: t.arr(t.obj({ target, name: t.str(), online: t.bool() })) }, tool: 'terminal',
    }),
    write('runbooks.set_target', 'Save where a runbook runs (the Runs on bar)', {
      in: { fileId: id.file, target }, out: { ok: t.bool() }, on: ['file', '/fileId'], perm: 'files.write', emits: ['runbook.target_set'], tool: 'terminal',
    }),
    write('runbooks.run', 'Run one block or all blocks of a runbook on a target; Run all stops at the first error', {
      in: { fileId: id.file, blockId: t.opt(blockId), all: t.opt(t.bool()), target: t.opt(target), versionId: t.opt(id.version) },
      out: runStarted, on: ['file', '/fileId'], perm: 'terminal.use', level: 'use', risk: 'high', idem: 'key', audit: 'always', run: { kind: 'runbook', stoppable: true },
      emits: ['runbook.run_started', 'runbook.block_finished', 'runbook.run_finished'], tool: 'terminal', cli: 'vyre runbook run', errors: ['validation.precondition_failed', 'permission.needs_team'],
    }),
    read('runbooks.runs.list', 'History of runs of a runbook: who, where, when, exit and duration', {
      in: { fileId: id.file, state: t.opt(runState), ...pageIn }, out: { runs: t.arr(runRow), ...pageOut }, on: ['file', '/fileId'], tool: 'terminal', label: 'check',
    }),
    read('runbooks.runs.get', 'One run with the output of each block (kept as run logs)', {
      in: { runId: id.run, blockId: t.opt(blockId), after: t.opt(t.int({ minimum: 0 })) },
      out: { run: runRow, output: t.arr(t.obj({ blockId, seq: t.int(), stream: t.enm('stdout', 'stderr'), text: t.str() })), next: t.opt(t.int()) }, tool: 'terminal', label: 'check',
    }),
  ],
  screens: [
    screen('files.runbook-viewer', 'files', 'ui:RunbookViewer', {
      q: {
        blocks: ['runbooks.parse', { fileId: '/state/fileId', versionId: '/state/versionId' }],
        history: ['runbooks.runs.list', { fileId: '/state/fileId' }],
        targets: ['runbooks.targets'],
        output: ['runbooks.runs.get', { runId: '/state/runId', blockId: '/state/blockId', after: '/state/after' }],
      },
      a: {
        run: ['runbooks.run', { fileId: '/state/fileId', blockId: '/state/blockId', target: '/state/target' }],
        runAll: ['runbooks.run', { fileId: '/state/fileId', all: '/draft/all', target: '/state/target' }],
        setTarget: ['runbooks.set_target', { fileId: '/state/fileId', target: '/draft/target' }],
      },
      needs: ['terminal.use'], empty: 'No shell blocks in this file',
    }),
  ],
});
