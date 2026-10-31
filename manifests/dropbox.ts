// dropbox (live folders L3): Dropbox as a file source for Mounts. Not Dropbox Sign (manifests/connectors/dropbox-sign.ts sends documents for signature).
// The app is a Vault item (#Dropbox_App: app_key, app_secret). A person signs in with OAuth (PKCE, offline access) to their own Dropbox, or an admin connects one for the Space; the refresh token lives in
// a Vault item (Mine or Shared) and an access token is made from it for each stretch of work.
// DECISION: the sign-in is this module's own, not the connectors module's. A built-in connector keeps no sign-in address, and the Dropbox app key is configuration read from the Vault, never part of a manifest.
// DECISION: connections are `con_` ids kept in dropbox_account; the module checks ownership itself (a person's own, or the Space's), so no capability binds to a `connection` resource.
// DECISION: writes that change the person's own Dropbox files use the Gate act 'post'; delete uses 'delete'. A write that names `rev` lands only on that revision (validation.version_conflict otherwise).
import { defineManifest, ev, health, outward, read, t, write } from '../packages/contracts/src/index.ts';
import { id } from './_common.ts';

const healthOut = { state: t.enm('healthy', 'degraded', 'down'), detail: t.opt(t.str()), latencyMs: t.opt(t.int()) };
const conn = id.connection;

const entry = t.obj({
  id: t.str({ examples: ['id:a4ayc_80_OEAAAAAAAAAXw'] }), name: t.str(), path: t.str({ description: 'Path as Dropbox shows it' }), pathLower: t.str(), isFolder: t.bool(), deleted: t.opt(t.bool()),
  size: t.opt(t.int({ minimum: 0 })), rev: t.opt(t.str()), modified: t.opt(t.str({ description: 'When Dropbox last saved the content, ISO 8601' })), contentHash: t.opt(t.str()),
  webUrl: t.str({ description: 'Opens the item in the Dropbox website' }),
});

const account = t.obj({ connectionId: conn, ownerKind: t.enm('person', 'space'), accountId: t.str(), email: t.opt(t.str()), name: t.opt(t.str()) });

