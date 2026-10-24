// steps-core (lane L6): the StepDefs every Automation, Journey and Campaign can use (spec 2.12, 2.16): plain data steps, send, AI, task, Journey,
// wait, control (if, paths, parallel, loop, stop, approval), spreadsheet, sign and code. Other modules add a step only for a capability they own.
// Spreadsheets (spec 2.16) are table files owned by module files: the sheet steps wrap files' sheets.* capabilities and row events, no sheets.* is declared here.
// DECISION: control steps (if, paths, parallel, loop, stop) have no capability; the Run engine evaluates them. approval creates an Approve task and waits.
// DECISION: Update rows and Delete rows call sheets.update_row and sheets.delete_row for one row (by row id or key column); many rows are Find rows plus Loop.
//   Each write is a file version labelled with the automation and run, which is what lets "Undo this run" and the row trigger work.
// NOT EXPRESSIBLE: step input mapping and templating ({{ }} expressions over earlier outputs) are plain strings here; the schema cannot say "string or typed value".
import { defineManifest, read, step, t } from '../packages/contracts/src/index.ts';
import { id, expr } from './_common.ts';

const tpl = (d: string) => t.str({ description: `${d}. Templating allowed: {{ trigger.x }}, {{ steps.name.out.y }}` });
const duration = t.str({ description: 'Duration such as 90m, 6h or 30d', examples: ['30d'] });
const assignee = t.obj({ kind: t.enm('person', 'agent', 'group', 'role', 'automation'), id: t.str({ examples: ['usr_a1b2c3'] }) });
const sheetName = t.opt(t.str({ description: 'Sheet (tab) name; the first when absent' }));
const rowValues = t.rec();
const rowId = t.str({ description: 'Stable row id inside a sheet', examples: ['r_12'] });
const sheetRow = t.obj({ rowId, values: t.rec() });
const aiKeys = {
  agentId: t.opt(id.agent), keyId: t.opt(t.str({ description: 'Inference key: a subscription sign-in or a shared API key' })), backupKeyId: t.opt(t.str()),
  assigned: t.opt(assignee), reviewer: t.opt(assignee), approver: t.opt(assignee),
  timeoutMinutes: t.opt(t.int({ minimum: 1 })), nudgeMinutes: t.opt(t.int({ minimum: 1 })), escalateTo: t.opt(assignee),
};

