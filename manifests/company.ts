// company: Connect your company. One flow for Google Workspace or Microsoft 365: Space-wide sign-in, the directory, and each member's Inbox, Calendar and Files with no per-person sign-in.
// DECISION: this module holds where the flow stands and nothing else. The truth stays with the connectors, the sign-in policy and the Vault, read live, so it survives a restart and never asks twice.
// DECISION: the two calls that change the company declare connection_change. Everything else is a read, a check, or the flow's own note of which provider was chosen, and changes nothing outside.
// DECISION: no secret passes through here. A person's own screen puts a key in the Vault; capabilities name handles.
import { defineManifest, read, t, write } from '../packages/contracts/src/index.ts';
import { email, pageIn } from './_common.ts';

const provider = t.enm('google', 'microsoft');
const data = t.obj({ mail: t.bool(), calendar: t.bool(), files: t.bool() });
const step = t.obj({ id: t.str(), title: t.str(), doc: t.str(), done: t.bool(), optional: t.opt(t.bool()) });
const statusOut = {
  started: t.bool(), providers: t.opt(t.arr(t.obj({ key: provider, title: t.str() }))), provider: t.opt(provider), title: t.opt(t.str()), data: t.opt(data), doc: t.opt(t.str()), steps: t.opt(t.arr(step)), next: t.opt(t.str()),
  requireSso: t.opt(t.bool()), signInOn: t.opt(t.bool()), keyHandle: t.opt(t.str()), connected: t.opt(t.bool()), connectedAt: t.opt(t.ts()), mapped: t.opt(t.int()), excluded: t.opt(t.arr(email)), space: t.opt(t.str()), redirect: t.opt(t.str()), clientId: t.opt(t.str()), lastSweep: t.opt(t.str()),
};

export default defineManifest({
  id: 'company',
  title: 'Connect your company',
  owner: 'L5',
  capabilities: [
    read('company.status', 'Where Connect your company stands: the provider, each step and whether it is done, the next step, and which doc section explains it. Read this first; it never asks twice', { in: {}, out: statusOut, perm: 'connectors.manage', tool: 'engineer' }),
    write('company.start', 'Start Connect your company for Google Workspace or Microsoft 365 and choose Mail, Calendar and Files, or pick it up where it stands', {
      in: { provider, data: t.opt(data) }, out: statusOut, perm: 'connectors.manage', audit: 'always', tool: 'engineer', errors: ['validation.precondition_failed'],
    }),
    read('company.script', 'The one paste that does the provider\'s side: which shell to open and the script. It holds no secret; the admin runs it under their own account', {
      in: { provider }, out: { shell: t.str(), url: t.str(), script: t.str() }, perm: 'connectors.manage', tool: 'engineer',
    }),
    write('company.probe', 'The read-only check of what the company allowed, as one line a person can act on', {
      in: {}, out: { ok: t.bool(), line: t.str(), missing: t.opt(t.arr(t.str())) }, perm: 'connectors.manage', audit: 'always', tool: 'engineer', errors: ['validation.precondition_failed', 'provider.auth_failed'],
    }),
    write('company.connect', 'The one confirmation: everyone included comes in, and the directory is watched from here on', {
      in: {}, out: { connected: t.int(), included: t.int() }, perm: 'connectors.manage', risk: 'high', idem: 'key', audit: 'always', tool: 'engineer', gate: { act: 'connection_change', when: "actor.kind != 'person'" }, errors: ['validation.precondition_failed', 'permission.on_hold'],
    }),
    write('company.disconnect', 'Undo: every member sync stops at once; what already came in stays with its owner', {
      in: {}, out: { disconnected: t.bool() }, perm: 'connectors.manage', risk: 'high', audit: 'always', tool: 'engineer', gate: { act: 'connection_change', when: "actor.kind != 'person'" }, errors: ['permission.on_hold'],
    }),
    write('company.sweep', 'Check the directory: a person gone from it stops and loses access. Runs on a schedule; a person confirms a change large enough to be held', {
      in: { confirmed: t.opt(t.bool()) }, out: { checked: t.int(), gone: t.arr(email), held: t.opt(t.str()) }, perm: 'connectors.manage', audit: 'always', tool: 'engineer',
    }),
    read('company.access_log', 'Who reached whose mail, calendar or files: who made the call, the person an agent worked for, which mailbox, when', {
      in: { ...pageIn, mailbox: t.opt(email) }, out: { entries: t.arr(t.obj({ who: t.str(), onBehalf: t.opt(t.str()), mailbox: t.str(), cap: t.str(), at: t.ts() })), next: t.opt(t.str()) }, perm: 'connectors.manage', tool: 'engineer',
    }),
  ],
});