const capabilities = [
  read('dropbox.app.status', 'Whether the Dropbox app is set up on this server, its key and the address Dropbox sends people back to', {
    in: {}, out: { configured: t.bool(), appKey: t.opt(t.str()), vaultItem: t.opt(t.str()), redirectUri: t.opt(t.str()) },
  }),
  write('dropbox.app.set', 'Name the Vault item that holds the Dropbox app key (and secret, for change notices)', {
    in: { vaultItem: id.handle }, out: { configured: t.bool(), appKey: t.str(), webhooks: t.bool() }, perm: 'connectors.manage', audit: 'always', errors: ['provider.auth_failed'],
  }),
  write('dropbox.connect.start', 'Start signing in to Dropbox: the address to approve at (your own Dropbox, or the Space\'s with admin rights)', {
    in: { ownerKind: t.opt(t.enm('person', 'space')) }, out: { authUrl: t.str(), state: t.str() }, idem: 'none', errors: ['validation.precondition_failed'],
  }),
  write('dropbox.connect.complete', 'Finish signing in from the callback: the state and the code, or the error Dropbox sent when the person declined. Only who started it can finish it', {
    in: { state: t.str(), code: t.opt(t.str()), error: t.opt(t.str()) }, out: { connectionId: conn, accountId: t.str(), email: t.opt(t.str()), name: t.opt(t.str()) },
    emits: ['dropbox.connected'], audit: 'always', idem: 'none', offline: 'online', errors: ['auth.invalid_code', 'auth.unauthenticated', 'provider.auth_failed', 'provider.network', 'provider.bad_response', 'validation.precondition_failed'],
  }),
  read('dropbox.account.list', 'Dropbox accounts you can use: your own and the Space\'s', { in: {}, out: { connections: t.arr(account) } }),
  write('dropbox.account.remove', 'Disconnect a Dropbox account: revoke it at Dropbox and remove its token', { in: { connectionId: conn }, out: { removed: t.bool() }, audit: 'always', gate: 'delete' }),

  read('dropbox.files.list_folder', 'List a Dropbox folder, or continue a listing with its cursor; a cursor kept from before reads only what changed since', {
    in: { connectionId: conn, path: t.opt(t.str({ description: 'Empty for the root, /Folder, or an id such as id:abc' })), recursive: t.opt(t.bool()), limit: t.opt(t.int({ minimum: 1, maximum: 2000 })), cursor: t.opt(t.str()) },
    out: { entries: t.arr(entry), cursor: t.str(), hasMore: t.bool() }, tool: 'files', deferred: true, errors: ['provider.auth_failed', 'provider.rate_limited', 'validation.not_found', 'validation.precondition_failed'],
  }),
  read('dropbox.files.get_metadata', 'Read one Dropbox file or folder', {
    in: { connectionId: conn, path: t.str() }, out: { entry }, tool: 'files', deferred: true, errors: ['provider.auth_failed', 'validation.not_found'],
  }),
  read('dropbox.files.download', 'Download a Dropbox file, or one of its revisions, into a blob', {
    in: { connectionId: conn, path: t.str(), rev: t.opt(t.str()) }, out: { blobId: id.blob, size: t.int(), mime: t.str() }, tool: 'files', deferred: true, errors: ['provider.auth_failed', 'validation.not_found', 'validation.too_large'],
  }),
  outward('dropbox.files.upload', 'Upload a Space file to Dropbox; with rev it only replaces that revision', {
    in: { connectionId: conn, fileId: id.file, path: t.str({ description: 'Where it goes, such as /Sales/Report.docx' }), rev: t.opt(t.str()) }, out: { entry },
    gate: 'post', idem: 'natural', tool: 'files', deferred: true, errors: ['provider.auth_failed', 'validation.version_conflict', 'validation.too_large'],
  }),
  outward('dropbox.files.create_folder', 'Create a Dropbox folder', {
    in: { connectionId: conn, path: t.str() }, out: { entry }, gate: 'post', idem: 'natural', tool: 'files', deferred: true, errors: ['provider.auth_failed', 'validation.version_conflict'],
  }),
  outward('dropbox.files.delete', 'Delete a Dropbox file or folder (Dropbox keeps it in its deleted files for a while)', {
    in: { connectionId: conn, path: t.str(), rev: t.opt(t.str()) }, out: { deleted: t.bool() }, gate: 'delete', idem: 'natural', tool: 'files', deferred: true, errors: ['provider.auth_failed', 'validation.not_found', 'validation.version_conflict'],
  }),
  read('dropbox.files.list_revisions', 'List the saved revisions of a Dropbox file, newest first', {
    in: { connectionId: conn, path: t.str(), limit: t.opt(t.int({ minimum: 1, maximum: 100 })) }, out: { revisions: t.arr(entry), deleted: t.bool() }, tool: 'files', deferred: true, errors: ['provider.auth_failed', 'validation.not_found'],
  }),
  outward('dropbox.files.restore', 'Restore a Dropbox file to one of its revisions', {
    in: { connectionId: conn, path: t.str(), rev: t.str() }, out: { entry }, gate: 'post', idem: 'natural', tool: 'files', deferred: true, errors: ['provider.auth_failed', 'validation.not_found'],
  }),
  read('dropbox.files.latest_cursor', 'The change feed\'s start point for a folder, so a mount reads only what happens after it', {
    in: { connectionId: conn, path: t.opt(t.str()), recursive: t.opt(t.bool()) }, out: { cursor: t.str() }, errors: ['provider.auth_failed', 'validation.not_found'],
  }),
  read('dropbox.files.longpoll', 'Wait for the next change after a cursor (30 to 480 seconds); answers whether there is one and how long to wait before asking again', {
    in: { connectionId: conn, cursor: t.str(), timeoutSeconds: t.opt(t.int({ minimum: 30, maximum: 480 })) }, out: { changes: t.bool(), backoffSeconds: t.opt(t.int({ minimum: 0 })) }, errors: ['validation.precondition_failed'],
  }),
  read('dropbox.health', 'Health probe: the first connected account answers get_current_account', { in: {}, out: healthOut }),
  write('dropbox.receive_webhook', 'Record a verified Dropbox change notice once; it names the accounts that changed', {
    in: { eventId: t.str(), accounts: t.arr(t.str()), at: t.ts() }, out: { accepted: t.bool() }, emits: ['dropbox.changes_received'], idem: 'natural', offline: 'online',
  }),
];

export default defineManifest({
  id: 'dropbox',
  title: 'Dropbox',
  owner: 'L4',
  events: [
    ev('dropbox.connected', 'A Dropbox account was connected', { p: { connectionId: conn, accountId: t.str(), ownerKind: t.enm('person', 'space'), email: t.opt(t.str()) }, subject: ['entity', '/connectionId'] }),
    ev('dropbox.changes_received', 'Dropbox said files changed in these accounts', { p: { eventId: t.str(), accounts: t.arr(t.str()) }, subject: ['entity', '/eventId'], replay: 'stub' }),
  ],
  capabilities,
  health: [
    health('dropbox.account', 'Dropbox', 'dropbox.health', 'Connect Dropbox again from the folder\'s sync line.', { pauses: ['sync'] }),
  ],
});
