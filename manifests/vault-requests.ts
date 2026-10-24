// vault-requests (lane L7a): a missing key asked for by an agent, skill or automation goes to the folder's managers as a request task;
// the requester sees its status and the waiting run resumes when it is fulfilled (6.11, spec 2.17 Requests).
// DECISION: the request is a task of kind 'unblock' created by tasks.create; this module holds the request row, its status and the fulfil path.
// DECISION: fulfil takes either an existing item or fields for a new item; a value typed by the provider goes in the call input and is stored by the vault service, never echoed back.
import { defineManifest, ev, read, screen, t, write } from '../packages/contracts/src/index.ts';
import { id, ok, pageIn, pageOut, principalRef } from './_common.ts';

const V = { level: 'view' } as const;
const reqId = t.id('vrq');
const fieldKey = t.str({ pattern: '^[A-Za-z][A-Za-z0-9_]*$', examples: ['api_key'] });
const requestRow = t.obj({
  id: reqId, name: t.str({ examples: ['Dana_Lawmatics'] }), fields: t.arr(fieldKey), reason: t.str(), requester: principalRef, forRun: t.opt(id.run), folderId: t.opt(id.vaultFolder),
  state: t.enm('waiting', 'fulfilled', 'declined', 'canceled'), itemId: t.opt(id.vaultItem), note: t.opt(t.str()), taskId: id.task, at: t.ts(), decidedAt: t.opt(t.ts()),
});

export default defineManifest({
  id: 'vault-requests',
  title: 'Vault requests',
  owner: 'L7a',

  events: [
    ev('vault.requested', 'A key was asked for; the folder managers get a task', { p: { requestId: reqId, name: t.str(), fields: t.arr(fieldKey), requester: principalRef, forRun: t.opt(id.run), taskId: id.task }, subject: ['entity', '/requestId'], vis: 'participants', trigger: { title: 'A key is requested' }, retention: 'audit' }),
    ev('vault.request_fulfilled', 'A requested key was supplied; the waiting run can resume', { p: { requestId: reqId, itemId: id.vaultItem, forRun: t.opt(id.run) }, subject: ['entity', '/requestId'], vis: 'participants', retention: 'audit' }),
    ev('vault.request_declined', 'A key request was declined with a note', { p: { requestId: reqId, forRun: t.opt(id.run), note: t.opt(t.str()) }, subject: ['entity', '/requestId'], vis: 'participants' }),
    ev('vault.request_canceled', 'The requester withdrew a key request', { p: { requestId: reqId }, subject: ['entity', '/requestId'], vis: 'participants' }),
  ],

  capabilities: [
    write('vault.request', 'Ask for a missing key: creates a request task for the managers of the folder (or the Space vault managers) and tells the requester its status', {
      ...V, idem: 'key', in: { name: t.str({ examples: ['Dana_Lawmatics'] }), fields: t.opt(t.arr(fieldKey)), reason: t.str(), forRun: t.opt(id.run), folderId: t.opt(id.vaultFolder) },
      out: { request: requestRow }, emits: ['vault.requested'], audit: 'sensitive', tool: 'vault', offline: 'online', errors: ['validation.duplicate'],
    }),
    read('vault.requests.list', 'Key requests I made, or waiting on me as a folder manager', { ...V, in: { mine: t.opt(t.bool()), state: t.opt(t.enm('waiting', 'fulfilled', 'declined', 'canceled')), ...pageIn }, out: { requests: t.arr(requestRow), ...pageOut }, tool: 'vault' }),
    read('vault.requests.get', 'One key request with its task and status', { ...V, in: { requestId: reqId }, out: { request: requestRow }, tool: 'vault' }),
    write('vault.requests.fulfil', 'Supply the key: attach an existing item, or save new fields as an item in the requested folder', {
      ...V, in: { requestId: reqId, itemId: t.opt(id.vaultItem), fields: t.opt(t.arr(t.obj({ key: fieldKey, value: t.str() }))), folderId: t.opt(id.vaultFolder) },
      out: { request: requestRow }, emits: ['vault.request_fulfilled'], audit: 'always', tool: 'vault', offline: 'online', errors: ['permission.no_grant', 'validation.precondition_failed'],
    }),
    write('vault.requests.decline', 'Decline a key request with a note', { ...V, in: { requestId: reqId, note: t.opt(t.str()) }, out: ok, emits: ['vault.request_declined'], audit: 'sensitive', tool: 'vault' }),
    write('vault.requests.cancel', 'Withdraw my own key request', { ...V, in: { requestId: reqId }, out: ok, emits: ['vault.request_canceled'], tool: 'vault' }),
  ],

  screens: [
    screen('vault_requests.list', 'vault', 'ui:VaultRequests', {
      q: { requests: ['vault.requests.list', { mine: '/state/mine', state: '/state/state' }] },
      a: { decline: ['vault.requests.decline', { requestId: '/state/requestId', note: '/state/note' }], fulfil: ['vault.requests.fulfil', { requestId: '/state/requestId', itemId: '/state/itemId', fields: '/state/fields', folderId: '/state/folderId' }], cancel: ['vault.requests.cancel', { requestId: '/state/requestId' }, 'Withdraw this request?'] },
      empty: 'No key requests',
    }),
  ],
});
