// vault (lane L7a): items (a name plus KEY=value fields), folders, levels, AI providers (including subscription sign-ins), import, generate, health,
// .env export behind the secret_export Gate act, and use by handle (use, fill, reveal). Key requests live in module vault-requests.
// Vault values never appear in an output except vault.item.reveal (View level), the fresh value of vault.generate, and the optional fill result for a View-level caller.
// Events and audit rows carry names, ids and field keys only, never values.
// Vault Use (fill without seeing) is below View (see the value) on the vault ladder use < view < edit < manage (contracts/src/levels.ts); capabilities name the level they need and authorize compares along the ladder of the resource type.
// vault.use and vault.fill take a name or handle; the binding says resolve: 'name' or 'handle' and the gateway resolves it to the item before authorize.
// DECISION: vault.item.reveal has no role permission in the manifest; the handler additionally requires vault.reveal for Shared items (Mine items need only View, held by the owner).
// DECISION: vault.item.put creates; changes go through vault.item.update. Creating requires vault.shared_create (Members have it); the paste-understanding of the Add sheet runs on the client and sends fields.
// DECISION: vault folders are vault_folder resources managed here because they carry the per-folder "Who can export" rule; folders.* in access skips the vault_item type. The ListDef keeps folders true and the tree is read from vault.folders.list.
// DECISION: every vault write that carries a value is offline 'online': values are never placed in the pending_ops queue on a device.
// DECISION: import files are deleted right after the commit. A subscription provider item is Mine and never shareable.
import { block, defineManifest, entity, ev, health, importSource, list, outward, read, screen, setting, t, write } from '../packages/contracts/src/index.ts';
import { id, level, ok, pageIn, pageOut, principalRef, subjectRef, url } from './_common.ts';

const V = { level: 'view' } as const;
const itemKind = t.enm('login', 'api_key', 'env', 'card', 'note', 'totp', 'ssh_key', 'ai_subscription', 'other');
const importFrom = t.enm('onepassword', 'bitwarden', 'lastpass', 'chrome');
const fieldKey = t.str({ pattern: '^[A-Za-z][A-Za-z0-9_]*$', examples: ['api_key'] });
const fieldIn = t.obj({ key: fieldKey, value: t.str(), secret: t.opt(t.bool()) });
const section = t.enm('personal', 'shared', 'space', 'starred', 'following');
const itemMeta = t.obj({
  id: id.vaultItem, name: t.str(), kind: itemKind, folderId: id.vaultFolder, owner: id.user, scope: t.enm('mine', 'shared'),
  fieldKeys: t.arr(fieldKey), handle: id.handle, spaceOnly: t.bool(), injectIntoDeployments: t.bool(),
  rotateEveryDays: t.opt(t.int({ minimum: 1 })), lastRotatedAt: t.opt(t.ts()), lastUsedAt: t.opt(t.ts()), yourLevel: level, label: t.int({ minimum: 0, maximum: 3 }),
  createdAt: t.ts(), updatedAt: t.ts(),
});
const folderRow = t.obj({
  id: id.vaultFolder, name: t.str(), parentId: t.opt(id.vaultFolder), scope: t.enm('mine', 'shared'), owner: id.user, itemCount: t.int({ minimum: 0 }),
  whoCanExport: t.arr(subjectRef), yourLevel: level,
});
const handleField = t.str({ pattern: '^#[A-Za-z0-9_]+(\\.[A-Za-z0-9_]+)?$', description: 'A handle, with a field after the dot to name one field', examples: ['#Dana_Lawmatics.api_key'] });
const providerRow = t.obj({
  id: t.id('prv'), providerKey: t.str({ examples: ['anthropic'] }), name: t.str(), logo: t.opt(t.str()),
  connection: t.enm('subscription', 'api_key', 'local_model'), via: t.str({ examples: ['Subscription, yours'] }), scope: t.enm('mine', 'shared'),
  itemId: id.vaultItem, handle: t.opt(id.handle), agentsUsing: t.arr(id.agent),
  usage: t.obj({ tokens: t.int({ minimum: 0 }), costCents: t.int({ minimum: 0 }), periodStart: t.ts() }),
  engine: t.str({ examples: ['claude-code'] }), spaceMayUse: t.bool(), state: t.enm('ok', 'needs_sign_in', 'failing'),
});
const exportRow = t.obj({ id: t.id('vex'), folderId: id.vaultFolder, by: id.user, expiresAt: t.ts(), pulled: t.bool() });
const exportPolicy = t.obj({ exportRoles: t.arr(t.str()), pullExpiryMax: t.enm('1h', '1d', '7d'), blockRestrictedExport: t.lit(true), revealNeedsReason: t.bool() });
const historyRow = t.obj({
  at: t.ts(), actor: principalRef, onBehalfOf: t.opt(principalRef),
  action: t.enm('created', 'used', 'revealed', 'edited', 'moved', 'rotated', 'shared', 'unshared', 'exported', 'deleted', 'restored'),
  field: t.opt(fieldKey), via: t.opt(t.enm('device', 'host', 'computer')), detail: t.opt(t.str()),
});

