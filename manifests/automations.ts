// automations (lane L6): Automation definitions, Groups, versions, Promote, alerts and the trigger palette (spec 2.12, 3.7; architecture 7.7).
// The Run engine itself lives in module runs and steps-core; a definition is a JSON graph (triggers, steps, paths, parallel, wait, loop, approval, stop).
// DECISION: a new Automation always starts Personal (spec 2.4), so automations.create needs only automations.personal; automations.promote needs automations.space.
// DECISION: Personal Automations run with only the owner's access; a Space Automation is a Service principal with access granted to the automation itself.
// DECISION: automations.run (manual start) is named so that no capability name is a prefix of another; run history is runs.list with the automation as subject.
// record_change lists record.created, record.updated and record.deleted; spreadsheet_row lists sheet.row_appended and sheet.row_updated; the filter narrows by op and field.
// DECISION: webhook triggers post to /hooks/automation/<automationId>/<secret>; they are Team Space only (personalOk false), as are the caps that read or rotate the URL.
// DECISION: a schedule trigger stores one cron, a time zone and a missed policy. backfill_each_tick is capped at 30 days and 500 runs; a larger backlog pauses that schedule only.
// Triggers that cover several events (record_change, spreadsheet_row, email_received) list them in TriggerDef.source.events.
import { create, defineManifest, ev, list, read, screen, setting, t, trigger, write } from '../packages/contracts/src/index.ts';
import { id, pageIn, pageOut, runStarted, subjectRef, versionRow } from './_common.ts';

const groupId = t.id('agr');
const status = t.enm('on', 'off', 'draft', 'paused');
const kindEnum = t.enm('personal', 'space');
const assignee = t.obj({ kind: t.enm('person', 'agent', 'group', 'role', 'automation'), id: t.str({ examples: ['usr_a1b2c3'] }) });
const triggerRef = t.obj({ key: t.str({ examples: ['record_change'] }), config: t.opt(t.rec()), filter: t.opt(t.json()) });
const aiBlock = t.obj({
  agentId: t.opt(id.agent), keyId: t.opt(t.str()), backupKeyId: t.opt(t.str()), assigned: t.opt(assignee), reviewer: t.opt(assignee), approver: t.opt(assignee),
  timeoutMinutes: t.opt(t.int({ minimum: 1 })), nudgeMinutes: t.opt(t.int({ minimum: 1 })), escalateTo: t.opt(assignee),
});
const node = t.obj({
  id: t.str({ examples: ['step_1'] }), key: t.str({ description: 'A StepDef key', examples: ['records.update'] }), title: t.opt(t.str()), input: t.rec(),
  next: t.opt(t.arr(t.str())), branches: t.opt(t.arr(t.obj({ label: t.str(), to: t.str(), when: t.opt(t.str()) }))),
  onError: t.opt(t.obj({ mode: t.enm('fail', 'continue', 'retry', 'route'), max: t.opt(t.int({ minimum: 1, maximum: 10 })), route: t.opt(t.str()) })), ai: t.opt(aiBlock),
});
const definition = t.obj({
  triggers: t.arr(triggerRef, { minItems: 1 }), nodes: t.arr(node), start: t.opt(t.arr(t.str())), allowSelfTrigger: t.opt(t.bool()),
});
const alertWhere = t.obj({ needsYou: t.bool(), dm: t.bool(), channelId: t.opt(id.channel) });
const alerts = t.obj({
  who: t.arr(subjectRef), when: t.obj({ mode: t.enm('every', 'after_n'), n: t.opt(t.int({ minimum: 2, maximum: 100 })) }), where: alertWhere,
  escalation: t.arr(t.obj({ to: subjectRef, afterHours: t.int({ minimum: 1 }) }), { description: 'For example Maya, then Admins after 4 hours' }),
});
const summary = t.obj({
  id: id.automation, name: t.str(), kind: kindEnum, groupId: t.opt(groupId), ownerId: t.str(), status, version: t.int({ minimum: 1 }), triggers: t.arr(t.str()),
  updatedAt: t.ts(), lastRun: t.opt(t.obj({ runId: id.run, status: t.str(), at: t.ts() })), failedRuns: t.int({ minimum: 0 }),
});
const row = t.obj({
  id: id.automation, name: t.str(), description: t.opt(t.str()), kind: kindEnum, groupId: t.opt(groupId), ownerId: t.str(), status, pausedReason: t.opt(t.str()),
  version: t.int({ minimum: 1 }), definition, followers: t.arr(t.str()), alerts, createdAt: t.ts(), updatedAt: t.ts(),
});
const groupRow = t.obj({ id: groupId, name: t.str(), count: t.int(), order: t.int() });
const accessDiff = t.obj({
  grants: t.arr(t.obj({ resource: t.str(), level: t.enm('view', 'use', 'edit', 'manage'), via: t.enm('owner_access', 'role', 'new_grant') })),
  vaultNames: t.arr(t.str()), connections: t.arr(t.str()), keysToReplace: t.arr(t.obj({ stepId: t.str(), keyId: t.str(), reason: t.str() })),
});
const target = { automationId: id.automation };
const anyJson = t.json();

