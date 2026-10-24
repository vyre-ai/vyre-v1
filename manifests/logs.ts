// logs (lane L7b): structured logs and traces, the trace view, client log upload, replay sandbox (spec 4.18, ARCH 4.9, 4.10, 7.14).
import { defineManifest, ev, read, t, write } from '../packages/contracts/src/index.ts';
import { id, pageIn, pageOut } from './_common.ts';

const level = t.enm('debug', 'info', 'warn', 'error');
const logRow = t.obj({
  id: t.int(), at: t.ts(), level, traceId: t.opt(id.trace), spanId: t.opt(t.str()), actor: t.opt(t.str()), onBehalf: t.opt(t.str()), runId: t.opt(id.run),
  place: t.opt(t.str()), cap: t.opt(t.str()), entity: t.opt(t.str()), entityId: t.opt(t.str()), result: t.opt(t.str()), durMs: t.opt(t.num()),
  costMicros: t.opt(t.int()), label: t.opt(t.int()), msg: t.str(), attrs: t.opt(t.rec()),
});
const span = t.obj({ traceId: id.trace, spanId: t.str(), parent: t.opt(t.str()), name: t.str(), at: t.int(), durUs: t.int(), attrs: t.opt(t.rec()) });
const filter = {
  person: t.opt(t.str()), agent: t.opt(t.str()), place: t.opt(t.str()), recordId: t.opt(id.record), runId: t.opt(id.run), traceId: t.opt(id.trace),
  cap: t.opt(t.str()), level: t.opt(level), result: t.opt(t.str()), sinceMs: t.opt(t.ts()), untilMs: t.opt(t.ts()),
};

export default defineManifest({
  id: 'logs',
  title: 'Logs and traces',
  owner: 'L7b',
  events: [
    ev('log.accessed', 'Someone read logs (reading logs is itself audited)', { p: { by: t.str(), filter: t.rec() }, subject: ['entity', '/by'], vis: 'owner' }),
    ev('client_log.uploaded', 'A device uploaded its ring-buffer log on reconnect', { p: { device: id.device, sizeBytes: t.int() }, subject: ['entity', '/device'], vis: 'owner' }),
    ev('replay.started', 'A replay sandbox started on a copy of the Space', { p: { replayId: t.id('rpl'), atSeq: t.int(), runId: t.opt(id.run) }, subject: ['entity', '/replayId'], vis: 'owner' }),
    ev('replay.finished', 'A replay sandbox finished; outward calls were recorded, never executed', { p: { replayId: t.id('rpl'), recordedOutward: t.int() }, subject: ['entity', '/replayId'], vis: 'owner' }),
  ],
  capabilities: [
    read('logs.query', 'Search logs by person, agent, place, record, run or trace (ids and metadata only)', { in: { ...filter, ...pageIn }, out: { rows: t.arr(logRow), ...pageOut }, perm: 'server.logs', audit: 'always', tool: 'engineer', cli: 'vyre logs' }),
    read('logs.tail', 'Live tail of logs (stream opens over the live connection)', { in: filter, out: { streamId: t.str() }, perm: 'server.logs', audit: 'always', tool: 'engineer' }),
    read('logs.trace', 'Trace view: logs, spans and events joined by one trace id', { in: { traceId: id.trace }, out: { logs: t.arr(logRow), spans: t.arr(span), events: t.arr(t.obj({ seq: t.int(), type: t.str(), at: t.ts(), actor: t.str(), entity: t.opt(t.str()) })) }, perm: 'server.logs', audit: 'always', tool: 'engineer' }),
    read('logs.spans', 'Spans of a trace or of a budget id for the speed page', { in: { traceId: t.opt(id.trace), name: t.opt(t.str()), ...pageIn }, out: { spans: t.arr(span), ...pageOut }, perm: 'server.logs', tool: 'engineer' }),
    read('logs.export', 'Export a log search as a file', { in: filter, out: { fileId: id.file }, perm: 'server.logs', audit: 'always', tool: 'engineer' }),
    write('logs.client_upload', 'Upload the device ring-buffer log keyed by trace id (queued while offline, sent on reconnect)', { in: { device: id.device, entries: t.arr(t.obj({ at: t.ts(), traceId: t.opt(id.trace), level, msg: t.str(), attrs: t.opt(t.rec()) })) }, out: { accepted: t.int() }, emits: ['client_log.uploaded'], offline: 'queue' }),
    write('logs.replay_start', 'Replay a failed Run or sync conflict on a copy of the Space with outward capabilities stubbed and sealed values replaced', { in: { atSeq: t.int({ minimum: 0 }), runId: t.opt(id.run), conflictId: t.opt(id.conflict) }, out: { replayId: t.id('rpl') }, perm: 'server.logs', level: 'manage', risk: 'high', audit: 'always', run: { kind: 'replay', stoppable: true }, emits: ['replay.started', 'replay.finished'], tool: 'engineer', errors: ['permission.above_clearance'] }),
    read('logs.replay_get', 'Result of a replay: steps, recorded outward calls, differences from the original', { in: { replayId: t.id('rpl') }, out: { state: t.enm('running', 'done', 'failed'), recordedOutward: t.int(), steps: t.arr(t.obj({ name: t.str(), ok: t.bool(), detail: t.opt(t.str()) })) }, perm: 'server.logs', tool: 'engineer' }),
    read('logs.settings_get', 'Logging settings: levels, retention windows, review sampling', { out: { level, fullDays: t.int(), aggregateDays: t.int() }, perm: 'server.logs', tool: 'engineer' }),
    write('logs.settings_set', 'Change logging settings', { in: { level: t.opt(level), fullDays: t.opt(t.int({ minimum: 1 })), aggregateDays: t.opt(t.int({ minimum: 1 })) }, out: { ok: t.bool() }, perm: 'policy.manage', level: 'manage', audit: 'always', tool: 'engineer' }),
  ],
});
