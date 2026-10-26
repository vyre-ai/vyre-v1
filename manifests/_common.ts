// Shared schema fragments for manifests. Pure data, imported by module manifests.
import { t } from '../packages/contracts/src/index.ts';
import type { JsonSchema, ResourceType } from '../packages/contracts/src/index.ts';

export const RESOURCE_TYPES: ResourceType[] = [
  'space', 'record_type', 'record', 'project', 'folder', 'file', 'channel', 'thread', 'inbox', 'mailbox',
  'vault_folder', 'vault_item', 'automation_group', 'automation', 'agent', 'connector', 'connection',
  'site', 'form', 'campaign', 'kit', 'terminal', 'computer', 'task', 'run', 'number', 'domain', 'calendar',
];

/** Id schemas by prefix (ids are `<prefix>_<lowercase alphanumerics>`). */
export const id = {
  user: t.id('usr'), agent: t.id('agt'), actor: t.id('act'), service: t.id('svc'), group: t.id('grp'), role: t.id('rol'),
  grant: t.id('gnt'), policy: t.id('pol'), device: t.id('dev'), session: t.id('ses'), invite: t.id('inv'),
  record: t.id('rec'), recordType: t.str({ pattern: '^[a-z][a-z0-9_]*$', examples: ['contact'] }),
  project: t.id('prj'), task: t.id('tsk'), run: t.id('run'), thread: t.id('thr'), message: t.id('msg'), channel: t.id('chn'),
  turn: t.id('trn'), block: t.id('blk'), plan: t.id('pln'),
  file: t.id('fil'), folder: t.id('fld'), blob: t.id('blb'), version: t.id('ver'), changeset: t.id('chg'), mount: t.id('mnt'),
  vaultItem: t.id('vit'), vaultFolder: t.id('vfd'), handle: t.str({ pattern: '^#[A-Za-z0-9_]+(\\.[A-Za-z0-9_]+)?$', examples: ['#Dana_Lawmatics'] }),
  automation: t.id('aut'), journey: t.id('jrn'), campaign: t.id('cmp'), form: t.id('frm'), site: t.id('sit'), kit: t.id('kit'),
  connector: t.str({ examples: ['hubspot'] }), connection: t.id('con'), mailbox: t.id('mbx'), number: t.id('num'), domain: t.id('dom'),
  contact: t.id('rec'), event: t.id('evt'), meeting: t.id('mtg'), call: t.id('cal'), computer: t.id('cmt'), terminal: t.id('trm'),
  notification: t.id('ntf'), conflict: t.id('cfl'), fact: t.id('fct'), note: t.id('not'), report: t.id('rpt'), decision: t.id('dec'),
  space: t.id('spc'), trace: t.str({ pattern: '^[0-9a-f]{32}$', examples: ['0123456789abcdef0123456789abcdef'] }),
};

export const label = t.enm('public', 'internal', 'confidential', 'restricted');
export const level = t.enm('view', 'use', 'edit', 'manage');
export const risk = t.enm('low', 'medium', 'high');
export const ok = { ok: t.bool() };
export const resourceType = t.enm(...RESOURCE_TYPES);
export const resourceRef = t.obj({ type: resourceType, id: t.str({ examples: ['rec_a1b2c3'] }) });
export const principalRef = t.obj({ kind: t.enm('person', 'agent', 'actor', 'service'), id: t.str({ examples: ['usr_a1b2c3'] }) });
export const subjectRef = t.obj({ kind: t.enm('person', 'agent', 'actor', 'service', 'group', 'role', 'link'), id: t.str({ examples: ['usr_a1b2c3'] }) });

/** Cursor paging for lists. */
export const pageIn = { cursor: t.opt(t.str()), limit: t.opt(t.int({ minimum: 1, maximum: 500 })) };
export const pageOut = { next: t.opt(t.str({ description: 'Cursor for the next page; absent on the last page' })), total: t.opt(t.int()) };

/** Persisted native block (6.8). */
export const blockSchema: JsonSchema = t.obj({
  type: t.str({ examples: ['record_card'] }), v: t.int({ minimum: 1 }), id: id.block, data: t.json(),
  state: t.opt(t.enm('live', 'done', 'waiting', 'error')), traceId: id.trace,
});

/** Filter and sort for lists and views (compiles to SQL, 4.5). */
export const filterExpr: JsonSchema = t.json();
export const sortSpec: JsonSchema = t.arr(t.obj({ field: t.str(), dir: t.enm('asc', 'desc') }));
export const viewSpec = {
  filter: t.opt(filterExpr), sort: t.opt(sortSpec), group: t.opt(t.str()),
  fields: t.opt(t.arr(t.str())), offset: t.opt(t.int({ minimum: 0 })), limit: t.opt(t.int({ minimum: 1, maximum: 5000 })),
};

/** Held result of a gated call (4.6). */
export const heldResult: JsonSchema = t.obj({ status: t.lit('held'), taskId: id.task, runId: t.opt(id.run) });

/** Result of starting a Run. */
export const runStarted = { runId: id.run };

/** Version list row (One History, 4.5). */
export const versionRow: JsonSchema = t.obj({ versionId: id.version, n: t.int(), by: t.str(), at: t.ts(), reason: t.opt(t.str()), name: t.opt(t.str()) });

export const expr = t.str({ description: 'Expression over the call input or payload', examples: ["input.amount > 1000"] });
export const cron = t.str({ description: 'Cron expression', examples: ['0 9 * * 1-5'] });
export const email = t.str({ pattern: '^[^@\\s]+@[^@\\s]+$', examples: ['maya@example.com'] });
export const url = t.str({ pattern: '^https?://', examples: ['https://example.com'] });

/** What an age purge answers (P-CC_39): how many it removed in this batch, whether more are left, and how many a hold kept. */
export const purgeOut = { removed: t.int({ minimum: 0 }), more: t.bool(), skippedOnHold: t.opt(t.int({ minimum: 0 })) };
