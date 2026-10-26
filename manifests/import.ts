// import (lane L3): bring tables into record types from CSV, Excel, Airtable, Notion and Google Sheets (spec 2.9 Lifecycle, 2.10 last line).
// Flow: parse a source into a staged import (importId), suggest a mapping, preview, commit as a Run.
// Imports fire no automations unless the importer ticks run automations (default off). Rows are written through records.bulk_upsert.
// DECISION: parse capabilities are declared as reads: they stage a temporary import session that expires after 24 hours and change no durable data.
// DECISION: vault-held keys for Airtable and Notion are passed as Vault handles (id.handle), never as values.
import { defineManifest, ev, importSource, read, screen, t, write } from '../packages/contracts/src/index.ts';
import { id, pageIn, pageOut, runStarted } from './_common.ts';

const importId = t.id('imp');
const fieldKey = t.str({ pattern: '^[a-z][a-z0-9_]*$', examples: ['email'] });
const sourceKind = t.enm('csv', 'excel', 'airtable', 'notion', 'google_sheets');
const sessionProvider = t.enm('codex', 'claude_code');
const importedMessage = t.obj({ sourceMessageId: t.str(), role: t.enm('user', 'assistant'), text: t.str(), at: t.ts() });
const importedSession = t.obj({
  sourceSessionId: t.str(), title: t.opt(t.str()), startedAt: t.ts(),
  repo: t.opt(t.obj({ remote: t.opt(t.str()), root: t.opt(t.str()) })), messages: t.arr(importedMessage),
});
const importedConversation = t.obj({ conversationId: t.id('isc'), provider: sessionProvider, destination: t.obj({ kind: t.enm('project', 'imported_sessions'), projectId: t.opt(id.project) }) });

const column = t.obj({ name: t.str(), inferred: t.str({ description: 'Field type key the column looks like', examples: ['email'] }), sample: t.arr(t.str()), distinct: t.int({ minimum: 0 }), empty: t.int({ minimum: 0 }) });
const table = t.obj({ name: t.str(), rowCount: t.int({ minimum: 0 }), columns: t.arr(column) });
const parseOut = { importId, source: sourceKind, tables: t.arr(table), expiresAt: t.ts() };

const mapping = t.arr(t.obj({ column: t.str(), field: fieldKey, transform: t.opt(t.str({ description: 'Small expression over the cell value' })) }));

const importRow = t.obj({
  importId, source: sourceKind, type: id.recordType, state: t.enm('staged', 'running', 'done', 'failed', 'canceled'),
  runId: t.opt(id.run), by: t.str(), at: t.ts(), created: t.int(), updated: t.int(), skipped: t.int(), failed: t.int(),
  ranAutomations: t.bool(), errorsFileId: t.opt(id.file),
});