export default defineManifest({
  id: 'steps-core',
  title: 'Core steps and spreadsheets',
  owner: 'L6',
  capabilities: [
    read('steps.test', 'Run one step in test mode with sample data: reads run for real, writes and sends are stubbed', {
      in: { key: t.str({ examples: ['records.update'] }), input: t.rec(), sample: t.opt(t.rec()) },
      out: { output: t.json(), stubbed: t.bool(), error: t.opt(t.obj({ code: t.str(), message: t.str() })) }, tool: 'automations',
    }),
  ],
  steps: [
    // data
    step('records.create', 'Create a record', 'data', 'capability', {
      cap: 'records.create', effects: 'write', idempotency: 'key', compensate: 'records.delete',
      in: { type: id.recordType, fields: t.rec() }, out: { recordId: id.record },
    }),
    step('records.find', 'Find records', 'data', 'capability', {
      cap: 'records.query', effects: 'read',
      in: { type: id.recordType, filter: t.opt(t.json()), sort: t.opt(t.json()), limit: t.opt(t.int({ minimum: 1, maximum: 1000 })) }, out: { rows: t.arr(t.rec()), count: t.int() },
    }),
    step('records.update', 'Update a record', 'data', 'capability', {
      cap: 'records.update', effects: 'write', idempotency: 'key', compensate: 'records.restore_version', errors: ['validation.bad_input', 'internal.unexpected', 'validation.field_locked', 'validation.version_conflict', 'permission.on_hold'],
      in: { type: id.recordType, recordId: id.record, patch: t.rec() }, out: { recordId: id.record, version: t.int() },
    }),
    step('create_task', 'Create a task', 'data', 'capability', {
      cap: 'tasks.create', effects: 'write', idempotency: 'key', compensate: 'tasks.transition',
      in: {
        kind: t.opt(t.enm('work', 'approve', 'review', 'answer', 'unblock', 'signature')), title: tpl('Task title'), summary: t.opt(tpl('One line')),
        assigned: assignee, reviewer: t.opt(assignee), approver: t.opt(assignee), due: t.opt(t.str({ description: 'Time or duration from now', examples: ['2d'] })), recordId: t.opt(id.record),
      },
      out: { taskId: id.task },
    }),
    // send
    step('send_email', 'Send an email', 'send', 'capability', {
      cap: 'mail.send', effects: 'outward', gateAct: 'send', idempotency: 'key', retry: { max: 3, backoff: 'exp', baseMs: 1000 },
      errors: ['validation.bad_input', 'internal.unexpected', 'provider.unavailable', 'provider.network', 'permission.needs_approval'],
      in: {
        mailboxId: t.opt(id.mailbox), to: t.arr(tpl('Recipient email'), { minItems: 1 }), cc: t.opt(t.arr(tpl('Cc'))), subject: tpl('Subject'), body: tpl('Body'),
        fileIds: t.opt(t.arr(id.file)), recordId: t.opt(id.record), draftOnly: t.opt(t.bool()),
      },
      out: { messageId: t.str(), threadId: t.opt(t.str()) },
    }),
    step('send_sms', 'Send a text message', 'send', 'capability', {
      cap: 'telephony.send_sms', effects: 'outward', gateAct: 'send', idempotency: 'key', retry: { max: 3, backoff: 'exp', baseMs: 1000 },
      errors: ['validation.bad_input', 'internal.unexpected', 'provider.unavailable', 'provider.network', 'permission.needs_approval'],
      in: { numberId: t.opt(id.number), to: tpl('Phone number'), body: tpl('Message'), recordId: t.opt(id.record) }, out: { messageId: t.str() },
    }),
    step('post_message', 'Post a chat message', 'send', 'capability', {
      cap: 'chat.post', effects: 'outward', gateAct: 'post', idempotency: 'key',
      in: { channelId: t.opt(id.channel), threadId: t.opt(id.thread), text: tpl('Message') }, out: { messageId: id.message },
    }),
    // ai
    step('ai', 'AI step', 'ai', 'ai', {
      effects: 'write', idempotency: 'key', retry: { max: 2, backoff: 'exp', baseMs: 2000 },
      errors: ['validation.bad_input', 'internal.unexpected', 'provider.rate_limited', 'provider.auth_failed', 'provider.overloaded', 'provider.context_too_long', 'provider.content_filtered', 'permission.limit', 'timeout.deadline'],
      in: { prompt: tpl('What the agent should do'), ...aiKeys, outputSchema: t.opt(t.json()), inputs: t.opt(t.rec()) },
      out: { text: t.str(), data: t.opt(t.json()), runThreadId: id.thread, keyUsed: t.str(), modelUsed: t.str() },
    }),
    // journey
    step('start_journey', 'Start a Journey', 'journey', 'capability', {
      cap: 'journeys.start', effects: 'write', idempotency: 'key',
      in: { journeyId: id.journey, subjectRecordId: id.record, startStage: t.opt(t.str()) }, out: { recordId: id.record },
    }),
    step('wait_stage', 'Wait for a Journey stage', 'wait', 'wait', {
      effects: 'read', in: { recordId: id.record, stage: t.str(), timeout: t.opt(duration) }, out: { enteredAt: t.ts(), timedOut: t.bool() },
      waits: { timeoutDefault: '30d', cancelsOn: ['record.deleted', 'journey.stage_exited'] },
    }),
    // wait
    step('wait', 'Wait', 'wait', 'wait', {
      effects: 'read',
      in: { forDuration: t.opt(duration), until: t.opt(t.str({ description: 'A time or an expression that yields one' })), event: t.opt(t.obj({ event: t.str(), filter: t.opt(t.json()) })), timeout: t.opt(duration) },
      out: { resumedBy: t.enm('duration', 'time', 'event', 'timeout'), at: t.ts() },
      waits: { timeoutDefault: '30d', cancelsOn: ['record.deleted'] },
    }),
    // control
    step('if', 'If', 'control', 'control', { effects: 'read', in: { condition: expr }, out: { result: t.bool() } }),
    step('paths', 'Paths', 'control', 'control', {
      effects: 'read', in: { paths: t.arr(t.obj({ name: t.str(), when: expr }), { minItems: 1 }), otherwise: t.opt(t.bool()) }, out: { taken: t.str() },
    }),
    step('parallel', 'Parallel', 'control', 'control', {
      effects: 'read', in: { branches: t.arr(t.str(), { minItems: 2 }), waitFor: t.opt(t.enm('all', 'any')) }, out: { finished: t.arr(t.str()) },
    }),
    step('loop', 'Loop', 'control', 'control', {
      effects: 'read', in: { items: expr, maxIterations: t.opt(t.int({ minimum: 1, maximum: 10000 })), concurrency: t.opt(t.int({ minimum: 1, maximum: 20 })) },
      out: { iterations: t.int(), results: t.arr(t.json()) },
    }),
    step('stop', 'Stop', 'control', 'control', {
      effects: 'read', in: { outcome: t.opt(t.enm('succeeded', 'failed')), message: t.opt(tpl('Why the run stops')) }, out: { stopped: t.bool() },
    }),
    step('approval', 'Approval', 'control', 'control', {
      effects: 'write', idempotency: 'key', compensate: 'tasks.transition',
      in: { title: tpl('What needs approval'), summary: t.opt(tpl('One line')), approver: assignee, reviewer: t.opt(assignee), blocks: t.opt(t.arr(t.json())), timeout: t.opt(duration) },
      out: { decision: t.enm('approved', 'rejected', 'timed_out'), note: t.opt(t.str()), by: t.opt(t.str()), taskId: id.task },
      waits: { timeoutDefault: '30d', cancelsOn: ['task.withdrawn'] },
    }),
    // sheet (wrap the files module sheets.* capabilities)
    step('sheet.create', 'Create a spreadsheet', 'sheet', 'capability', {
      cap: 'sheets.create', effects: 'write', idempotency: 'key',
      in: { folderId: id.folder, name: tpl('File name'), format: t.enm('csv', 'xlsx'), columns: t.arr(t.str(), { minItems: 1 }), sheet: sheetName }, out: { fileId: id.file },
    }),
    step('sheet.add_rows', 'Add rows', 'sheet', 'capability', {
      cap: 'sheets.append_rows', effects: 'write', idempotency: 'key', compensate: 'sheets.delete_row',
      in: { fileId: id.file, sheet: sheetName, rows: t.arr(rowValues, { minItems: 1 }) }, out: { appended: t.int(), rowIds: t.arr(rowId) },
    }),
    step('sheet.find_rows', 'Find rows', 'sheet', 'capability', {
      cap: 'sheets.read_rows', effects: 'read',
      in: { fileId: id.file, sheet: sheetName, where: t.opt(t.json()), columns: t.opt(t.arr(t.str())) }, out: { rows: t.arr(sheetRow) },
    }),
    step('sheet.update_rows', 'Update rows', 'sheet', 'capability', {
      cap: 'sheets.update_row', effects: 'write',
      in: { fileId: id.file, sheet: sheetName, rowId: t.opt(rowId), key: t.opt(t.obj({ column: t.str(), value: t.json() })), values: rowValues }, out: { rowId, versionId: t.opt(id.version) },
    }),
    step('sheet.delete_rows', 'Delete rows', 'sheet', 'capability', {
      cap: 'sheets.delete_row', effects: 'write', gateAct: 'delete',
      in: { fileId: id.file, sheet: sheetName, rowId }, out: { deleted: t.bool() },
    }),
    step('sheet.read_all', 'Read all rows', 'sheet', 'capability', {
      cap: 'sheets.read_rows', effects: 'read',
      in: { fileId: id.file, sheet: sheetName }, out: { rows: t.arr(sheetRow) },
    }),
    // sign
    step('sign', 'Send for signature', 'sign', 'capability', {
      cap: 'esign.send', effects: 'outward', gateAct: 'signature_send', idempotency: 'key', retry: { max: 2, backoff: 'exp', baseMs: 2000 },
      errors: ['validation.bad_input', 'internal.unexpected', 'provider.unavailable', 'provider.network', 'permission.needs_approval'],
      in: { fileId: id.file, signers: t.arr(t.obj({ name: t.str(), email: tpl('Signer email'), order: t.opt(t.int({ minimum: 1 })) }), { minItems: 1 }), recordId: t.opt(id.record), message: t.opt(tpl('Note to signers')) },
      out: { envelopeId: t.str(), taskId: t.opt(id.task) },
    }),
    // code
    step('code', 'Run code', 'code', 'code', {
      effects: 'read', retry: { max: 1, backoff: 'none', baseMs: 0 }, errors: ['validation.bad_input', 'internal.unexpected', 'timeout.deadline'],
      in: { language: t.enm('javascript'), source: t.str({ description: 'Function body; receives input and returns a JSON value. No network, no files; 10 second limit' }), input: t.opt(t.rec()) },
      out: { result: t.json(), logs: t.arr(t.str()) },
    }),
  ],
});
