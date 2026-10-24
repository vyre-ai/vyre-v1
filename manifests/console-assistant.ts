// console-assistant (lane L7b): the Console assistant, Cmd-J (spec 3.10, ARCH 7.10).
import { defineManifest, ev, block, read, t, write, create } from '../packages/contracts/src/index.ts';
import { id } from './_common.ts';

const diffId = t.id('dif');
const diffCard = t.obj({
  diffId, kind: t.enm('role', 'grant', 'schema', 'policy', 'setting', 'connector', 'config'),
  title: t.str(), changes: t.arr(t.obj({ path: t.str(), before: t.json(), after: t.json() })), affects: t.opt(t.str()),
});

export default defineManifest({
  id: 'console-assistant',
  title: 'Console assistant',
  owner: 'L7b',
  events: [
    ev('console.change_proposed', 'The Console assistant proposed a change as a diff card', { p: { diffId, kind: t.str(), threadId: id.thread }, subject: ['entity', '/diffId'], vis: 'participants' }),
    ev('console.change_applied', 'A person applied a proposed change; the audit row reads on behalf of', { p: { diffId, kind: t.str(), by: id.user, onBehalfOf: t.opt(id.agent) }, subject: ['entity', '/diffId'], vis: 'space', label: 'internal' }),
    ev('console.change_rejected', 'A person rejected a proposed change', { p: { diffId, by: id.user }, subject: ['entity', '/diffId'], vis: 'participants' }),
  ],
  blocks: [
    block('diff_card', diffCard, 'Proposed change: {{title}}', { actions: [{ key: 'apply', label: 'Apply', cap: 'console.diff_apply', input: { diffId: '/diffId' } }, { key: 'reject', label: 'Reject', cap: 'console.diff_reject', input: { diffId: '/diffId' } }] }),
  ],
  capabilities: [
    create('console.assistant_open', 'Open the Console assistant thread (kind console) with the current page as a context block', { in: { page: t.str({ examples: ['access.roles'] }), objectRef: t.opt(t.str()) }, out: { threadId: id.thread }, perm: 'console.access', tool: 'engineer' }),
    write('console.assistant_context_set', 'Update the page context block as the person navigates', { in: { threadId: id.thread, page: t.str(), objectRef: t.opt(t.str()) }, out: { ok: t.bool() }, on: ['thread', '/threadId'], perm: 'console.access' }),
    read('console.assistant_tools', 'Engineer toolset available to this person: schema, connectors, settings, logs, traces, diagnostics, server config, filtered by role', { out: { tools: t.arr(t.obj({ name: t.str(), summary: t.str() })) }, perm: 'engineer.mcp', tool: 'engineer' }),
    create('console.diff_propose', 'Record a proposed change as a diff card (nothing is applied)', { in: { threadId: id.thread, diff: diffCard }, out: { diffId }, on: ['thread', '/threadId'], perm: 'console.access', emits: ['console.change_proposed'], tool: 'engineer' }),
    write('console.diff_apply', 'Apply a proposed change as the person, with on-behalf-of audit; fixes target Space-owned objects as changesets approved by their Manage holders', { in: { diffId }, out: { applied: t.bool(), changesetId: t.opt(id.changeset), auditId: t.opt(t.str()) }, perm: 'console.access', level: 'manage', risk: 'high', audit: 'always', emits: ['console.change_applied'], tool: 'engineer', errors: ['permission.role_lacks_permission', 'validation.precondition_failed'] }),
    write('console.diff_reject', 'Reject a proposed change', { in: { diffId, note: t.opt(t.str()) }, out: { rejected: t.bool() }, perm: 'console.access', emits: ['console.change_rejected'], tool: 'engineer' }),
    read('console.explain_access', 'Explain why a person can or cannot see a thing, in the words of the Access checker steps', { in: { person: id.user, action: t.str(), resourceType: t.str(), resourceId: t.str() }, out: { effect: t.enm('allow', 'deny', 'hold'), steps: t.arr(t.str()) }, perm: 'access.manage', tool: 'engineer' }),
  ],
});