export default defineManifest({
  id: 'import',
  title: 'Import',
  owner: 'L3',
  importSources: [
    importSource('csv', 'CSV', ['text/csv', '.csv', '.tsv'], 'import.parse_csv', 'record_type'),
    importSource('excel', 'Excel', ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', '.xlsx', '.xls'], 'import.parse_excel', 'record_type'),
    importSource('airtable', 'Airtable', ['https://airtable.com/*', '.csv'], 'import.parse_airtable', 'record_type'),
    importSource('notion', 'Notion', ['https://www.notion.so/*', '.zip', '.csv'], 'import.parse_notion', 'record_type'),
    importSource('google_sheets', 'Google Sheets', ['https://docs.google.com/spreadsheets/*'], 'import.parse_google_sheets', 'record_type'),
  ],
  events: [
    ev('import.started', 'An import Run began writing rows', { p: { importId, runId: id.run, type: id.recordType, source: sourceKind, rows: t.int() }, subject: ['entity', '/importId'] }),
    ev('import.completed', 'An import finished', {
      p: { importId, runId: id.run, type: id.recordType, source: sourceKind, created: t.int(), updated: t.int(), skipped: t.int(), failed: t.int(), ranAutomations: t.bool() },
      subject: ['entity', '/importId'], trigger: { title: 'An import finishes', fields: ['/type', '/source'] },
    }),
    ev('import.failed', 'An import stopped on an error; rows already written stay and the Run can be undone', { p: { importId, runId: id.run, type: id.recordType, error: t.str() }, subject: ['entity', '/importId'], notify: 'run.failed' }),
    ev('sessions.imported', 'A local Codex or Claude Code session was copied into an immutable owner-private archive', { p: { conversationId: t.id('isc'), provider: sessionProvider, sourceKey: t.str(), projectId: t.opt(id.project), messages: t.int() }, subject: ['entity', '/conversationId'] }),
    ev('sessions.continued', 'An imported archival session was continued in a separate live Vyre chat', { p: { conversationId: t.id('isc'), threadId: id.thread }, subject: ['entity', '/conversationId'] }),
  ],
  capabilities: [
    read('import.parse_csv', 'Stage a CSV or pasted CSV text and report its columns with inferred field types', {
      in: { fileId: t.opt(id.file), text: t.opt(t.str()), delimiter: t.opt(t.str({ maxLength: 1 })), hasHeader: t.opt(t.bool()) }, out: parseOut,
      perm: 'records.create', tool: 'records', cli: 'vyre import csv',
    }),
    read('import.parse_excel', 'Stage the sheets of an Excel file and report their columns', {
      in: { fileId: id.file, sheets: t.opt(t.arr(t.str())) }, out: parseOut, on: ['file', '/fileId'], perm: 'records.create', tool: 'records',
    }),
    read('import.parse_airtable', 'Stage the tables of an Airtable base using a key held in the Vault', {
      in: { baseUrl: t.str({ examples: ['https://airtable.com/appXXXXXXXX'] }), key: id.handle, tables: t.opt(t.arr(t.str())) }, out: parseOut,
      perm: 'records.create', tool: 'records', errors: ['provider.auth_failed', 'provider.unavailable'],
    }),
    read('import.parse_notion', 'Stage a Notion database or an export file using a key held in the Vault', {
      in: { url: t.opt(t.str()), exportFileId: t.opt(id.file), key: t.opt(id.handle) }, out: parseOut,
      perm: 'records.create', tool: 'records', errors: ['provider.auth_failed', 'provider.unavailable'],
    }),
    read('import.parse_google_sheets', 'Stage the tabs of a Google Sheet the connected account can open', {
      in: { url: t.str(), connectionId: t.opt(id.connection), tabs: t.opt(t.arr(t.str())) }, out: parseOut,
      perm: 'records.create', tool: 'records', errors: ['provider.auth_failed', 'provider.unavailable'],
    }),
    read('import.suggest_mapping', 'Suggest which column feeds which field of a record type, with a confidence for each', {
      in: { importId, table: t.opt(t.str()), type: id.recordType },
      out: { mapping: t.arr(t.obj({ column: t.str(), field: t.opt(fieldKey), confidence: t.num({ minimum: 0, maximum: 1 }) })), unmapped: t.arr(t.str()), newFields: t.arr(t.obj({ column: t.str(), key: fieldKey, type: t.str() })) },
      on: ['record_type', '/type'], perm: 'records.create', tool: 'records',
    }),
    read('import.preview', 'Preview an import: rows to create, update or skip, row errors, new fields, and a preview token', {
      in: {
        importId, table: t.opt(t.str()), type: id.recordType, mapping,
        createFields: t.opt(t.bool()),
        match: t.opt(t.arr(fieldKey, { description: 'Fields that identify an existing record' })), onMatch: t.opt(t.enm('update', 'skip', 'create')),
        runAutomations: t.opt(t.bool()),
      },
      out: {
        previewToken: t.str(), creates: t.int(), updates: t.int(), skips: t.int(),
        errors: t.arr(t.obj({ row: t.int(), column: t.opt(t.str()), message: t.str() }), { maxItems: 50 }), errorCount: t.int(),
        newFields: t.arr(t.obj({ key: fieldKey, type: t.str() })), samples: t.arr(t.rec()),
      },
      on: ['record_type', '/type'], perm: 'records.create', tool: 'records', cli: 'vyre import preview',
    }),
    write('import.commit', 'Write the previewed rows as an import Run; no automations fire unless runAutomations is true', {
      in: { importId, previewToken: t.str(), runAutomations: t.opt(t.bool()) }, out: { ...runStarted, importId },
      perm: 'records.create', idem: 'key', run: { kind: 'import', stoppable: true }, audit: 'always', emits: ['import.started', 'import.completed', 'import.failed', 'schema.changed'],
      tool: 'records', offline: 'online', cli: 'vyre import commit', errors: ['validation.precondition_failed', 'validation.too_large'],
    }),
    read('import.get', 'Read one import: state, counts and the file of row errors', { in: { importId }, out: { import: importRow }, tool: 'records' }),
    read('import.list', 'History of imports', { in: { type: t.opt(id.recordType), ...pageIn }, out: { imports: t.arr(importRow), ...pageOut }, perm: 'records.create', tool: 'records' }),
    write('import.discard', 'Drop a staged import before it is committed', { in: { importId }, out: { discarded: t.bool() }, perm: 'records.create', tool: 'records' }),
    read('import.template', 'A CSV template for a record type: header row and one example row', {
      in: { type: id.recordType }, out: { text: t.str(), fileId: t.opt(id.file) }, on: ['record_type', '/type'], tool: 'records',
    }),
    write('sessions.import', 'Copy previewed local Codex or Claude Code sessions into immutable owner-private Vyre conversations; provider adapters supply only visible user and assistant text', {
      in: { provider: sessionProvider, sourceKey: t.str(), consent: t.obj({ previewedAt: t.ts(), confirmedAt: t.ts() }), sessions: t.arr(importedSession, { minItems: 1 }) },
      out: { imported: t.int(), updated: t.int(), sessions: t.arr(importedConversation) }, perm: 'chats.private', idem: 'key', audit: 'always', emits: ['sessions.imported'], tool: 'chats', errors: ['validation.precondition_failed'],
    }),
    write('sessions.continue', 'Start a separate live Vyre chat linked to an immutable imported conversation; it never writes back to the local provider store', {
      in: { conversationId: t.id('isc'), agentId: id.agent, first: t.opt(t.str()) }, out: { threadId: id.thread, linkedFrom: t.id('isc') }, perm: 'chats.private', emits: ['sessions.continued'], tool: 'chats',
    }),
  ],
  screens: [
    screen('records.import', 'records', 'ui:ImportWizard', {
      q: { history: ['import.list', { type: '/state/type' }] },
      a: {
        parseCsv: ['import.parse_csv', { fileId: '/draft/fileId', text: '/draft/text' }],
        parseExcel: ['import.parse_excel', { fileId: '/draft/fileId' }],
        parseAirtable: ['import.parse_airtable', { baseUrl: '/draft/url', key: '/draft/key' }],
        parseNotion: ['import.parse_notion', { url: '/draft/url', key: '/draft/key' }],
        parseSheets: ['import.parse_google_sheets', { url: '/draft/url', connectionId: '/draft/connectionId' }],
        suggest: ['import.suggest_mapping', { importId: '/state/importId', type: '/state/type' }],
        preview: ['import.preview', { importId: '/state/importId', type: '/state/type', mapping: '/draft/mapping', match: '/draft/match', runAutomations: '/draft/runAutomations' }],
        commit: ['import.commit', { importId: '/state/importId', previewToken: '/state/previewToken', runAutomations: '/draft/runAutomations' }, 'Import these rows?'],
        discard: ['import.discard', { importId: '/state/importId' }],
      },
      needs: ['records.create'], empty: 'No imports yet', primary: 'Import data',
    }),
  ],
});
