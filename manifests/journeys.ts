// journeys (lane L6): one piece of work lasting days or weeks, moving through stages with tasks for people and agents (spec 2.12, 3.7).
// Each Journey is a record type cloned from the Projects template; creating one makes its record type through a controlled path that needs only
// `journeys.manage`. A required Subject relation points at another record type; the Start rule (an event plus filter) compiles to an Automation.
// DECISION (spec Appendix B, b3, Provisional): a stage advances when its required tasks are done; a designer can move a record by hand with a reason;
// a stage time limit breach reaches the owner Needs you, then the escalation role; handoffs post in the record channel.
// DECISION: journey definitions are versioned; journeys.versions lists them, but there is no restore_version because in-flight records stay on their
// version until journeys.migrate runs with a stage mapping. Journeys are not in the versioned-resource-type list of the validation rule.
// DECISION: a stage in use (records in it) cannot be deleted from the design; journeys.design refuses with validation.precondition_failed and the blocking stage keys.
import { defineManifest, ev, read, screen, t, write, create } from '../packages/contracts/src/index.ts';
import { id, pageIn, pageOut, runStarted, versionRow } from './_common.ts';

const assignee = t.obj({ kind: t.enm('person', 'agent', 'group', 'role', 'automation'), id: t.str({ examples: ['usr_a1b2c3'] }) });
const stageKey = t.str({ pattern: '^[a-z][a-z0-9_]*$', examples: ['intake'] });
const taskTemplate = t.obj({
  key: t.str({ pattern: '^[a-z][a-z0-9_]*$', examples: ['collect_documents'] }), title: t.str(), description: t.opt(t.str()),
  kind: t.opt(t.enm('work', 'approve', 'review', 'answer', 'unblock', 'signature')),
  assigned: assignee, reviewer: t.opt(assignee), approver: t.opt(assignee), required: t.bool(), dueAfterHours: t.opt(t.int({ minimum: 1 })),
  keyId: t.opt(t.str({ description: 'Inference key for an agent task' })), backupKeyId: t.opt(t.str()), doneByAutomation: t.opt(id.automation),
});
const timeLimit = t.obj({ hours: t.int({ minimum: 1 }), escalateTo: t.opt(t.obj({ kind: t.enm('role', 'person'), id: t.str() })) });
const exitRule = t.obj({ requireTasks: t.bool(), manualOnly: t.opt(t.bool()) });
const stage = t.obj({
  key: stageKey, title: t.str(), order: t.int({ minimum: 0 }), exit: exitRule, timeLimit: t.opt(timeLimit), tasks: t.arr(taskTemplate),
  automations: t.arr(id.automation, { description: 'Automations that run when a record enters the stage' }), final: t.opt(t.bool()),
  onLeaving: t.opt(t.arr(id.automation, { description: 'Automations that run when a record leaves the stage' })),
});
const startRule = t.obj({ event: t.str({ examples: ['record.created'] }), filter: t.opt(t.json()), enabled: t.bool() });
const journeyRow = t.obj({
  id: id.journey, name: t.str(), subjectType: id.recordType, recordType: id.recordType, version: t.int({ minimum: 1 }), stages: t.arr(stage),
  startRule: t.opt(startRule), startAutomationId: t.opt(id.automation), inFlight: t.int({ minimum: 0 }), createdAt: t.ts(), updatedAt: t.ts(),
});
const journeySummary = t.obj({ id: id.journey, name: t.str(), subjectType: id.recordType, recordType: id.recordType, version: t.int(), stages: t.int(), inFlight: t.int(), updatedAt: t.ts() });
const target = { journeyId: id.journey };
// A task as the designer shows it on a record: the template key, its stage and the state of the task made for it.
// todo covers todo and doing; in_review covers in_review and awaiting_approval; blocked is a task that waits on something; done is done. A withdrawn task is not listed.
const journeyTaskState = t.enm('todo', 'in_review', 'blocked', 'done');
const journeyTask = t.obj({ stage: stageKey, taskKey: t.str(), taskId: id.task, title: t.str(), state: journeyTaskState, required: t.bool(), assigned: t.opt(assignee) });
const mapping = t.rec(t.str({ description: 'New stage key for an old stage key' }));