const recordFilter = t.obj({ type: id.recordType, op: t.opt(t.enm('created', 'updated', 'deleted')), fields: t.opt(t.arr(t.str())), where: t.opt(anyJson) });
const rowFilter = t.obj({ fileId: id.file, sheet: t.opt(t.str()), op: t.opt(t.enm('added', 'changed')), columns: t.opt(t.arr(t.str())) });

export default defineManifest({
  id: 'automations',
  title: 'Automations',
  owner: 'L6',
  events: [
    ev('automation.created', 'An Automation was created (Personal)', { p: { automationId: id.automation, name: t.str(), kind: kindEnum }, subject: ['automation', '/automationId'] }),
    ev('automation.updated', 'An Automation definition or settings changed; a definition change saves a version', { p: { automationId: id.automation, version: t.int(), fields: t.arr(t.str()) }, subject: ['automation', '/automationId'] }),
    ev('automation.deleted', 'An Automation moved to Trash', { p: { automationId: id.automation }, subject: ['automation', '/automationId'] }),
    ev('automation.restored', 'An Automation came back from Trash', { p: { automationId: id.automation }, subject: ['automation', '/automationId'] }),
    ev('automation.enabled', 'An Automation was turned on', { p: { automationId: id.automation }, subject: ['automation', '/automationId'] }),
    ev('automation.disabled', 'An Automation was turned off or paused', { p: { automationId: id.automation, reason: t.opt(t.str()) }, subject: ['automation', '/automationId'] }),
    ev('automation.version_restored', 'An earlier version was restored as the newest version', { p: { automationId: id.automation, versionId: id.version, version: t.int() }, subject: ['automation', '/automationId'] }),
    ev('automation.promoted', 'A Personal Automation became a Space Automation with access granted to the automation itself', { p: { automationId: id.automation, ownerId: t.str(), grants: t.int(), keysReplaced: t.int() }, subject: ['automation', '/automationId'], retention: 'audit' }),
    ev('automation.copied', 'A Space Automation was copied to a Personal Automation', { p: { automationId: id.automation, fromId: id.automation }, subject: ['automation', '/automationId'] }),
    ev('automation.moved', 'An Automation moved to a Group', { p: { automationId: id.automation, groupId: t.nullable(groupId) }, subject: ['automation', '/automationId'] }),
    ev('automation.alerts_changed', 'Error alerts and the escalation chain changed', { p: { automationId: id.automation }, subject: ['automation', '/automationId'] }),
    ev('automation.follower_added', 'A follower was added', { p: { automationId: id.automation, follower: t.str() }, subject: ['automation', '/automationId'] }),
    ev('automation.follower_removed', 'A follower was removed', { p: { automationId: id.automation, follower: t.str() }, subject: ['automation', '/automationId'] }),
    ev('automation.run_started', 'An Automation run started from a trigger, by hand or in test mode', {
      p: { automationId: id.automation, runId: id.run, trigger: t.str(), version: t.int(), test: t.bool(), depth: t.int({ minimum: 0 }), origin: t.opt(t.str()) },
      subject: ['automation', '/automationId'], retention: 'run_logs', trigger: { title: 'An automation run starts', fields: ['/automationId'] },
    }),
    ev('automation.trigger_dropped', 'A trigger event was ignored: self-trigger, chain depth 8 or paused', { p: { automationId: id.automation, eventId: id.event, reason: t.enm('self_trigger', 'depth_limit', 'paused', 'filter_error') }, subject: ['automation', '/automationId'], retention: 'run_logs' }),
    ev('automation.group_created', 'A Group was created', { p: { groupId, name: t.str() }, subject: ['entity', '/groupId'] }),
    ev('automation.group_renamed', 'A Group was renamed', { p: { groupId, name: t.str() }, subject: ['entity', '/groupId'] }),
    ev('automation.group_deleted', 'A Group was deleted; its Automations became ungrouped', { p: { groupId }, subject: ['entity', '/groupId'] }),
  ],
  capabilities: [
    read('automations.list', 'List Automations by section (Personal, Shared with me, Space), folder and Group', {
      in: { section: t.opt(t.enm('personal', 'shared', 'space')), folder: t.opt(id.folder), groupId: t.opt(groupId), status: t.opt(status), q: t.opt(t.str()), ...pageIn },
      out: { automations: t.arr(summary), ...pageOut }, tool: 'automations', label: 'filter', cli: 'vyre automations list',
    }),
    read('automations.get', 'Read an Automation with its definition, alerts and followers', { in: target, out: { automation: row }, on: ['automation', '/automationId'], tool: 'automations', label: 'check', cli: 'vyre automations get' }),
    create('automations.create', 'Create an Automation; it starts Personal', {
      in: { name: t.str({ minLength: 1 }), description: t.opt(t.str()), definition: t.opt(definition), groupId: t.opt(groupId), folderId: t.opt(id.folder) },
      out: { automation: row }, make: ['automation', '/folderId'], perm: 'automations.personal', emits: ['automation.created'], tool: 'automations', cli: 'vyre automations create',
    }),
    write('automations.update', 'Change the name, description or definition; a definition change saves a new version', {
      in: { ...target, name: t.opt(t.str()), description: t.opt(t.str()), definition: t.opt(definition), expectedVersion: t.opt(t.int()) },
      out: { automation: row }, on: ['automation', '/automationId'], emits: ['automation.updated'], tool: 'automations', errors: ['validation.version_conflict', 'validation.bad_input'],
    }),
    write('automations.set_enabled', 'Turn an Automation on or off', {
      in: { ...target, enabled: t.bool() }, out: { automation: row }, on: ['automation', '/automationId'], emits: ['automation.enabled', 'automation.disabled'], tool: 'automations',
      errors: ['validation.precondition_failed'],
    }),
    write('automations.delete', 'Move an Automation to Trash', {
      in: target, out: { deleted: t.bool() }, on: ['automation', '/automationId'], level: 'manage', gate: { act: 'delete', when: "actor.kind != 'person'" }, emits: ['automation.deleted'], tool: 'automations',
    }),
    write('automations.undelete', 'Restore an Automation from Trash', { in: target, out: { automation: row }, on: ['automation', '/automationId'], level: 'manage', emits: ['automation.restored'], tool: 'automations' }),
    read('automations.versions', 'List versions of an Automation (One History)', { in: target, out: { versions: t.arr(versionRow) }, on: ['automation', '/automationId'], tool: 'automations' }),
    write('automations.restore_version', 'Restore an Automation to an earlier version (saved as a new version)', {
      in: { ...target, versionId: id.version }, out: { automation: row }, on: ['automation', '/automationId'], emits: ['automation.version_restored', 'automation.updated'], tool: 'automations',
      agent: { planMode: 'blocked' },
    }),
    read('automations.validate', 'Check a definition against the step and trigger catalogue: missing inputs, unreachable steps, loops, personal triggers that need a Team Space', {
      in: { definition, kind: t.opt(kindEnum) }, out: { ok: t.bool(), issues: t.arr(t.obj({ nodeId: t.opt(t.str()), severity: t.enm('error', 'warning'), message: t.str() })) }, tool: 'automations',
    }),
    read('automations.triggers.list', 'The trigger palette: every trigger with its payload schema, sample and whether a Personal Space can use it', {
      in: {}, out: { triggers: t.arr(t.obj({ key: t.str(), title: t.str(), payload: anyJson, sample: anyJson, personalOk: t.bool(), allowSelfTrigger: t.bool() })) }, tool: 'automations',
    }),
    read('automations.steps.list', 'The step palette: every step kind with category, input and output schema, effects and Gate act', {
      in: { category: t.opt(t.enm('data', 'send', 'ai', 'control', 'wait', 'code', 'sheet', 'sign', 'journey')) },
      out: { steps: t.arr(t.obj({ key: t.str(), title: t.str(), category: t.str(), kind: t.str(), input: anyJson, output: anyJson, effects: t.enm('read', 'write', 'outward'), gateAct: t.opt(t.str()) })) }, tool: 'automations',
    }),
    write('automations.test', 'Test an Automation with sample data: reads run for real, writes and sends are stubbed (a Run)', {
      in: { ...target, trigger: t.opt(t.str()), sample: t.opt(t.rec()), version: t.opt(t.int()) }, out: runStarted, on: ['automation', '/automationId'], level: 'use',
      emits: ['automation.run_started'], run: { kind: 'automation_test', stoppable: true }, tool: 'automations', cli: 'vyre automations test',
    }),
    write('automations.run', 'Run an Automation now with a payload (the manual trigger or a button)', {
      in: { ...target, payload: t.opt(t.rec()), trigger: t.opt(t.str()) }, out: runStarted, on: ['automation', '/automationId'], level: 'use',
      emits: ['automation.run_started'], run: { kind: 'automation', stoppable: true }, tool: 'automations', hook: true, cli: 'vyre automations run', idem: 'key',
    }),
    write('automations.fire', 'Start a run from a matched trigger event, checking self-trigger origin and the chain depth limit of 8 (called by the trigger consumer)', {
      in: { ...target, trigger: t.str(), eventId: t.opt(id.event), payload: t.rec(), origin: t.opt(t.str()), depth: t.int({ minimum: 0 }) }, out: { runId: t.opt(id.run), dropped: t.opt(t.str()) },
      on: ['automation', '/automationId'], level: 'use', emits: ['automation.run_started', 'automation.trigger_dropped'], run: { kind: 'automation', stoppable: true }, idem: 'key',
    }),
    write('automations.stop', 'Stop one run of an Automation, or all its running runs and pause it', {
      in: { ...target, runId: t.opt(id.run), pause: t.opt(t.bool()) }, out: { stopped: t.int() }, on: ['automation', '/automationId'], level: 'manage', emits: ['automation.disabled'], tool: 'automations',
    }),
    write('automations.retry', 'Retry a failed run of this Automation from the start or from a step', {
      in: { ...target, runId: id.run, fromStep: t.opt(t.str()) }, out: runStarted, on: ['automation', '/automationId'], level: 'use', emits: ['automation.run_started'], run: { kind: 'automation', stoppable: true }, tool: 'automations',
    }),
    write('automations.replay', 'Run a past run again on the same definition version or the current one', {
      in: { ...target, runId: id.run, version: t.enm('same', 'current') }, out: runStarted, on: ['automation', '/automationId'], level: 'use', emits: ['automation.run_started'], run: { kind: 'automation', stoppable: true }, tool: 'automations',
    }),
    read('automations.preview_promote', 'Show what Promote to Space grants as an access diff, and which subscription keys must be replaced by shared API keys', {
      in: target, out: { diff: accessDiff, ready: t.bool() }, on: ['automation', '/automationId'], tool: 'automations',
    }),
    write('automations.promote', 'Promote a Personal Automation to the Space: keeps history and versions, runs on access granted to the automation itself', {
      in: { ...target, confirm: t.lit(true), ownerId: t.opt(t.str({ description: 'Named accountable owner; the caller by default' })), replaceKeys: t.opt(t.arr(t.obj({ stepId: t.str(), keyId: t.str() }))) },
      out: { automation: row, diff: accessDiff }, on: ['automation', '/automationId'], perm: 'automations.space', level: 'manage', risk: 'high', emits: ['automation.promoted'], audit: 'always', tool: 'automations',
      errors: ['validation.precondition_failed'],
    }),
    create('automations.make_personal_copy', 'Make a Personal copy of a Space Automation; it runs with only your access', {
      in: { ...target, name: t.opt(t.str()) }, out: { automation: row }, make: ['automation', '/automationId'], perm: 'automations.personal', emits: ['automation.copied', 'automation.created'], tool: 'automations',
    }),
    write('automations.move', 'Move an Automation into a Group, or out with null', {
      in: { ...target, groupId: t.nullable(groupId) }, out: { automation: row }, on: ['automation', '/automationId'], emits: ['automation.moved'], tool: 'automations', offline: 'queue',
    }),
    read('automations.alerts.get', 'Read error alerts: who, when and where, and the escalation chain', { in: target, out: { alerts }, on: ['automation', '/automationId'], tool: 'automations' }),
    write('automations.alerts.set', 'Set error alerts: who, when (every failure or after N in a row), where (Needs you, DM, channel), and the escalation chain', {
      in: { ...target, alerts }, out: { alerts }, on: ['automation', '/automationId'], level: 'manage', emits: ['automation.alerts_changed'], tool: 'automations',
    }),
    write('automations.followers.add', 'Follow an Automation to get its updates', {
      in: { ...target, follower: t.str({ examples: ['usr_a1b2c3'] }) }, out: { followers: t.arr(t.str()) }, on: ['automation', '/automationId'], emits: ['automation.follower_added'], tool: 'automations',
    }),
    write('automations.followers.remove', 'Stop following an Automation', {
      in: { ...target, follower: t.str({ examples: ['usr_a1b2c3'] }) }, out: { followers: t.arr(t.str()) }, on: ['automation', '/automationId'], emits: ['automation.follower_removed'], tool: 'automations',
    }),
    read('automations.webhook_url.get', 'The inbound webhook URL of an Automation that has a webhook trigger', {
      in: target, out: { url: t.str(), method: t.lit('POST') }, on: ['automation', '/automationId'], level: 'edit', tool: 'automations', team: true,
    }),
    write('automations.webhook_url.rotate', 'Rotate the secret in the webhook URL; the old URL stops working', {
      in: { ...target, confirm: t.lit(true) }, out: { url: t.str() }, on: ['automation', '/automationId'], level: 'manage', risk: 'high', audit: 'always', tool: 'automations', team: true,
    }),
    read('automations.groups.list', 'List Groups with Automation counts', { in: {}, out: { groups: t.arr(groupRow) }, tool: 'automations' }),
    write('automations.groups.create', 'Create a Group', {
      in: { name: t.str({ minLength: 1 }) }, out: { group: groupRow }, perm: 'automations.personal', idem: 'key', emits: ['automation.group_created'], tool: 'automations',
    }),
    write('automations.groups.rename', 'Rename a Group', {
      in: { groupId, name: t.str({ minLength: 1 }) }, out: { group: groupRow }, on: ['automation_group', '/groupId'], emits: ['automation.group_renamed'], tool: 'automations',
    }),
    write('automations.groups.delete', 'Delete a Group; its Automations become ungrouped', {
      in: { groupId }, out: { deleted: t.bool() }, on: ['automation_group', '/groupId'], level: 'manage', emits: ['automation.group_deleted'], tool: 'automations',
    }),
  ],
  triggers: [
    trigger('record_change', 'A record changes', { events: ['record.created', 'record.updated', 'record.deleted'], filter: recordFilter },
      { record: t.rec(), recordId: id.record, type: id.recordType, op: t.enm('created', 'updated', 'deleted'), fields: t.arr(t.str()), changed: t.opt(t.rec()), version: t.opt(t.int()) }),
    trigger('schedule', 'On a schedule', {
      schedule: true,
      ifMissed: ['skip', 'run_once', 'backfill_each_tick'],
      lookbackMaxDays: 30,
      capMax: 500,
      spacing: true,
      overlap: ['queue', 'skip_while_active', 'bounded_concurrency'],
    }, { firedAt: t.ts(), scheduledFor: t.ts(), missed: t.bool(), cron: t.opt(t.str()) }),
    trigger('webhook', 'A webhook is received', { webhook: true, path: '/hooks/automation/{automationId}' },
      { headers: t.rec(t.str()), query: t.rec(t.str()), body: anyJson, receivedAt: t.ts() }),
    trigger('form_submit', 'A form is submitted', { event: 'form.submitted' },
      { formId: id.form, recordId: id.record, type: id.recordType, matched: t.bool() }),
    trigger('email_received', 'An email is received', { events: ['mail.received', 'sms.received'] },
      { messageId: t.str(), mailboxId: id.mailbox, from: t.str(), subject: t.str(), contactId: t.opt(id.record), campaignId: t.opt(id.campaign) }),
    trigger('chat_message', 'A chat message is posted', { event: 'message.received' },
      { messageId: id.message, threadId: id.thread, threadSeq: t.int(), author: t.obj({ kind: t.str(), id: t.str() }), kind: t.str(), depth: t.int() }),
    trigger('spreadsheet_row', 'A spreadsheet row is added or changed', { events: ['sheet.row_appended', 'sheet.row_updated'], filter: rowFilter },
      { fileId: id.file, sheet: t.str(), rowId: t.str(), op: t.enm('added', 'changed'), columns: t.opt(t.arr(t.str())) }),
    trigger('ci_check', 'A CI check finishes', { event: 'github.check_completed' },
      { repo: t.str(), branch: t.str(), sha: t.str(), name: t.str(), conclusion: t.enm('success', 'failure', 'cancelled', 'neutral'), url: t.opt(t.str()) }),
    trigger('meeting_transcript_ready', 'A meeting transcript is ready', { event: 'meeting.transcript_ready' },
      { meetingId: id.record, source: t.str() }),
    trigger('journey_stage_entered', 'A Journey record enters a stage', { event: 'journey.stage_entered' },
      { journeyId: id.journey, recordId: id.record, stage: t.str(), previousStage: t.opt(t.str()), manual: t.bool() }),
    trigger('journey_stage_left', 'A Journey record leaves a stage', { event: 'journey.stage_exited' },
      { journeyId: id.journey, recordId: id.record, stage: t.str(), toStage: t.opt(t.str()) }),
    trigger('campaign_reply', 'A campaign gets a reply', { event: 'campaign.replied' },
      { campaignId: id.campaign, recordId: id.record, messageId: id.message }),
    trigger('button', 'A button is pressed', { button: true },
      { recordId: t.opt(id.record), type: t.opt(id.recordType), pressedBy: t.str(), label: t.opt(t.str()) }),
    trigger('manual', 'Run by hand', { manual: true },
      { startedBy: t.str(), input: t.opt(t.rec()) }),
  ],
  lists: [list('automation', 'Automation', 'Automations', 'automations.list')],
  settings: [
    setting('automations.default_error_alert', 'space', 'Automations', 'Default error alert for new Space Automations', t.obj({ when: t.enm('every', 'after_n'), n: t.opt(t.int()), where: t.enm('needs_you', 'dm') }), { when: 'every', where: 'needs_you' }),
    setting('automations.max_chain_depth', 'space', 'Automations', 'Chain depth after which events stop retriggering', t.int({ minimum: 1, maximum: 8 }), 8),
    setting('automations.run_automations_on_import', 'space', 'Automations', 'Importers and sync backfill fire Automations (off by default)', t.bool(), false),
  ],
  screens: [
    screen('automations.sidebar', 'automations', 'ui:AutomationsSidebar', {
      slot: 'sidebar',
      q: {
        automations: ['automations.list', { section: '/state/section', folder: '/state/folder', groupId: '/state/groupId', status: '/state/status', q: '/state/q' }, true],
        groups: ['automations.groups.list', {}, true], journeys: ['journeys.list', {}, true],
      },
      a: {
        create: ['automations.create', { name: '/draft/name', groupId: '/state/groupId', folderId: '/state/folder' }],
        createGroup: ['automations.groups.create', { name: '/draft/groupName' }], renameGroup: ['automations.groups.rename', { groupId: '/state/groupId', name: '/draft/groupName' }],
        deleteGroup: ['automations.groups.delete', { groupId: '/state/groupId' }, 'Delete this Group? Its Automations stay.'],
        move: ['automations.move', { automationId: '/state/automationId', groupId: '/state/groupId' }],
        delete: ['automations.delete', { automationId: '/state/automationId' }, 'Move this Automation to Trash?'],
      },
      empty: 'No automations yet', primary: 'New automation', needs: ['automations.personal'],
    }),
    screen('automations.canvas', 'automations', 'ui:AutomationCanvas', {
      slot: 'tab',
      q: {
        automation: ['automations.get', { automationId: '/route/automationId' }, true], triggers: ['automations.triggers.list', {}, false], steps: ['automations.steps.list', { category: '/state/category' }, false],
        validation: ['automations.validate', { definition: '/draft/definition', kind: '/state/kind' }, false],
      },
      a: {
        save: ['automations.update', { automationId: '/route/automationId', name: '/draft/name', definition: '/draft/definition', expectedVersion: '/draft/version' }],
        test: ['automations.test', { automationId: '/route/automationId', trigger: '/state/trigger', sample: '/state/sample' }],
        run: ['automations.run', { automationId: '/route/automationId', payload: '/state/payload' }],
        enable: ['automations.set_enabled', { automationId: '/route/automationId', enabled: '/state/enabled' }],
        stop: ['automations.stop', { automationId: '/route/automationId', runId: '/state/runId' }],
        copy: ['automations.make_personal_copy', { automationId: '/route/automationId', name: '/draft/name' }],
      },
      empty: 'This Automation is not available', needs: ['automations.personal'],
    }),
    screen('automations.config', 'automations', 'ui:AutomationConfig', {
      slot: 'side',
      q: {
        automation: ['automations.get', { automationId: '/route/automationId' }, true], alerts: ['automations.alerts.get', { automationId: '/route/automationId' }, true],
        versions: ['automations.versions', { automationId: '/route/automationId' }, false], runs: ['runs.list', { scope: '/state/scope', subject: '/state/subject', statuses: '/state/statuses' }, true],
      },
      a: {
        setAlerts: ['automations.alerts.set', { automationId: '/route/automationId', alerts: '/draft/alerts' }],
        restore: ['automations.restore_version', { automationId: '/route/automationId', versionId: '/state/versionId' }, 'Restore this version?'],
        follow: ['automations.followers.add', { automationId: '/route/automationId', follower: '/state/follower' }],
        unfollow: ['automations.followers.remove', { automationId: '/route/automationId', follower: '/state/follower' }],
        webhookUrl: ['automations.webhook_url.rotate', { automationId: '/route/automationId', confirm: '/state/confirm' }, 'Rotate the webhook URL? The old one stops working.'],
        retry: ['automations.retry', { automationId: '/route/automationId', runId: '/state/runId', fromStep: '/state/fromStep' }],
        replay: ['automations.replay', { automationId: '/route/automationId', runId: '/state/runId', version: '/state/version' }],
      },
      empty: 'No settings to show',
    }),
    screen('automations.promote', 'automations', 'ui:PromoteSheet', {
      slot: 'sheet',
      q: { preview: ['automations.preview_promote', { automationId: '/route/automationId' }, false] },
      a: { promote: ['automations.promote', { automationId: '/route/automationId', confirm: '/state/confirm', ownerId: '/draft/ownerId', replaceKeys: '/draft/replaceKeys' }, 'Promote to the Space? It will run on the access shown.'] },
      needs: ['automations.space'], empty: 'Nothing to promote',
    }),
  ],
});
