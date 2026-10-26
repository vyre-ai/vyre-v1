// conflicts (lane L1): ARCHITECTURE-V1.md 5.5 and spec 4.11. Consumes conflict.opened (declared by sync), has the person's
// assistant propose a per-field choice, applies it as the person with an Undo op, and lists every resolution in the Conflicts tab.
// DECISION: conflict values (ours, theirs, base) are opaque JSON; the entity stores them as JSON text because the field type
//   catalogue has no json type. Restricted-label conflicts set plainChoice and never reach a provider.
// DECISION: `conflict.opened` is declared by the sync module because sync.push emits it; this module declares the other conflict.* events.
import { create, defineManifest, entity, ev, read, screen, t, write } from '../packages/contracts/src/index.ts';
import { id, pageIn, pageOut } from './_common.ts';

const state = t.enm('open', 'proposed', 'needs_you', 'resolved', 'undone');
const choice = t.enm('ours', 'theirs', 'merged', 'custom');
const conflictRow = t.obj({
  conflictId: id.conflict, entity: t.str({ examples: ['rt_contact'] }), recordId: t.str(), field: t.str(),
  ours: t.json(), theirs: t.json(), base: t.json(), state, plainChoice: t.bool(), protectedField: t.bool(),
  proposal: t.opt(t.obj({ choice, value: t.json(), summary: t.str() })),
  resolution: t.opt(t.obj({ resolutionId: t.str({ pattern: '^res_[a-z0-9]+$', examples: ['res_a1b2c3'] }), choice, summary: t.str(), by: t.str(), at: t.ts(), canUndo: t.bool(), canRedo: t.bool() })),
  openedAt: t.ts(), taskId: t.opt(id.task), runId: t.opt(id.run),
});
const resolutionId = t.str({ pattern: '^res_[a-z0-9]+$', examples: ['res_a1b2c3'] });
const target = { conflictId: id.conflict };