export default defineManifest({
  id: 'journeys',
  title: 'Journeys',
  owner: 'L6',
  events: [
    ev('journey.created', 'A Journey and its record type were created', { p: { journeyId: id.journey, name: t.str(), recordType: id.recordType, subjectType: id.recordType }, subject: ['entity', '/journeyId'] }),
    ev('journey.designed', 'The Journey design changed (stages, tasks, rules or start rule); a new version', { p: { journeyId: id.journey, version: t.int(), stages: t.arr(stageKey), by: t.str() }, subject: ['entity', '/journeyId'] }),
    ev('journey.deleted', 'A Journey was deleted', { p: { journeyId: id.journey, recordType: id.recordType }, subject: ['entity', '/journeyId'] }),
    ev('journey.started', 'A subject record started a Journey and its Journey record was created', { p: { journeyId: id.journey, recordId: id.record, subjectRecordId: id.record, stage: stageKey, version: t.int() }, subject: ['record', '/recordId'], label: 'subject', trigger: { title: 'A Journey starts', fields: ['/journeyId'] } }),
    ev('journey.stage_entered', 'A Journey record entered a stage', {
      p: { journeyId: id.journey, recordId: id.record, stage: stageKey, previousStage: t.opt(stageKey), version: t.int(), manual: t.bool(), reason: t.opt(t.str()) },
      subject: ['record', '/recordId'], label: 'subject', trigger: { title: 'A Journey record enters a stage', fields: ['/journeyId', '/stage'] },
    }),
    ev('journey.stage_exited', 'A Journey record left a stage', {
      p: { journeyId: id.journey, recordId: id.record, stage: stageKey, toStage: t.opt(stageKey) }, subject: ['record', '/recordId'], label: 'subject',
      trigger: { title: 'A Journey record leaves a stage', fields: ['/journeyId', '/stage'] },
    }),
    ev('journey.moved', 'A designer moved a record by hand, with a reason', { p: { journeyId: id.journey, recordId: id.record, fromStage: stageKey, toStage: stageKey, reason: t.str(), by: t.str() }, subject: ['record', '/recordId'], label: 'subject' }),
    ev('journey.completed', 'A Journey record reached a final stage', { p: { journeyId: id.journey, recordId: id.record, stage: stageKey }, subject: ['record', '/recordId'], label: 'subject', trigger: { title: 'A Journey completes', fields: ['/journeyId'] } }),
    ev('journey.time_limit_breached', 'A stage time limit passed; it reaches the owner Needs you, then the escalation role', { p: { journeyId: id.journey, recordId: id.record, stage: stageKey, limitHours: t.int(), escalated: t.bool() }, subject: ['record', '/recordId'], label: 'subject', trigger: { title: 'A Journey stage runs over its time limit', fields: ['/journeyId', '/stage'] } }),
    ev('journey.migrated', 'In-flight records moved to a new Journey version through a stage mapping', { p: { journeyId: id.journey, fromVersion: t.int(), toVersion: t.int(), records: t.int(), runId: id.run }, subject: ['entity', '/journeyId'] }),
  ],
  capabilities: [
    read('journeys.list', 'List Journeys with their stages count and in-flight records', { in: { ...pageIn }, out: { journeys: t.arr(journeySummary), ...pageOut }, tool: 'automations', label: 'filter', cli: 'vyre journeys list' }),
    read('journeys.get', 'Read a Journey design: stages, tasks, rules, time limits and the start rule', { in: target, out: { journey: journeyRow }, tool: 'automations', label: 'check', cli: 'vyre journeys get' }),
    create('journeys.create', 'Create a Journey and its record type (cloned from the Projects template) on a subject record type', {
      in: { name: t.str({ minLength: 1 }), subjectType: id.recordType, stages: t.opt(t.arr(stage)), startRule: t.opt(startRule) },
      out: { journey: journeyRow }, make: ['record_type', '/subjectType'], perm: 'journeys.manage', emits: ['journey.created', 'journey.designed'], tool: 'automations', cli: 'vyre journeys create',
      errors: ['validation.duplicate', 'validation.precondition_failed'],
    }),
    write('journeys.design', 'Replace the design: stages, tasks with Assigned, Reviewer and Approver, stage automations, exit rules, time limits and the start rule', {
      in: { ...target, stages: t.arr(stage, { minItems: 1 }), startRule: t.opt(t.nullable(startRule)), expectedVersion: t.opt(t.int()), note: t.opt(t.str()) },
      out: { journey: journeyRow, startAutomationId: t.opt(id.automation) }, perm: 'journeys.manage', level: 'edit', emits: ['journey.designed'], tool: 'automations', audit: 'sensitive',
      errors: ['validation.precondition_failed', 'validation.version_conflict'],
    }),
    write('journeys.rules.set', 'Set the exit rule and time limit of one stage', {
      in: { ...target, stageKey, exit: t.opt(exitRule), timeLimit: t.opt(t.nullable(timeLimit)) }, out: { journey: journeyRow }, perm: 'journeys.manage', emits: ['journey.designed'], tool: 'automations',
    }),
    write('journeys.rename', 'Rename a Journey', { in: { ...target, name: t.str({ minLength: 1 }) }, out: { journey: journeyRow }, perm: 'journeys.manage', emits: ['journey.designed'], tool: 'automations' }),
    write('journeys.delete', 'Delete a Journey with no records in flight', {
      in: target, out: { deleted: t.bool() }, perm: 'journeys.manage', level: 'manage', risk: 'high', gate: { act: 'delete', when: "actor.kind != 'person'" }, emits: ['journey.deleted'], audit: 'always', tool: 'automations',
      errors: ['validation.precondition_failed'],
    }),
    read('journeys.tasks', 'The tasks of one Journey record by stage, each with its state (todo, in review, blocked, done)', {
      in: { recordId: id.record, stage: t.opt(stageKey) }, out: { tasks: t.arr(journeyTask) }, on: ['record', '/recordId'], tool: 'automations', label: 'filter',
    }),
    read('journeys.versions', 'List versions of a Journey definition', { in: target, out: { versions: t.arr(versionRow) }, tool: 'automations' }),
    write('journeys.start', 'Start a Journey on a subject record: creates the Journey record with its channel and folder and enters the first stage', {
      in: { ...target, subjectRecordId: id.record, startStage: t.opt(stageKey) }, out: { recordId: id.record, stage: stageKey },
      on: ['record', '/subjectRecordId'], emits: ['journey.started', 'journey.stage_entered'], idem: 'key', tool: 'automations', hook: true, errors: ['validation.duplicate', 'validation.precondition_failed'],
    }),
    write('journeys.move_stage', 'Move a Journey record to another stage by hand; the reason is required and handoffs post in the record channel', {
      in: { ...target, recordId: id.record, toStage: stageKey, reason: t.str({ minLength: 1 }) }, out: { recordId: id.record, stage: stageKey },
      on: ['record', '/recordId'], perm: 'journeys.manage', emits: ['journey.stage_exited', 'journey.stage_entered', 'journey.moved', 'journey.completed'], tool: 'automations', hook: true, audit: 'sensitive',
      errors: ['validation.precondition_failed'],
    }),
    write('journeys.advance', 'Check the exit rule of the current stage and advance when its required tasks are done (called on task.completed)', {
      in: { recordId: id.record }, out: { advanced: t.bool(), stage: t.opt(stageKey) }, on: ['record', '/recordId'],
      emits: ['journey.stage_exited', 'journey.stage_entered', 'journey.completed'], idem: 'natural',
    }),
    read('journeys.stage_counts', 'Records in flight per stage, with how many are over their time limit', {
      in: target, out: { stages: t.arr(t.obj({ stage: stageKey, count: t.int(), overLimit: t.int() })) }, tool: 'automations',
    }),
    read('journeys.preview_migrate', 'Preview a migration: records per old stage, where each goes, unmapped stages and blockers', {
      in: { ...target, toVersion: t.int({ minimum: 1 }), stageMap: t.opt(mapping) },
      out: { fromVersion: t.int(), toVersion: t.int(), recordsAffected: t.int(), moves: t.arr(t.obj({ from: stageKey, to: t.nullable(stageKey), records: t.int() })), unmapped: t.arr(stageKey), blockers: t.arr(t.str()) },
      perm: 'journeys.manage', tool: 'automations',
    }),
    write('journeys.migrate', 'Migrate in-flight records to a new Journey version through a stage mapping (a Run; stoppable)', {
      in: { ...target, toVersion: t.int({ minimum: 1 }), stageMap: mapping, recordIds: t.opt(t.arr(id.record)) }, out: runStarted,
      perm: 'journeys.manage', level: 'manage', risk: 'high', emits: ['journey.migrated', 'journey.stage_exited', 'journey.stage_entered'], run: { kind: 'journey_migrate', stoppable: true },
      audit: 'always', tool: 'automations', errors: ['validation.precondition_failed'],
    }),
    write('journeys.check_limits', 'Find stages over their time limit, raise Needs you for the owner then the escalation role (called by the scheduler)', {
      in: {}, out: { breached: t.int() }, emits: ['journey.time_limit_breached'], idem: 'natural',
    }),
  ],
  screens: [
    screen('journeys.designer', 'automations', 'ui:JourneyDesigner', {
      slot: 'tab',
      q: {
        journey: ['journeys.get', { journeyId: '/route/journeyId' }, true], versions: ['journeys.versions', { journeyId: '/route/journeyId' }, false],
        counts: ['journeys.stage_counts', { journeyId: '/route/journeyId' }, true],
      },
      a: {
        design: ['journeys.design', { journeyId: '/route/journeyId', stages: '/draft/stages', startRule: '/draft/startRule', expectedVersion: '/draft/version', note: '/draft/note' }],
        rules: ['journeys.rules.set', { journeyId: '/route/journeyId', stageKey: '/state/stageKey', exit: '/draft/exit', timeLimit: '/draft/timeLimit' }],
        rename: ['journeys.rename', { journeyId: '/route/journeyId', name: '/draft/name' }],
        preview: ['journeys.preview_migrate', { journeyId: '/route/journeyId', toVersion: '/state/toVersion', stageMap: '/draft/stageMap' }],
        migrate: ['journeys.migrate', { journeyId: '/route/journeyId', toVersion: '/state/toVersion', stageMap: '/draft/stageMap' }, 'Move records to the new version?'],
        delete: ['journeys.delete', { journeyId: '/route/journeyId' }, 'Delete this Journey?'],
      },
      needs: ['journeys.manage'], empty: 'This Journey is not available',
    }),
    screen('journeys.new', 'automations', 'ui:JourneyNewSheet', {
      slot: 'sheet', q: {},
      a: { create: ['journeys.create', { name: '/draft/name', subjectType: '/draft/subjectType', stages: '/draft/stages', startRule: '/draft/startRule' }] },
      needs: ['journeys.manage'], empty: 'Name the Journey and pick the record it follows',
    }),
  ],
});
