// reports-client (lane L7b): Report a problem, client half (spec 5 Report a problem, ARCH 7.14).
import { create, defineManifest, ev, field, health, outward, read, rtype, screen, setting, t, write } from '../packages/contracts/src/index.ts';
import { id, pageIn, pageOut } from './_common.ts';

const reportRef = t.id('rpt');
const bundle = t.obj({
  context: t.obj({ place: t.str(), itemId: t.opt(t.str()), hash: t.opt(t.str()) }),
  traceIds: t.arr(id.trace, { maxItems: 20 }),
  events: t.arr(t.obj({ type: t.str(), at: t.ts(), traceId: t.opt(id.trace) })),
  versions: t.obj({ app: t.str(), server: t.str(), device: t.str() }),
  screenshotFileId: t.opt(id.file),
  errors: t.opt(t.arr(t.obj({ code: t.str(), message: t.str(), at: t.ts(), traceId: t.opt(id.trace) }), { maxItems: 50 })),
  clientLogFileId: t.opt(id.file),
  note: t.opt(t.str({ maxLength: 500 })),
});
const policy = t.enm('on', 'ask', 'off');

export default defineManifest({
  id: 'reports-client',
  title: 'Report a problem',
  owner: 'L7b',
  events: [
    ev('report.submitted', 'A person reported a problem; admins get a Review task', { p: { reportId: reportRef, by: id.user, traceIds: t.arr(id.trace) }, subject: ['entity', '/reportId'], notify: 'problem.report', trigger: { title: 'A problem is reported' } }),
    ev('report.sent_to_vyre', 'The redacted bundle was posted to reports.vyre.run', { p: { reportId: reportRef, issueNumber: t.opt(t.int()) }, subject: ['entity', '/reportId'], replay: 'stub' }),
    ev('report.resolved', 'The Vyre team closed the issue; the reporter hears back in the Inbox', { p: { reportId: reportRef, issueNumber: t.int(), fixedIn: t.opt(t.str()) }, subject: ['entity', '/reportId'], notify: 'problem.report' }),
  ],
  recordTypes: [
    rtype('report', 'Problem report', 'Problem reports', 'flag', [
      field('title', 'text', 'Title', { required: true }),
      field('status', 'status', 'Status', { options: { stages: [{ key: 'new', title: 'New' }, { key: 'sent', title: 'Sent to Vyre' }, { key: 'resolved', title: 'Resolved' }] } }),
      field('reporter', 'person', 'Reporter'),
      field('traceIds', 'text', 'Trace ids'),
      field('issueNumber', 'number', 'Issue number'),
      field('bundleFile', 'files', 'Bundle'),
    ], { system: true, statusField: 'status', ownerField: 'reporter', group: 'Support', label: 'confidential' }),
  ],
  capabilities: [
    read('reports.preview', 'Build and preview exactly what would be sent: redacted by label, sealed and Restricted values removed', { in: { context: t.obj({ place: t.str(), itemId: t.opt(t.str()), hash: t.opt(t.str()) }), note: t.opt(t.str({ maxLength: 500 })) }, out: { bundle, redactions: t.int() }, tool: 'meta' }),
    create('reports.submit', 'Submit a problem report (queued offline, sent on reconnect with the original trace ids)', { in: { bundle }, out: { reportId: reportRef, taskId: id.task, sentToVyre: t.bool() }, emits: ['report.submitted'], offline: 'queue', tool: 'meta' }),
    outward('reports.send_to_vyre', 'POST the redacted bundle to reports.vyre.run when policy reports.vyre is On', { in: { reportId: reportRef }, out: { issueNumber: t.opt(t.int()), stored: t.bool() }, gate: { act: 'none', reason: 'governed by the Space policy reports.vyre; the user previewed the exact bundle before sending' }, emits: ['report.sent_to_vyre'], errors: ['rate_limit.exceeded'] }),
    read('reports.list', 'List problem reports and their state', { in: pageIn, out: { reports: t.arr(t.obj({ reportId: reportRef, title: t.str(), status: t.str(), at: t.ts(), issueNumber: t.opt(t.int()) })), ...pageOut }, tool: 'meta' }),
    read('reports.get', 'Read one report', { in: { reportId: reportRef }, out: { reportId: reportRef, bundle, status: t.str(), issueNumber: t.opt(t.int()) }, tool: 'meta' }),
    write('reports.resolved', 'Inbound: the reporter Space is told the issue closed (webhook from reports.vyre.run)', { in: { reportId: reportRef, issueNumber: t.int(), fixedIn: t.opt(t.str()) }, out: { ok: t.bool() }, emits: ['report.resolved'], http: { method: 'POST', path: '/hooks/reports' } }),
    read('reports.policy_get', 'Read the policy Send problem reports to the Vyre team', { out: { policy }, perm: 'policy.manage', tool: 'engineer' }),
    write('reports.policy_set', 'Set the policy to On, Ask or Off; what is captured never changes, only the destination', { in: { policy }, out: { ok: t.bool() }, perm: 'policy.manage', level: 'manage', audit: 'always', tool: 'engineer' }),
    read('reports.health', 'Probe: reports.vyre.run reachable and the host key registered', { out: { state: t.enm('healthy', 'degraded', 'down'), detail: t.opt(t.str()), latencyMs: t.opt(t.int()) } }),
  ],
  health: [health('reports.service', 'Problem report service reachable', 'reports.health', 'Check the network; reports queue locally until it returns.')],
  screens: [
    screen('shell.report-problem', 'shell', 'ui:ReportProblemSheet', {
      slot: 'sheet', q: { preview: ['reports.preview', { context: '/state/context', note: '/draft/note' }, false] }, a: { send: ['reports.submit', { bundle: '/state/bundle' }] },
      empty: 'Nothing was captured', primary: 'Send', keys: [{ combo: 'Cmd-Shift-/', action: 'open' }],
    }),
  ],
  settings: [setting('reports.vyre', 'space', 'ai', 'Send problem reports to the Vyre team', policy, 'on', { floorable: true })],
});