export default defineManifest({
  id: 'vault',
  title: 'Vault',
  owner: 'L7a',

  events: [
    ev('vault.used', 'An item was used by handle; the value was filled and scrubbed (no value in the event)', { p: { itemId: id.vaultItem, field: t.opt(fieldKey), via: t.enm('device', 'host', 'computer'), purpose: t.opt(t.str()) }, subject: ['vault_item', '/itemId'], vis: 'participants', retention: 'audit' }),
    ev('vault.revealed', 'A value was shown to a person at View level (audited per actor)', { p: { itemId: id.vaultItem, fields: t.arr(fieldKey) }, subject: ['vault_item', '/itemId'], vis: 'participants', retention: 'audit' }),
    ev('vault.exported', 'A .env file was made from a folder; the folder owner is notified', { p: { exportId: t.id('vex'), folderId: id.vaultFolder, itemCount: t.int({ minimum: 0 }), expiresAt: t.ts() }, subject: ['vault_folder', '/folderId'], vis: 'participants', retention: 'audit' }),
    ev('vault.export_revoked', 'An export pull link was revoked before it expired', { p: { exportId: t.id('vex'), folderId: id.vaultFolder }, subject: ['vault_folder', '/folderId'], retention: 'audit' }),
    ev('vault.scrub_miss', 'The output scrubber failed to remove a value from a stream (value not recorded)', { p: { itemId: id.vaultItem, place: t.enm('terminal', 'http', 'browser', 'file', 'chat'), traceId: id.trace }, subject: ['vault_item', '/itemId'], vis: 'participants', retention: 'audit' }),
    ev('vault.item_created', 'An item was added', { p: { itemId: id.vaultItem, kind: itemKind, folderId: id.vaultFolder, scope: t.enm('mine', 'shared') }, subject: ['vault_item', '/itemId'], vis: 'participants' }),
    ev('vault.item_updated', 'Fields or settings of an item changed (field keys only)', { p: { itemId: id.vaultItem, fieldsChanged: t.arr(fieldKey), settingsChanged: t.arr(t.str()) }, subject: ['vault_item', '/itemId'], vis: 'participants' }),
    ev('vault.item_moved', 'An item moved to another folder (re-encrypted when it crosses Mine and Shared)', { p: { itemId: id.vaultItem, fromFolderId: id.vaultFolder, toFolderId: id.vaultFolder }, subject: ['vault_item', '/itemId'], vis: 'participants' }),
    ev('vault.item_deleted', 'An item moved to Trash', { p: { itemId: id.vaultItem }, subject: ['vault_item', '/itemId'], vis: 'participants' }),
    ev('vault.item_restored', 'An item came back from Trash', { p: { itemId: id.vaultItem }, subject: ['vault_item', '/itemId'], vis: 'participants' }),
    ev('vault.item_rotated', 'An item was marked rotated', { p: { itemId: id.vaultItem }, subject: ['vault_item', '/itemId'], vis: 'participants' }),
    ev('vault.imported', 'Items came in from another password manager (counts only)', { p: { source: importFrom, folderId: id.vaultFolder, created: t.int({ minimum: 0 }), updated: t.int({ minimum: 0 }), skipped: t.int({ minimum: 0 }) }, subject: ['vault_folder', '/folderId'], vis: 'participants', retention: 'audit' }),
    ev('vault.folder_created', 'A vault folder was made', { p: { folderId: id.vaultFolder, scope: t.enm('mine', 'shared') }, subject: ['vault_folder', '/folderId'], vis: 'participants' }),
    ev('vault.folder_updated', 'A vault folder was renamed or its Who can export rule changed', { p: { folderId: id.vaultFolder, exportRuleChanged: t.bool() }, subject: ['vault_folder', '/folderId'], vis: 'participants', retention: 'audit' }),
    ev('vault.folder_deleted', 'A vault folder was deleted', { p: { folderId: id.vaultFolder }, subject: ['vault_folder', '/folderId'], vis: 'participants' }),
    ev('provider.added', 'An AI provider was connected (subscription, key or local model)', { p: { providerId: t.id('prv'), providerKey: t.str(), connection: t.enm('subscription', 'api_key', 'local_model'), scope: t.enm('mine', 'shared') }, subject: ['entity', '/providerId'], vis: 'participants' }),
    ev('provider.updated', 'A provider changed (Space may use it, sign-in state)', { p: { providerId: t.id('prv'), spaceMayUse: t.opt(t.bool()), state: t.opt(t.enm('ok', 'needs_sign_in', 'failing')) }, subject: ['entity', '/providerId'], vis: 'participants' }),
    ev('provider.removed', 'An AI provider was removed', { p: { providerId: t.id('prv') }, subject: ['entity', '/providerId'], vis: 'participants' }),
    ev('vault.site_rule_changed', 'A person set or cleared the never-fill or never-save rule for one site (host only)', { p: { personId: id.user, host: t.str(), neverFill: t.bool(), neverSave: t.bool() }, subject: ['entity', '/personId'], vis: 'owner' }),
    ev('vault.rotation_due', 'An item reached its rotation reminder date (ids only); the owner gets a Badge notification', { p: { itemId: id.vaultItem, dueSince: t.ts() }, subject: ['vault_item', '/itemId'], vis: 'participants', notify: 'vault.rotation_due' }),
  ],

  capabilities: [
    // ---- items: lists, metadata, reveal
    read('vault.items.list', 'List items (names and metadata only, never values) by section, folder, kind or text', {
      ...V, in: { section: t.opt(section), folder: t.opt(id.vaultFolder), kind: t.opt(itemKind), q: t.opt(t.str()), ...pageIn },
      out: { items: t.arr(itemMeta), counts: t.rec(t.int({ minimum: 0 })), ...pageOut }, tool: 'vault', label: 'filter', cli: 'vyre vault list',
    }),
    read('vault.items.match', 'Items that fit a website address (the Chrome extension offers them to fill)', { ...V, in: { url }, out: { items: t.arr(t.obj({ item: itemMeta, usernameField: t.opt(fieldKey) })) }, tool: 'vault', label: 'filter' }),
    read('vault.item.get', 'One item: metadata and field keys, never values', {
      in: { itemId: id.vaultItem }, out: { item: itemMeta, fields: t.arr(t.obj({ key: fieldKey, secret: t.bool(), hasValue: t.bool() })) }, on: ['vault_item', '/itemId'], level: 'use', tool: 'vault', label: 'check', cli: 'vyre vault get',
    }),
    read('vault.item.reveal', 'Show the values of an item to a person at View level (asked once, logged per actor)', {
      in: { itemId: id.vaultItem, fields: t.opt(t.arr(fieldKey)), reason: t.opt(t.str()) }, out: { fields: t.arr(t.obj({ key: fieldKey, value: t.str() })) },
      on: ['vault_item', '/itemId'], level: 'view', risk: 'high', emits: ['vault.revealed'], audit: 'always', label: 'check', rate: { n: 30, perSeconds: 60, scope: 'principal' },
      tool: 'vault', errors: ['permission.provider_label', 'permission.above_clearance'], offline: 'online',
    }),
    read('vault.item.history', 'Every use, reveal, edit and share of an item (never values)', { in: { itemId: id.vaultItem, ...pageIn }, out: { entries: t.arr(historyRow), ...pageOut }, on: ['vault_item', '/itemId'], level: 'edit', tool: 'vault' }),

    // ---- items: create, change, move, delete
    read('vault.item.usage', 'Who used a key or sign-in and how much: turns and tokens per agent and per person, and the total, from the turns the engine metered on the item; a person sees their own turns, a manager of AI spend all of them', {
      in: { itemId: id.vaultItem, since: t.opt(t.ts()) },
      out: { actors: t.arr(t.obj({ actor: principalRef, turns: t.int({ minimum: 0 }), tokens: t.int({ minimum: 0 }) })), total: t.obj({ turns: t.int({ minimum: 0 }), tokens: t.int({ minimum: 0 }) }) },
      on: ['vault_item', '/itemId'], level: 'view', tool: 'vault',
    }),
    write('vault.item.put', 'Add an item: a name plus KEY=value fields (a pasted .env or an app template becomes fields on the client)', {
      idem: 'key', in: { folderId: id.vaultFolder, name: t.str(), kind: itemKind, fields: t.arr(fieldIn), template: t.opt(t.str({ examples: ['lawmatics'] })), spaceOnly: t.opt(t.bool()), injectIntoDeployments: t.opt(t.bool()), rotateEveryDays: t.opt(t.int({ minimum: 1 })) },
      out: { item: itemMeta }, on: ['vault_folder', '/folderId'], level: 'edit', perm: 'vault.shared_create', emits: ['vault.item_created'], audit: 'sensitive', tool: 'vault', offline: 'online', errors: ['validation.duplicate'],
    }),
    write('vault.item.update', 'Change fields or settings of an item: set and remove fields, Space only lock, inject into deployments, rotation reminder', {
      in: { itemId: id.vaultItem, name: t.opt(t.str()), fieldsSet: t.opt(t.arr(fieldIn)), fieldsRemove: t.opt(t.arr(fieldKey)), spaceOnly: t.opt(t.bool()), injectIntoDeployments: t.opt(t.bool()), rotateEveryDays: t.opt(t.nullable(t.int({ minimum: 1 }))) },
      out: { item: itemMeta }, on: ['vault_item', '/itemId'], level: 'edit', emits: ['vault.item_updated'], audit: 'sensitive', tool: 'vault', offline: 'online',
    }),
    write('vault.item.move', 'Move an item to another folder; crossing Mine and Shared re-encrypts it', {
      in: { itemId: id.vaultItem, folderId: id.vaultFolder }, out: { item: itemMeta }, on: ['vault_item', '/itemId'], level: 'manage', emits: ['vault.item_moved', 'item.moved'], audit: 'sensitive', tool: 'vault', offline: 'online', errors: ['validation.precondition_failed'],
    }),
    write('vault.item.mark_rotated', 'Record that the secret was rotated and restart its reminder', { in: { itemId: id.vaultItem }, out: { item: itemMeta }, on: ['vault_item', '/itemId'], level: 'edit', emits: ['vault.item_rotated'], audit: 'sensitive', tool: 'vault', offline: 'online' }),
    write('vault.item.delete', 'Move an item to Trash', { in: { itemId: id.vaultItem }, out: ok, on: ['vault_item', '/itemId'], level: 'manage', emits: ['vault.item_deleted'], gate: { act: 'delete', when: "actor.kind != 'person'" }, audit: 'always', tool: 'vault', offline: 'online' }),
    write('vault.item.restore', 'Bring an item back from Trash', { in: { itemId: id.vaultItem }, out: { item: itemMeta }, on: ['vault_item', '/itemId'], level: 'manage', emits: ['vault.item_restored'], audit: 'sensitive', tool: 'vault', offline: 'online' }),

    // ---- sharing (a thin front over access.share with the vault levels)
    write('vault.share', 'Share an item or folder with a person, group, agent or automation at Use, View, Edit or Manage; subscription sign-ins are never shareable', {
      ...V, idem: 'key', in: { resource: t.obj({ type: t.enm('vault_item', 'vault_folder'), id: t.str({ examples: ['vit_a1b2c3'] }) }), subject: subjectRef, level },
      out: { granted: t.bool() }, emits: ['grant.created', 'access.changed', 'folder.shared'], audit: 'always', tool: 'vault', offline: 'online', team: true, errors: ['validation.precondition_failed', 'permission.not_contained'],
    }),
    write('vault.unshare', 'Stop sharing an item or folder with someone', {
      ...V, in: { resource: t.obj({ type: t.enm('vault_item', 'vault_folder'), id: t.str({ examples: ['vit_a1b2c3'] }) }), subject: subjectRef },
      out: { revoked: t.int({ minimum: 0 }) }, emits: ['grant.revoked', 'access.changed', 'folder.shared'], audit: 'always', tool: 'vault', offline: 'online', team: true,
    }),

    // ---- use by handle
    write('vault.use', 'Ask for an item by name: returns a handle like #Dana_Lawmatics and the field names, never values', {
      in: { item: t.str({ description: 'Item name or id', examples: ['Dana_Lawmatics'] }), fields: t.opt(t.arr(fieldKey)), purpose: t.opt(t.str()) },
      out: { handle: id.handle, itemId: id.vaultItem, fields: t.arr(fieldKey) }, on: ['vault_item', '/item'], resolve: 'name', level: 'use', emits: ['vault.used'], audit: 'sensitive', tool: 'vault', offline: 'online', errors: ['permission.provider_label'],
    }),
    write('vault.fill', 'Fill a handle into a process at the last moment (env, request header, browser field, terminal) and scrub it from the output; the value stays in the filler', {
      in: { handle: handleField, target: t.obj({ kind: t.enm('env', 'http_header', 'browser', 'terminal', 'file', 'git_credential', 'container_env', 'route_auth'), ref: t.str() }), returnValue: t.opt(t.bool()) },
      out: { filled: t.bool(), field: fieldKey, where: t.enm('device', 'host', 'computer'), value: t.opt(t.str({ description: 'Only for a caller at View level who set returnValue; never for agents' })) },
      on: ['vault_item', '/handle'], resolve: 'handle', level: 'use', emits: ['vault.used'], audit: 'sensitive', tool: 'vault', offline: 'online', errors: ['permission.provider_label'],
    }),
    write('vault.inject_env', 'Inject a folder into one child process environment (vyre run --env folder -- command); returns key names only', {
      in: { folderId: id.vaultFolder, purpose: t.opt(t.str()) }, out: { handles: t.arr(id.handle), keys: t.arr(fieldKey) }, on: ['vault_folder', '/folderId'], level: 'use', emits: ['vault.used'], audit: 'sensitive', tool: 'vault', cli: 'vyre run --env', offline: 'online',
    }),
    write('vault.report_scrub_miss', 'System: the filler reports a value it could not scrub from an output stream', {
      ...V, in: { itemId: id.vaultItem, place: t.enm('terminal', 'http', 'browser', 'file', 'chat'), traceId: id.trace }, out: ok, emits: ['vault.scrub_miss'], audit: 'always',
    }),

    // ---- export as .env (permissioned exception)
    outward('vault.export_env', 'Export a folder as a .env file: one pull link that expires after 1 hour, 1 day or 7 days; never for Restricted items; the folder owner is notified', {
      in: { folderId: id.vaultFolder, expiresIn: t.enm('1h', '1d', '7d'), itemIds: t.opt(t.arr(id.vaultItem)) }, out: { exportId: t.id('vex'), pullUrl: url, expiresAt: t.ts() },
      on: ['vault_folder', '/folderId'], level: 'use', perm: 'vault.export', gate: 'secret_export', emits: ['vault.exported'], risk: 'high', tool: 'vault', offline: 'online', errors: ['permission.above_clearance'],
    }),
    read('vault.exports.list', 'Export pull links that are still open', { ...V, in: { folderId: t.opt(id.vaultFolder) }, out: { exports: t.arr(exportRow) }, perm: 'vault.export', tool: 'vault' }),
    write('vault.exports.revoke', 'Close an export pull link early', { ...V, in: { exportId: t.id('vex') }, out: ok, perm: 'vault.export', emits: ['vault.export_revoked'], audit: 'always', tool: 'vault' }),
    outward('vault.items.export_mine', 'A person exports their own Mine items (also for 30 days after removal); one pull link, audited', {
      ...V, in: { expiresIn: t.enm('1h', '1d', '7d') }, out: { exportId: t.id('vex'), pullUrl: url, expiresAt: t.ts() }, gate: 'secret_export', risk: 'high', tool: 'vault', offline: 'online',
    }),

    // ---- import, generate, health
    read('vault.import_parse', 'Preview an import file from 1Password, Bitwarden, LastPass or Chrome: names, kinds, field keys and duplicates (values are not echoed)', {
      ...V, in: { source: importFrom, fileId: id.file }, out: { items: t.arr(t.obj({ name: t.str(), kind: itemKind, fieldKeys: t.arr(fieldKey), duplicateOf: t.opt(id.vaultItem), warnings: t.arr(t.str()) })) }, perm: 'vault.shared_create', tool: 'vault',
    }),
    write('vault.import', 'Import items in one step into a folder; the file is deleted afterwards', {
      idem: 'key', in: { source: importFrom, fileId: id.file, folderId: id.vaultFolder, dedupe: t.enm('skip', 'overwrite', 'keep_both') }, out: { created: t.int({ minimum: 0 }), updated: t.int({ minimum: 0 }), skipped: t.int({ minimum: 0 }) },
      on: ['vault_folder', '/folderId'], level: 'edit', perm: 'vault.shared_create', emits: ['vault.imported', 'vault.item_created'], audit: 'always', tool: 'vault', offline: 'online',
    }),
    read('vault.generate', 'Make a password, passphrase or token; the result is a fresh value that is not stored', {
      ...V, in: { kind: t.enm('password', 'passphrase', 'token'), length: t.opt(t.int({ minimum: 8, maximum: 128 })), symbols: t.opt(t.bool()), words: t.opt(t.int({ minimum: 3, maximum: 10 })) }, out: { value: t.str(), strength: t.enm('fair', 'good', 'strong') }, tool: 'vault', offline: 'online',
    }),
    read('vault.health', 'Team health: weak, reused, stale and rotation-due items (ids and issues only; breach checks come later)', {
      ...V, in: { folderId: t.opt(id.vaultFolder) }, out: { total: t.int({ minimum: 0 }), weak: t.int({ minimum: 0 }), reused: t.int({ minimum: 0 }), stale: t.int({ minimum: 0 }), rotationDue: t.int({ minimum: 0 }), items: t.arr(t.obj({ itemId: id.vaultItem, name: t.str(), issues: t.arr(t.enm('weak', 'reused', 'stale', 'rotation_due')) })) }, tool: 'vault', label: 'filter',
    }),

    // ---- folders
    read('vault.folders.list', 'Vault folders with counts and my level', { ...V, in: { scope: t.opt(t.enm('mine', 'shared')) }, out: { folders: t.arr(folderRow) }, tool: 'vault', label: 'filter' }),
    write('vault.folders.create', 'Make a vault folder (Mine, or Shared when the person may create shared items)', {
      ...V, idem: 'key', in: { name: t.str(), parentId: t.opt(id.vaultFolder), scope: t.enm('mine', 'shared') }, out: { folder: folderRow }, perm: 'vault.shared_create', emits: ['vault.folder_created'], tool: 'vault', offline: 'online',
    }),
    write('vault.folders.update', 'Rename a vault folder or set Who can export for it', {
      in: { folderId: id.vaultFolder, name: t.opt(t.str()), whoCanExport: t.opt(t.arr(subjectRef)) }, out: { folder: folderRow }, on: ['vault_folder', '/folderId'], level: 'manage', emits: ['vault.folder_updated'], audit: 'always', tool: 'vault', offline: 'online',
    }),
    write('vault.folders.delete', 'Delete an empty vault folder', { in: { folderId: id.vaultFolder }, out: ok, on: ['vault_folder', '/folderId'], level: 'manage', emits: ['vault.folder_deleted'], gate: { act: 'delete', when: "actor.kind != 'person'" }, audit: 'always', tool: 'vault', offline: 'online', errors: ['validation.precondition_failed'] }),

    // ---- vault policy (Console)
    read('vault.policy.get', 'The Space vault policy: who may export, longest pull link, Restricted never exported, reveal reasons', { ...V, in: {}, out: { policy: exportPolicy }, perm: 'vault.policy', tool: 'vault', team: true }),
    write('vault.policy.set', 'Set the Space vault policy', { ...V, in: { policy: exportPolicy }, out: { policy: exportPolicy }, perm: 'vault.policy', emits: ['policy.changed'], audit: 'always', risk: 'high', tool: 'vault', team: true }),

    // ---- AI providers (top of the Vault)
    read('providers.catalog', 'The provider gallery from the definition files: name, logo, connection kinds, model list source, engine', {
      ...V, in: {}, out: { providers: t.arr(t.obj({ key: t.str(), name: t.str(), logo: t.opt(t.str()), connections: t.arr(t.enm('subscription', 'api_key', 'local_model')), modelsSource: t.str(), engine: t.str() })) }, tool: 'vault',
    }),
    read('providers.list', 'My connected AI providers: logo, how connected, Mine or Shared, agents using it, this month\'s usage', { ...V, in: {}, out: { providers: t.arr(providerRow) }, tool: 'vault' }),
    write('providers.add', 'Connect a provider with a pasted API key (stored once, used by handle) or a local model address', {
      ...V, idem: 'key', in: { providerKey: t.str({ examples: ['anthropic'] }), connection: t.enm('api_key', 'local_model'), name: t.opt(t.str()), apiKey: t.opt(t.str()), address: t.opt(url), scope: t.enm('mine', 'shared'), folderId: t.opt(id.vaultFolder) },
      out: { provider: providerRow }, emits: ['provider.added', 'vault.item_created'], audit: 'sensitive', tool: 'vault', offline: 'online', errors: ['validation.duplicate', 'provider.auth_failed'],
    }),
    write('providers.subscription_start', 'Start a subscription sign-in (Claude Code setup-token, Codex login) inside my own sandbox or device', {
      ...V, idem: 'key', in: { providerKey: t.str({ examples: ['claude-code'] }) }, out: { flowId: t.id('sub'), instruction: t.str(), url: t.opt(url), userCode: t.opt(t.str()) }, audit: 'sensitive', tool: 'vault', offline: 'online',
    }),
    write('providers.subscription_complete', 'Finish a subscription sign-in: the credential files are captured into a Mine item of kind ai_subscription', {
      ...V, in: { flowId: t.id('sub') }, out: { provider: providerRow }, emits: ['provider.added', 'vault.item_created'], audit: 'sensitive', tool: 'vault', offline: 'online', errors: ['provider.auth_failed', 'timeout.deadline'],
    }),
    write('providers.set_space_use', 'Let the Space run work on my subscription, or stop it (stopping ends my sandbox)', {
      ...V, in: { providerId: t.id('prv'), allow: t.bool() }, out: { provider: providerRow }, emits: ['provider.updated'], audit: 'always', tool: 'vault', offline: 'online',
    }),
    read('providers.test', 'Test a provider connection and list the models it offers', { ...V, in: { providerId: t.id('prv') }, out: { ok: t.bool(), models: t.arr(t.str()), latencyMs: t.int({ minimum: 0 }), detail: t.opt(t.str()) }, tool: 'vault', offline: 'online' }),
    write('providers.remove', 'Remove a provider and its key or sign-in', { ...V, in: { providerId: t.id('prv') }, out: ok, emits: ['provider.removed', 'vault.item_deleted'], audit: 'always', gate: { act: 'delete', when: "actor.kind != 'person'" }, tool: 'vault', offline: 'online' }),

    // ---- health probe
    read('vault.service_health', 'Health probe: the vault service answers and its key handle is loaded', { ...V, in: {}, out: { state: t.enm('healthy', 'degraded', 'down'), detail: t.opt(t.str()), latencyMs: t.opt(t.int({ minimum: 0 })) } }),
    // ---- site rules (Vyre for Chrome: Never Fill on This Site, Never for this site)
    read('vault.site_rules.list', 'Sites where I never fill and never get offered to save a login in this Space (Never Fill on This Site)', {
      ...V, out: { sites: t.arr(t.obj({ host: t.str({ examples: ['bank.example.com'] }), neverFill: t.bool(), neverSave: t.bool(), at: t.ts() })) }, tool: 'vault',
    }),
    write('vault.site_rules.set', 'Set or clear the never-fill and never-save rule for one site; personal, follows the extension in this Space', {
      ...V, in: { host: t.str({ examples: ['bank.example.com'] }), neverFill: t.bool(), neverSave: t.bool() }, out: { host: t.str(), neverFill: t.bool(), neverSave: t.bool() },
      emits: ['vault.site_rule_changed'], tool: 'vault', offline: 'online', idem: 'natural',
    }),
  ],

  entities: [
    entity('vault_meta', 'vault_meta', 'vit_', {
      name: 'text', kind: 'choice', folderId: 'text', owner: 'person', scope: 'choice', fieldKeys: 'text', handle: 'text', spaceOnly: 'checkbox', injectIntoDeployments: 'checkbox',
      rotateEveryDays: 'number', lastUsedAt: 'datetime', updatedAt: 'datetime',
    }, 'vault_item', { ownerField: 'owner', parentField: 'folderId', fts: ['name'], sync: { maxLabel: 'confidential', profile: { desktop: 'all', phone: 'all', web: 'all' } } }),
  ],

  lists: [
    list('vault_item', 'Vault item', 'Vault items', 'vault.items.list', { shareLevels: ['view', 'use', 'edit', 'manage'] }),
  ],

  importSources: [
    importSource('onepassword', '1Password', ['.1pux', '.csv'], 'vault.import_parse', 'vault'),
    importSource('bitwarden', 'Bitwarden', ['.json', '.csv'], 'vault.import_parse', 'vault'),
    importSource('lastpass', 'LastPass', ['.csv'], 'vault.import_parse', 'vault'),
    importSource('chrome', 'Chrome passwords', ['.csv'], 'vault.import_parse', 'vault'),
  ],

  blocks: [
    block('vault_used', { itemId: id.vaultItem, name: t.str(), handle: id.handle, fields: t.arr(fieldKey), outcome: t.enm('used', 'filled', 'blocked'), where: t.opt(t.enm('device', 'host', 'computer')) },
      'Used {{handle}} ({{outcome}}). The value was not shown.', { opens: { tab: 'vault.item', input: { itemId: '/itemId' } } }),
    block('secret_input', { name: t.str(), kind: itemKind, folderId: id.vaultFolder, fields: t.arr(fieldKey), hint: t.opt(t.str()) },
      'Add {{name}} to the Vault: type the value in the field above. It does not enter this chat.', {
        actions: [{ key: 'save', label: 'Save to Vault', cap: 'vault.item.put', input: { folderId: '/folderId', name: '/name', kind: '/kind' } }],
      }),
  ],

  screens: [
    screen('vault.layout', 'vault', 'ui:VaultLayout', { q: { items: ['vault.items.list', { section: '/state/section', folder: '/state/folder', kind: '/state/kind', q: '/state/query' }], folders: ['vault.folders.list', { scope: '/state/scope' }], providers: ['providers.list'] }, empty: 'Your vault is empty', primary: 'Add an item' }),
    screen('vault.item', 'vault', 'ui:VaultItem', {
      slot: 'side', q: { item: ['vault.item.get', { itemId: '/state/itemId' }], history: ['vault.item.history', { itemId: '/state/itemId' }] },
      a: { reveal: ['vault.item.reveal', { itemId: '/state/itemId', fields: '/state/fields' }], update: ['vault.item.update', { itemId: '/state/itemId', fieldsSet: '/state/fieldsSet', fieldsRemove: '/state/fieldsRemove' }], move: ['vault.item.move', { itemId: '/state/itemId', folderId: '/state/folderId' }], rotate: ['vault.item.mark_rotated', { itemId: '/state/itemId' }], delete: ['vault.item.delete', { itemId: '/state/itemId' }, 'Move this item to Trash?'] },
    }),
    screen('vault.add', 'vault', 'ui:VaultAddAnything', { slot: 'sheet', a: { put: ['vault.item.put', { folderId: '/state/folderId', name: '/state/name', kind: '/state/kind', fields: '/state/fields', template: '/state/template' }], generate: ['vault.generate', { kind: '/state/generateKind', length: '/state/length' }] } }),
    screen('vault.providers', 'vault', 'ui:VaultProviders', { q: { providers: ['providers.list'], catalog: ['providers.catalog'] }, a: { add: ['providers.add', { providerKey: '/state/providerKey', connection: '/state/connection', apiKey: '/state/apiKey', address: '/state/address', scope: '/state/scope' }], test: ['providers.test', { providerId: '/state/providerId' }], start: ['providers.subscription_start', { providerKey: '/state/providerKey' }], complete: ['providers.subscription_complete', { flowId: '/state/flowId' }], remove: ['providers.remove', { providerId: '/state/providerId' }, 'Remove this provider?'] }, empty: 'No AI provider yet', primary: 'Add a provider' }),
    screen('vault.health', 'vault', 'ui:VaultHealth', { q: { health: ['vault.health', { folderId: '/state/folder' }] }, empty: 'Nothing needs attention' }),
    screen('vault.import', 'vault', 'ui:VaultImport', { slot: 'sheet', a: { parse: ['vault.import_parse', { source: '/state/source', fileId: '/state/fileId' }], import: ['vault.import', { source: '/state/source', fileId: '/state/fileId', folderId: '/state/folderId', dedupe: '/state/dedupe' }] } }),
    screen('vault.export', 'vault', 'ui:VaultExport', { slot: 'sheet', needs: ['vault.export'], q: { open: ['vault.exports.list', { folderId: '/state/folderId' }] }, a: { export: ['vault.export_env', { folderId: '/state/folderId', expiresIn: '/state/expiresIn' }, 'Make a .env file from this folder?'], revoke: ['vault.exports.revoke', { exportId: '/state/exportId' }] } }),
    screen('vault.policy', 'console', 'ui:ConsoleVaultPolicy', { needs: ['vault.policy'], q: { policy: ['vault.policy.get'] }, a: { set: ['vault.policy.set', { policy: '/state/policy' }] } }),
  ],

  health: [
    health('vault.service', 'Vault service', 'vault.service_health', 'Restart the vault service from Console > Server > Services; values are safe while it is down', { pauses: ['automations'] }),
  ],

  settings: [
    setting('vault.export_expiry_max', 'space', 'console.vault', 'Longest life of a .env pull link', t.enm('1h', '1d', '7d'), '1d', { floorable: true }),
  ],
});