export default defineManifest({
  id: 'conflicts',
  title: 'Conflicts',
  owner: 'L1',
  entities: [
    entity('conflict', 'conflicts_conflict', 'cfl_', {
      entity: 'text', recordId: 'text', field: 'text', ours: 'longtext', theirs: 'longtext', base: 'longtext',
      state: 'status', plainChoice: 'checkbox', summary: 'text', openedAt: 'datetime', person: 'person',
    }, 'space', { ownerField: 'person', sync: { maxLabel: 'confidential', protectedFields: ['state'] } }),
  ],
  capabilities: [
    read('conflicts.list', 'List conflicts and resolutions for the Conflicts tab', {
      in: { state: t.opt(t.arr(state)), entity: t.opt(t.str()), since: t.opt(t.ts()), ...pageIn }, out: { conflicts: t.arr(conflictRow), ...pageOut },
      label: 'filter', tool: 'meta',
    }),
    read('conflicts.get', 'Read one conflict with both values, the base, the proposal and the resolution', {
      in: target, out: { conflict: conflictRow }, label: 'check', tool: 'meta', errors: ['validation.not_found'],
    }),
    read('conflicts.counts', 'Counts of open, needs-you and resolved conflicts for the sync status line', {
      out: { open: t.int(), needsYou: t.int(), resolved: t.int() }, tool: 'meta',
    }),
    read('conflicts.field_history', 'Previous values and merge losers of one field (field_history joined to resolutions)', {
      in: { entity: t.str(), recordId: t.str(), field: t.str() },
      out: { entries: t.arr(t.obj({ value: t.json(), hlc: t.str(), actor: t.str(), reason: t.enm('lww_loser', 'resolved', 'superseded'), at: t.ts() })) },
      label: 'check', tool: 'meta',
    }),
    write('conflicts.assist', 'Start the assistant run that compares both sides of a non-restricted conflict (never started for Restricted fields)', {
      in: target, out: { runId: id.run }, emits: ['conflict.proposed', 'conflict.confirmation_needed', 'conflict.resolved'], run: { kind: 'conflict_assist', stoppable: true },
      idem: 'natural', risk: 'low', errors: ['permission.provider_label'],
    }),
    write('conflicts.propose', 'Store the assistant proposal for a conflict; protected fields (status, money, owner, locked, sealed) go to Needs you for confirmation, others resolve', {
      in: { ...target, choice, value: t.opt(t.json()), summary: t.str({ description: 'One line shown in the Conflicts tab' }) },
      out: { state },
      emits: ['conflict.proposed', 'conflict.confirmation_needed', 'conflict.resolved'], idem: 'natural', risk: 'medium',
    }),
    write('conflicts.resolve', 'Resolve a conflict with a choice and a summary; applies the value as the person and writes an Undo op', {
      in: { ...target, choice, value: t.opt(t.json()), summary: t.str() },
      out: { resolutionId, state }, emits: ['conflict.resolved'], tool: 'meta', offline: 'queue', audit: 'sensitive',
      errors: ['validation.field_locked', 'permission.on_hold', 'validation.precondition_failed'],
    }),
    write('conflicts.confirm', 'Confirm the assistant proposal on a protected field (the Answer task action in Needs you)', {
      in: target, out: { resolutionId, state }, emits: ['conflict.resolved'], tool: 'meta', audit: 'sensitive', errors: ['validation.precondition_failed'],
    }),
    write('conflicts.undo', 'Undo a resolution: re-applies the previous value as a normal op', {
      in: { resolutionId }, out: { state }, emits: ['conflict.undone'], tool: 'meta', offline: 'queue', errors: ['validation.precondition_failed'],
    }),
    write('conflicts.redo', 'Redo an undone resolution', {
      in: { resolutionId }, out: { state }, emits: ['conflict.redone'], tool: 'meta', offline: 'queue', errors: ['validation.precondition_failed'],
    }),
    create('conflicts.log_binary', 'Record a binary file conflict: the newest save stays current and the other becomes a labelled version with a Conflicts row', {
      in: { fileId: id.file, currentVersionId: id.version, otherVersionId: id.version, label: t.str() },
      out: { conflictId: id.conflict }, emits: ['conflict.binary_logged'], risk: 'low',
    }),
  ],
  events: [
    ev('conflict.proposed', 'The assistant proposed a choice for a conflict', {
      p: { conflictId: id.conflict, choice: t.str(), protectedField: t.bool() }, subject: ['entity', '/conflictId'], label: 'subject',
    }),
    ev('conflict.confirmation_needed', 'A protected field conflict waits for the person to confirm or choose', {
      p: { conflictId: id.conflict, taskId: id.task, plainChoice: t.bool() }, subject: ['entity', '/conflictId'], vis: 'owner', notify: 'conflict.needs_you', label: 'subject',
    }),
    ev('conflict.resolved', 'A conflict was resolved (summary and choice, values never in the payload)', {
      p: { conflictId: id.conflict, resolutionId, choice: t.str(), by: t.str(), summary: t.str() },
      subject: ['entity', '/conflictId'], label: 'subject', redact: ['/summary'],
    }),
    ev('conflict.undone', 'A resolution was undone', { p: { conflictId: id.conflict, resolutionId }, subject: ['entity', '/conflictId'], label: 'subject' }),
    ev('conflict.redone', 'An undone resolution was restored', { p: { conflictId: id.conflict, resolutionId }, subject: ['entity', '/conflictId'], label: 'subject' }),
    ev('conflict.binary_logged', 'Two saves of a binary file collided; the other became a labelled version', {
      p: { conflictId: id.conflict, fileId: id.file, versionId: id.version }, subject: ['file', '/fileId'], label: 'subject',
    }),
  ],
  screens: [
    screen('shell.conflicts-tab', 'shell', 'ui:ConflictsTab', {
      slot: 'tab',
      q: { conflicts: ['conflicts.list', { state: '/filter/state' }, true], counts: ['conflicts.counts', {}, true] },
      a: { undo: ['conflicts.undo', { resolutionId: '/selected/resolutionId' }], redo: ['conflicts.redo', { resolutionId: '/selected/resolutionId' }], resolve: ['conflicts.resolve', { conflictId: '/selected/conflictId' }], confirm: ['conflicts.confirm', { conflictId: '/selected/conflictId' }] },
      empty: 'No conflicts', primary: 'Close',
    }),
  ],
});
