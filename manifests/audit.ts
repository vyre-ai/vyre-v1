// audit (lane L7a): the append-only record of every access change and sensitive act, with signed checkpoints and the 2-year archive.
// Rows carry at, actor, on-behalf-of, action, resource, before and after; never secret values. An erase entry records who and when, never what.
// Viewing the audit log is itself an audit row. Retention of audit rows is governed in module governance; this module does the archiving move.
// DECISION: audit.verify checks a bounded range (at most 100000 events per call) so it stays inside the deadline; a longer range is run in slices by the caller.
// DECISION: audit.append is the system door for modules whose acts are audited by hand (log viewing, the everything memory view, delegate actions); capabilities with audit set are written by the kernel.
import { defineManifest, ev, health, read, screen, t, write } from '../packages/contracts/src/index.ts';
import { id, pageIn, pageOut, principalRef, resourceRef } from './_common.ts';

const V = { level: 'view' } as const;
const auditId = t.id('aud');
const klass = t.enm('change', 'sensitive', 'deny', 'admin', 'erase', 'sign_in');
const auditRow = t.obj({
  id: auditId, at: t.ts(), actor: principalRef, onBehalfOf: t.opt(principalRef), action: t.str({ examples: ['grant.created'] }), resource: t.opt(resourceRef), class: klass,
  before: t.opt(t.json()), after: t.opt(t.json()), traceId: id.trace, requestId: t.opt(t.id('arq')), seq: t.int({ minimum: 0 }),
});
const checkpointRow = t.obj({ seq: t.int({ minimum: 0 }), at: t.ts(), hash: t.str(), signatureOk: t.bool() });

export default defineManifest({
  id: 'audit',
  title: 'Audit',
  owner: 'L7a',

  events: [
    ev('audit.exported', 'The audit log was exported (the export is itself audited)', { p: { by: t.str(), rows: t.int({ minimum: 0 }), fileId: id.file }, subject: ['file', '/fileId'], retention: 'audit' }),
    ev('audit.checkpointed', 'A signed checkpoint of the event hash chain was written', { p: { seq: t.int({ minimum: 0 }), hash: t.str() }, subject: ['entity', '/seq'], retention: 'audit' }),
    ev('audit.verified', 'The chain and checkpoints were verified', { p: { ok: t.bool(), checked: t.int({ minimum: 0 }), firstBadSeq: t.opt(t.int({ minimum: 0 })), by: t.str() }, subject: ['entity', '/by'], retention: 'audit' }),
    ev('audit.archived', 'Audit rows older than the retention window moved to an encrypted archive file (never edited)', { p: { year: t.int(), rows: t.int({ minimum: 0 }), file: t.str({ examples: ['audit-archive/2024.jsonl.zst'] }) }, subject: ['entity', '/file'], retention: 'audit' }),
  ],

  capabilities: [
    read('audit.list', 'List audit rows with filters (Console Audit log)', {
      ...V, in: { actor: t.opt(principalRef), action: t.opt(t.str()), resource: t.opt(resourceRef), class: t.opt(klass), from: t.opt(t.ts()), to: t.opt(t.ts()), q: t.opt(t.str()), traceId: t.opt(id.trace), ...pageIn },
      out: { rows: t.arr(auditRow), ...pageOut }, perm: 'audit.read', audit: 'sensitive', tool: 'engineer', team: true, cli: 'vyre audit list',
    }),
    read('audit.get', 'One audit row with its before and after', { ...V, in: { auditId }, out: { row: auditRow }, perm: 'audit.read', tool: 'engineer', team: true }),
    read('audit.export', 'Export audit rows as CSV into a file', {
      ...V, in: { actor: t.opt(principalRef), action: t.opt(t.str()), resource: t.opt(resourceRef), class: t.opt(klass), from: t.opt(t.ts()), to: t.opt(t.ts()) }, out: { fileId: id.file, rows: t.int({ minimum: 0 }) },
      perm: 'audit.read', risk: 'medium', emits: ['audit.exported'], audit: 'always', tool: 'engineer', team: true,
    }),
    read('audit.verify', 'Verify the hash chain and signed checkpoints over a range of events', {
      ...V, in: { fromSeq: t.opt(t.int({ minimum: 0 })), toSeq: t.opt(t.int({ minimum: 0 })) }, out: { ok: t.bool(), checked: t.int({ minimum: 0 }), firstBadSeq: t.opt(t.int({ minimum: 0 })) },
      perm: 'audit.read', emits: ['audit.verified'], audit: 'always', tool: 'engineer', team: true, cli: 'vyre audit verify',
    }),
    read('audit.checkpoints.list', 'Signed checkpoints (every 1000 events or 10 minutes)', { ...V, in: { ...pageIn }, out: { checkpoints: t.arr(checkpointRow), ...pageOut }, perm: 'audit.read', tool: 'engineer', team: true }),
    read('audit.archives.list', 'Archived years of audit rows', { ...V, in: {}, out: { archives: t.arr(t.obj({ year: t.int(), file: t.str(), rows: t.int({ minimum: 0 }), sizeBytes: t.int({ minimum: 0 }) })) }, perm: 'audit.read', tool: 'engineer', team: true }),

    // system halves
    write('audit.checkpoint', 'System: write a signed checkpoint of the hash chain', { ...V, in: {}, out: { checkpoint: checkpointRow }, emits: ['audit.checkpointed'] }),
    write('audit.archive', 'System: move audit rows older than the retention window into the encrypted archive file (called by the governance job)', { ...V, in: { before: t.ts() }, out: { archived: t.int({ minimum: 0 }) }, emits: ['audit.archived'], audit: 'always' }),
    write('audit.append', 'System: add an audit row for an act a module audits by hand', {
      ...V, in: { action: t.str(), class: klass, resource: t.opt(resourceRef), onBehalfOf: t.opt(principalRef), detail: t.opt(t.json()) }, out: { auditId },
    }),
    read('audit.chain_health', 'Health probe: the newest checkpoint verifies and is recent', { ...V, in: {}, out: { state: t.enm('healthy', 'degraded', 'down'), detail: t.opt(t.str()), latencyMs: t.opt(t.int({ minimum: 0 })) } }),
  ],

  screens: [
    screen('audit.log', 'console', 'ui:ConsoleAudit', {
      needs: ['audit.read'], q: { rows: ['audit.list', { actor: '/state/actor', action: '/state/action', resource: '/state/resource', class: '/state/class', from: '/state/from', to: '/state/to', q: '/state/query', traceId: '/state/traceId' }] },
      a: { export: ['audit.export', { actor: '/state/actor', action: '/state/action', class: '/state/class', from: '/state/from', to: '/state/to' }], verify: ['audit.verify'] }, empty: 'No audit rows match',
    }),
    screen('audit.entry', 'console', 'ui:ConsoleAuditEntry', { slot: 'side', needs: ['audit.read'], q: { row: ['audit.get', { auditId: '/state/auditId' }] } }),
    screen('audit.integrity', 'console', 'ui:ConsoleAuditIntegrity', { needs: ['audit.read'], q: { checkpoints: ['audit.checkpoints.list'], archives: ['audit.archives.list'] }, a: { verify: ['audit.verify', { fromSeq: '/state/fromSeq', toSeq: '/state/toSeq' }] } }),
  ],

  health: [
    health('audit.chain', 'Audit chain', 'audit.chain_health', 'Run Verify in Console > Audit log; if it fails, restore from the last good backup and keep the support bundle'),
  ],
});
