// files (lane L4): the Space as one folder tree, files and their versions, changesets (Review changes), trash, sharing, viewer data and markup, comments, lint, spreadsheets (spec 2.16, 3.5; architecture 5.6, 7.5).
// Bytes live in blobs/ (versions in file_versions); mounted and git folders are a view over a real working tree (see mounts and git).
// DECISION: bytes enter through the host blob endpoint, which returns a blobId (files.upload_url); capabilities take text or a blobId, never raw bytes beyond base64 for small files.
// DECISION: file-tree folders carry path, git, mount and review flags, so files owns files.folder.*; the generic list folders for lists are access folders.* and both reach the same folder resource.
// DECISION: files.share delegates to access.share; it only exists so a file tool is complete for agents.
// DECISION: the sheets.* capabilities live here (spreadsheets as table files, spec 2.16); steps-core wraps them as sheet steps. Provider-backed sheets (Google, SharePoint) go through the connector inside the handler.
// DECISION: files.lint amber and red line limits are settings; amber 150 is chosen, red 200 is from the spec.
// DECISION: changesets.approve declares the push_protected act with when input.push; the Gate narrows it to protected branches using the folder git settings.
import { block, create, defineManifest, entity, ev, health, list, outward, read, screen, setting, t, write } from '../packages/contracts/src/index.ts';
import { id, label, level, pageIn, pageOut, purgeOut, subjectRef, versionRow } from './_common.ts';

const fileKind = t.enm('text', 'markdown', 'document', 'spreadsheet', 'presentation', 'pdf', 'image', 'video', 'audio', 'code', 'archive', 'google_native', 'other');
const section = t.opt(t.enm('personal', 'shared', 'space'));
const commentId = t.id('fcm');
const linkId = t.id('lnk');
const rowId = t.str({ description: 'Stable row id inside a sheet', examples: ['r_12'] });

const fileRow = t.obj({
  fileId: id.file, folderId: id.folder, name: t.str(), kind: fileKind, mime: t.str(), size: t.int({ minimum: 0 }), version: t.int({ minimum: 1 }),
  label: t.int({ minimum: 0, maximum: 3 }), ownerId: t.str(), createdAt: t.ts(), updatedAt: t.ts(), updatedBy: t.str(),
  source: t.opt(t.obj({ mountId: id.mount, provider: t.str() })), deletedAt: t.opt(t.ts()), thumb: t.bool(), holds: t.int({ minimum: 0 }),
  starred: t.opt(t.bool()),   // the caller's own star
  conflict: t.opt(t.bool()),  // a staged change to this file collided with a newer version and waits for a reviewer
});

// What a folder belongs to: an agent's or a project's tree, or the Space. The id is that of the agent or project when the folder (or the one above it) was made for one.
const folderSubject = t.obj({ kind: t.enm('agent', 'project', 'space'), id: t.opt(t.str({ examples: ['agt_a1b2c3'] })) });

const folderRow = t.obj({
  folderId: id.folder, parentId: t.opt(id.folder), name: t.str(), path: t.str({ examples: ['Projects/Probate GTM'] }),
  fileCount: t.int({ minimum: 0 }), folderCount: t.int({ minimum: 0 }), scope: t.enm('personal', 'space'), label: t.int({ minimum: 0, maximum: 3 }),
  source: t.opt(t.obj({ mountId: id.mount, provider: t.str() })), git: t.bool(), reviewChanges: t.bool(),
  subject: t.opt(folderSubject),
});

const content = t.obj({ text: t.opt(t.str()), base64: t.opt(t.str()), blobId: t.opt(id.blob) }, { description: 'Exactly one of text, base64 (small files) or blobId (from files.upload_url)' });

const anchor = t.obj({
  kind: t.enm('file', 'line', 'range', 'area', 'page', 'cell'),
  line: t.opt(t.int({ minimum: 1 })), from: t.opt(t.int()), to: t.opt(t.int()), page: t.opt(t.int({ minimum: 1 })),
  box: t.opt(t.obj({ x: t.num(), y: t.num(), w: t.num(), h: t.num() })), cell: t.opt(t.str()), quote: t.opt(t.str()), path: t.opt(t.str()),
}, { description: 'Where a comment or pin sits. Area anchors are the numbered pins agents read.' });

const commentRow = t.obj({
  commentId, fileId: t.opt(id.file), changesetId: t.opt(id.changeset), versionId: t.opt(id.version), anchor, pin: t.opt(t.int({ minimum: 1 })),
  text: t.str(), by: t.str(), at: t.ts(), resolved: t.bool(), mentions: t.arr(t.str()),
});

const hunk = t.obj({
  hunkId: t.str(), oldStart: t.int(), oldLines: t.int(), newStart: t.int(), newLines: t.int(),
  lines: t.arr(t.obj({ op: t.enm('ctx', 'add', 'del'), text: t.str(), marks: t.opt(t.arr(t.obj({ from: t.int(), to: t.int() }))) })),
});

const diffOut = {
  kind: t.enm('text', 'paragraph', 'image', 'binary'), added: t.int(), removed: t.int(), hunks: t.arr(hunk),
  images: t.opt(t.obj({ left: t.opt(id.blob), right: t.opt(id.blob) })), identical: t.bool(),
};

const lintOut = {
  file: t.enm('vyre_md', 'agent_md', 'agent_toml', 'routine_prompt', 'other'), lines: t.int(), state: t.enm('ok', 'amber', 'red'),
  inherits: t.opt(t.bool()), overrides: t.arr(t.obj({ line: t.int(), text: t.str() })),
  secrets: t.arr(t.obj({ line: t.int(), kind: t.str() })),
  problems: t.arr(t.obj({ severity: t.enm('info', 'warn', 'error'), line: t.opt(t.int()), rule: t.str(), message: t.str() })),
};

const changesetRow = t.obj({
  changesetId: id.changeset, folderId: id.folder, state: t.enm('open', 'changes_requested', 'approved', 'discarded'),
  by: t.str(), onBehalfOf: t.opt(t.str()), baseVersion: t.opt(t.str()), fileCount: t.int(), added: t.int(), removed: t.int(),
  openedAt: t.ts(), reviewer: t.opt(t.str()), threadId: t.opt(id.thread), pushPending: t.bool(),
});

const sheetInfo = t.obj({ name: t.str(), rows: t.int({ minimum: 0 }), columns: t.arr(t.str()), keyColumn: t.opt(t.str()) });

export default defineManifest({
  id: 'files',
  title: 'Files',
  owner: 'L4',
  lists: [list('file', 'File', 'Files', 'files.list')],
  entities: [
    entity('file', 'files_file', 'fil_', {
      folder_id: 'text', name: 'text', kind: 'choice', mime: 'text', size: 'number', version: 'number', blob: 'text',
      owner: 'text', source_mount: 'text', created_at: 'datetime', updated_at: 'datetime', updated_by: 'text', deleted_at: 'datetime',
    }, 'file', { parentField: 'folder_id', ownerField: 'owner', fts: ['name'], sync: { profile: { desktop: 'all', phone: 'window', web: 'window' }, window: { recentCount: 200, starred: true } }, retention: 'trash' }),
    entity('file_version', 'files_file_version', 'ver_', {
      file_id: 'text', n: 'number', blob: 'text', actor: 'text', reason: 'text', name: 'text', at: 'datetime',
    }, 'file', { parent: { entity: 'file', field: 'file_id' }, parentField: 'file_id', sync: { profile: { desktop: 'window', phone: 'none', web: 'window' }, window: { days: 30 } }, retention: 'file_versions' }),
  ],
  settings: [
    setting('files.review_changes', 'space', 'files', 'Review agent changes before they sync', t.obj({ git: t.bool(), cloud_mount: t.bool(), plain: t.bool() }), { git: true, cloud_mount: true, plain: false }),
    setting('files.local_mount_default', 'space', 'files', 'Local folder mounts keep a server copy', t.enm('server_copy', 'live_only'), 'server_copy'),
    setting('changesets.different_person', 'space', 'files', 'The approver must differ from the person who asked the agent', t.bool(), false, { floorable: true }),
    setting('files.lint_limits', 'space', 'files', 'Line limits for VYRE.md, AGENT.md and agent.toml', t.obj({ amber: t.int({ minimum: 1 }), red: t.int({ minimum: 1 }) }), { amber: 150, red: 200 }),
  ],
  blocks: [
    block('changeset', { changesetId: id.changeset, folderId: id.folder, folderName: t.str(), fileCount: t.int(), added: t.int(), removed: t.int(), state: t.str() }, 'Changed {{fileCount}} files in {{folderName}}. Review in Files.', {
      actions: [
        { key: 'approve', label: 'Approve and commit', cap: 'changesets.approve', input: { changesetId: '/changesetId' } },
        { key: 'request_changes', label: 'Request changes', cap: 'changesets.request_changes', input: { changesetId: '/changesetId' } },
        { key: 'discard', label: 'Discard', cap: 'changesets.discard', input: { changesetId: '/changesetId' } },
      ],
      opens: { tab: 'diff', input: { changesetId: '/changesetId' } },
    }),
    block('diff', { fileId: t.opt(id.file), changesetId: t.opt(id.changeset), from: t.opt(id.version), to: t.opt(id.version), fileCount: t.int(), added: t.int(), removed: t.int() }, '{{fileCount}} files changed, {{added}} added, {{removed}} removed.', {
      opens: { tab: 'diff', input: { fileId: '/fileId', changesetId: '/changesetId', from: '/from', to: '/to' } },
    }),
    block('file', { fileId: id.file, name: t.str(), kind: fileKind, size: t.int(), version: t.int(), thumb: t.bool() }, 'File {{name}}', {
      opens: { tab: 'viewer', input: { fileId: '/fileId' } },
    }),
    block('mount', { mountId: id.mount, folderId: id.folder, name: t.str(), provider: t.str(), state: t.str(), lagSeconds: t.opt(t.int()) }, 'Mounted {{name}} from {{provider}}', {
      actions: [{ key: 'sync', label: 'Sync now', cap: 'mounts.sync_now', input: { mountId: '/mountId' } }],
      opens: { tab: 'files', input: { folderId: '/folderId' } },
    }),
  ],
  events: [
    // ---- erase and purge (P-CC_39): governance removes data through these; each hard-deletes inside its own store
    ev('file_versions.purged', 'Old file versions were removed by retention (a count)', { p: { removed: t.int({ minimum: 0 }) }, subject: ['entity', '/removed'], retention: 'audit' }),
    ev('file.created', 'A file was created', { p: { fileId: id.file, folderId: id.folder, name: t.str(), kind: fileKind, by: t.str() }, subject: ['file', '/fileId'], label: 'subject', trigger: { title: 'A file is created', fields: ['/folderId', '/kind'] } }),
    ev('file.version_added', 'A file got a new version', { p: { fileId: id.file, versionId: id.version, n: t.int(), by: t.str(), reason: t.opt(t.str()) }, subject: ['file', '/fileId'], label: 'subject', retention: 'file_versions', trigger: { title: 'A file changes', fields: ['/fileId'] } }),
    ev('file.renamed', 'A file was renamed', { p: { fileId: id.file, from: t.str(), to: t.str() }, subject: ['file', '/fileId'], label: 'subject' }),
    ev('file.moved', 'A file moved to another folder', { p: { fileId: id.file, fromFolderId: id.folder, toFolderId: id.folder }, subject: ['file', '/fileId'], label: 'subject' }),
    ev('file.deleted', 'A file moved to Trash', { p: { fileId: id.file, folderId: id.folder }, subject: ['file', '/fileId'], label: 'subject', retention: 'trash' }),
    ev('file.restored', 'A file came back from Trash', { p: { fileId: id.file, folderId: id.folder }, subject: ['file', '/fileId'], label: 'subject' }),
    ev('file.purged', 'A file was deleted for good', { p: { fileId: id.file }, subject: ['file', '/fileId'] }),
    ev('file.starred', 'A person starred a file or took the star off', { p: { fileId: id.file, by: t.str(), starred: t.bool() }, subject: ['file', '/fileId'], vis: 'owner' }),
    ev('file.conflict_kept', 'Two saves collided on a binary file; the newest is current and the other is kept as a labelled version', { p: { fileId: id.file, keptVersionId: id.version, currentVersionId: id.version }, subject: ['file', '/fileId'], label: 'subject' }),
    ev('file.shared_external', 'A link outside the Space was made for a file', { p: { fileId: id.file, linkId, expiresAt: t.opt(t.ts()) }, subject: ['file', '/fileId'], label: 'subject', replay: 'stub' }),
    ev('file.external_revoked', 'An outside link was revoked', { p: { fileId: id.file, linkId }, subject: ['file', '/fileId'] }),
    ev('file.comment_added', 'A comment or pin was added to a file', { p: { fileId: id.file, commentId, pin: t.opt(t.int()), mentions: t.arr(t.str()) }, subject: ['file', '/fileId'], label: 'subject' }),
    ev('file.comment_resolved', 'A comment was resolved', { p: { fileId: id.file, commentId }, subject: ['file', '/fileId'], label: 'subject' }),
    ev('file.markup_saved', 'Freehand markup on an image or page was saved', { p: { fileId: id.file, versionId: t.opt(id.version) }, subject: ['file', '/fileId'], label: 'subject' }),
    ev('folder.created', 'A folder was created', { p: { folderId: id.folder, parentId: t.opt(id.folder), name: t.str() }, subject: ['folder', '/folderId'] }),
    ev('folder.renamed', 'A folder was renamed', { p: { folderId: id.folder, from: t.str(), to: t.str() }, subject: ['folder', '/folderId'] }),
    ev('folder.moved', 'A folder moved', { p: { folderId: id.folder, fromParentId: t.opt(id.folder), toParentId: id.folder }, subject: ['folder', '/folderId'] }),
    ev('folder.deleted', 'A folder and its files moved to Trash', { p: { folderId: id.folder }, subject: ['folder', '/folderId'], retention: 'trash' }),
    ev('folder.restored', 'A folder came back from Trash', { p: { folderId: id.folder }, subject: ['folder', '/folderId'] }),
    ev('folder.settings_changed', 'Review changes, label or branch protection of a folder changed', { p: { folderId: id.folder, fields: t.arr(t.str()) }, subject: ['folder', '/folderId'] }),
    ev('changeset.opened', 'Agent edits were staged in a working copy for review', {
      p: { changesetId: id.changeset, folderId: id.folder, by: t.str(), fileCount: t.int(), threadId: t.opt(id.thread) }, subject: ['folder', '/folderId'], trigger: { title: 'A changeset opens for review', fields: ['/folderId'] },
    }),
    ev('changeset.approved', 'A changeset was approved and committed', {
      p: { changesetId: id.changeset, folderId: id.folder, by: t.str(), fileCount: t.int(), commit: t.opt(t.str()) }, subject: ['folder', '/folderId'], trigger: { title: 'A changeset is approved', fields: ['/folderId'] },
    }),
    ev('changeset.changes_requested', 'The reviewer asked the agent for changes', { p: { changesetId: id.changeset, folderId: id.folder, by: t.str(), comments: t.int() }, subject: ['folder', '/folderId'] }),
    ev('changeset.discarded', 'A changeset was discarded', { p: { changesetId: id.changeset, folderId: id.folder, by: t.str() }, subject: ['folder', '/folderId'] }),
    ev('changeset.updated', 'A change inside a changeset was reverted or the agent added more edits', { p: { changesetId: id.changeset, folderId: id.folder, fileCount: t.int() }, subject: ['folder', '/folderId'] }),
    ev('changeset.edited', 'A person edited a proposed change in place before accepting it', {
      p: { changesetId: id.changeset, folderId: id.folder, path: t.str(), proposedBy: t.str(), by: t.str(), fileCount: t.int() }, subject: ['folder', '/folderId'],
    }),
    ev('changeset.sent_for_review', 'A changeset was opened to an outside agent for review', { p: { changesetId: id.changeset, actorId: t.opt(id.actor) }, subject: ['entity', '/changesetId'], replay: 'stub' }),
    ev('sheet.row_appended', 'A row was added to a sheet', { p: { fileId: id.file, sheet: t.str(), rowId, runId: t.opt(id.run) }, subject: ['file', '/fileId'], label: 'subject', trigger: { title: 'A row is added to a sheet', fields: ['/fileId', '/sheet'] } }),
    ev('sheet.row_updated', 'A row of a sheet changed', { p: { fileId: id.file, sheet: t.str(), rowId, columns: t.arr(t.str()), runId: t.opt(id.run) }, subject: ['file', '/fileId'], label: 'subject', trigger: { title: 'A sheet row changes', fields: ['/fileId', '/sheet'] } }),
    ev('sheet.row_deleted', 'A row was removed from a sheet', { p: { fileId: id.file, sheet: t.str(), rowId, runId: t.opt(id.run) }, subject: ['file', '/fileId'], label: 'subject' }),
  ],
  capabilities: [
    // ---- erase and purge (P-CC_39)
    write('files.versions_purge', 'Remove file versions older than a time except the newest of each file and any named version; files listed in skipFileIds (held ones) are left whole (retention)', { level: 'manage', perm: 'policy.manage', idem: 'key', in: { before: t.ts(), limit: t.opt(t.int({ minimum: 1, maximum: 5000 })), skipFileIds: t.opt(t.arr(id.file)) }, out: purgeOut, emits: ['file_versions.purged'], audit: 'always', risk: 'high' }),
    // ---- tree and listing
    read('files.tree', 'The roots of the file tree: Agents, Projects, People, Channels, shared knowledge, Agent template, Deployments, GitHub, plus Recent, Shared with me, Trash and Knowledge', {
      out: { roots: t.arr(t.obj({ key: t.str(), title: t.str(), kind: t.enm('folder', 'virtual'), folderId: t.opt(id.folder), count: t.int({ minimum: 0 }), subject: t.opt(folderSubject) })) }, tool: 'files', label: 'filter',
    }),
    read('files.list', 'List files and folders in a folder or a section (Personal, Shared with me, Space)', {
      in: { section, folder: t.opt(id.folder), kind: t.opt(fileKind), sort: t.opt(t.enm('name', 'updated', 'size', 'kind')), dir: t.opt(t.enm('asc', 'desc')), ...pageIn },
      out: { files: t.arr(fileRow), folders: t.arr(folderRow), ...pageOut }, tool: 'files', label: 'filter', cli: 'vyre files ls',
    }),
    write('files.star', 'Star a file or take the star off; a star is mine alone', {
      in: { fileId: id.file, starred: t.bool() }, out: { file: fileRow }, on: ['file', '/fileId'], level: 'view', emits: ['file.starred'], tool: 'files', offline: 'queue',
    }),
    read('files.recent', 'Recently opened or changed files', { in: { limit: t.opt(t.int({ minimum: 1, maximum: 200 })) }, out: { files: t.arr(fileRow) }, tool: 'files', label: 'filter' }),
    // DECISION (ruling 24): the sidebar's Shared with me and Knowledge sections get their own lists. Both are views over the same file and folder resources; nothing is stored twice.
    read('files.shared_with_me', 'Files and folders other people shared with the caller, newest share first (the Shared with me section of the tree)', {
      in: { kind: t.opt(fileKind), ...pageIn }, out: { files: t.arr(fileRow), folders: t.arr(folderRow), ...pageOut }, tool: 'files', label: 'filter',
    }),
    read('files.knowledge', 'The Knowledge section of the tree: the knowledge folders and files the caller may read, plus the Memory and Graph entries', {
      in: { ...pageIn },
      out: {
        files: t.arr(fileRow), folders: t.arr(folderRow),
        views: t.arr(t.obj({ key: t.enm('memory', 'graph'), title: t.str(), count: t.int({ minimum: 0 }) })),
        ...pageOut,
      },
      tool: 'files', label: 'filter',
    }),
    read('files.resolve', 'Turn a tree path such as Projects/Probate GTM/plan.md into an id', {
      in: { path: t.str() }, out: { kind: t.enm('file', 'folder'), fileId: t.opt(id.file), folderId: t.opt(id.folder) }, tool: 'files', label: 'check',
    }),
    read('files.get', 'Read the metadata of one file', { in: { fileId: id.file }, out: { file: fileRow }, on: ['file', '/fileId'], tool: 'files', label: 'check' }),
    read('files.read', 'Read the content of a file or one of its versions as text, base64 or a short-lived download address', {
      in: { fileId: id.file, versionId: t.opt(id.version), as: t.opt(t.enm('text', 'base64', 'url')), offset: t.opt(t.int({ minimum: 0 })), length: t.opt(t.int({ minimum: 1 })) },
      out: { text: t.opt(t.str()), base64: t.opt(t.str()), url: t.opt(t.str()), mime: t.str(), size: t.int(), version: t.int(), truncated: t.bool() },
      on: ['file', '/fileId'], tool: 'files', label: 'check', cli: 'vyre files cat', errors: ['validation.too_large'],
    }),
    read('files.viewer_data', 'Everything the one viewer needs for any file type: text projection, pages, preview address, sheet info, export snapshot for Google-native files, and what the caller may do', {
      in: { fileId: id.file, versionId: t.opt(id.version) },
      out: {
        file: fileRow, text: t.opt(t.str()), pages: t.opt(t.int()), previewUrl: t.opt(t.str()),
        sheets: t.opt(t.arr(sheetInfo)), snapshot: t.opt(t.obj({ exportedAt: t.ts(), editVia: t.enm('provider_api', 'open_in_provider') })),
        canEdit: t.bool(), canMark: t.bool(), canComment: t.bool(), pins: t.int({ minimum: 0 }),
      },
      on: ['file', '/fileId'], tool: 'files', label: 'check',
    }),
    read('files.folder.get', 'Read one folder with counts, source mark, git state and Review changes flag', { in: { folderId: id.folder }, out: { folder: folderRow }, on: ['folder', '/folderId'], tool: 'files', label: 'check' }),
    read('files.folder.search', 'Find folders by name for the # picker and the Into picker', {
      in: { q: t.str(), scope: t.opt(t.enm('folders', 'channels', 'all')), limit: t.opt(t.int({ minimum: 1, maximum: 50 })) },
      out: { folders: t.arr(folderRow) }, tool: 'files', label: 'filter',
    }),
    read('files.trash.list', 'Files and folders in Trash (30 days)', {
      in: { ...pageIn }, out: { files: t.arr(fileRow), folders: t.arr(folderRow), ...pageOut }, tool: 'files', label: 'filter',
    }),
    // ---- write
    write('files.upload_url', 'Get a one-time address to upload bytes; the result is a blobId for files.create or files.write', {
      in: { size: t.int({ minimum: 0 }), mime: t.opt(t.str()) }, out: { blobId: id.blob, url: t.str(), expiresAt: t.ts() }, perm: 'files.write', tool: 'files', errors: ['validation.too_large'],
    }),
    create('files.create', 'Create a file in a folder from text, base64 or an uploaded blob', {
      in: { folderId: id.folder, name: t.str(), content: t.opt(content), mime: t.opt(t.str()), kind: t.opt(fileKind) },
      out: { file: fileRow, changesetId: t.opt(id.changeset) }, make: ['folder', '/folderId'], perm: 'files.write',
      emits: ['file.created', 'file.version_added', 'changeset.opened'], tool: 'files', offline: 'queue', cli: 'vyre files put', errors: ['validation.duplicate', 'validation.too_large'],
    }),
    write('files.write', 'Replace the content of a file. In a Review changes folder an agent write lands in a changeset and syncs only on Approve', {
      in: { fileId: id.file, content, baseVersion: t.opt(t.int({ minimum: 1 })), reason: t.opt(t.str()) },
      out: { file: fileRow, versionId: t.opt(id.version), changesetId: t.opt(id.changeset) }, on: ['file', '/fileId'], perm: 'files.write',
      emits: ['file.version_added', 'file.conflict_kept', 'changeset.opened', 'changeset.updated'], tool: 'files', offline: 'queue', errors: ['validation.version_conflict', 'validation.too_large', 'permission.on_hold'],
    }),
    write('files.save', 'Save a guidance file (VYRE.md, AGENT.md, agent.toml, routine prompts): snapshot first, lint, then commit as a version', {
      in: { fileId: id.file, text: t.str(), baseVersion: t.opt(t.int({ minimum: 1 })), reason: t.opt(t.str()), acceptWarnings: t.opt(t.bool()) },
      out: { versionId: id.version, n: t.int(), lint: t.obj(lintOut), added: t.int(), removed: t.int(), changesetId: t.opt(id.changeset) }, on: ['file', '/fileId'], perm: 'files.write',
      emits: ['file.version_added', 'changeset.opened', 'changeset.updated'], tool: 'files', errors: ['validation.version_conflict', 'validation.precondition_failed'],
    }),
    read('files.lint', 'Lint a guidance file: line counts against the limits, Inherits VYRE.md, Override lines, secret scan, agent.toml schema, routine prompt files, handoff names, repeated facts', {
      in: { fileId: id.file, text: t.opt(t.str()) }, out: lintOut, on: ['file', '/fileId'], tool: 'files', cli: 'vyre files lint',
    }),
    write('files.rename', 'Rename a file', { in: { fileId: id.file, name: t.str() }, out: { file: fileRow, changesetId: t.opt(id.changeset) }, on: ['file', '/fileId'], perm: 'files.write', emits: ['file.renamed', 'changeset.opened', 'changeset.updated'], tool: 'files', offline: 'queue', errors: ['validation.duplicate'] }),
    write('files.move', 'Move a file to another folder (grants of the new folder apply, nothing is copied)', {
      in: { fileId: id.file, toFolderId: id.folder, name: t.opt(t.str()) }, out: { file: fileRow, changesetId: t.opt(id.changeset) }, on: ['file', '/fileId'], perm: 'files.write', emits: ['file.moved', 'file.renamed', 'changeset.opened', 'changeset.updated'], tool: 'files', offline: 'queue', errors: ['validation.duplicate'],
    }),
    create('files.copy', 'Copy a file into a folder', {
      in: { fileId: id.file, toFolderId: id.folder, name: t.opt(t.str()) }, out: { file: fileRow }, make: ['file', '/toFolderId'], perm: 'files.write', emits: ['file.created', 'file.version_added'], tool: 'files',
    }),
    write('files.delete', 'Move a file to Trash', {
      in: { fileId: id.file }, out: { deleted: t.bool(), changesetId: t.opt(id.changeset) }, on: ['file', '/fileId'], perm: 'files.delete', gate: { act: 'delete', when: "actor.kind != 'person'" },
      emits: ['file.deleted', 'changeset.opened', 'changeset.updated'], tool: 'files', offline: 'queue', errors: ['permission.on_hold'],
    }),
    write('files.restore', 'Bring a file back from Trash', {
      in: { fileId: id.file, toFolderId: t.opt(id.folder) }, out: { file: fileRow }, on: ['file', '/fileId'], perm: 'files.delete', emits: ['file.restored'], tool: 'files',
    }),
    write('files.purge', 'Delete a file from Trash for good', {
      in: { fileId: id.file }, out: { purged: t.bool() }, on: ['file', '/fileId'], perm: 'files.delete', gate: { act: 'delete', when: "actor.kind != 'person'" },
      audit: 'always', emits: ['file.purged'], tool: 'files', errors: ['permission.on_hold'],
    }),
    write('files.trash.empty', 'Delete everything in Trash that the caller may delete', {
      in: { olderThanDays: t.opt(t.int({ minimum: 0 })) }, out: { purged: t.int() }, perm: 'files.delete', gate: { act: 'delete', when: "actor.kind != 'person'" },
      audit: 'always', emits: ['file.purged'], tool: 'files', risk: 'high',
    }),
    // ---- versions (One History)
    read('files.versions', 'List versions of a file with who and why', { in: { fileId: id.file }, out: { versions: t.arr(versionRow) }, on: ['file', '/fileId'], tool: 'files', label: 'check' }),
    write('files.restore_version', 'Restore a file to an earlier version (a new version is added)', {
      in: { fileId: id.file, versionId: id.version }, out: { file: fileRow, versionId: id.version }, on: ['file', '/fileId'], perm: 'files.write',
      emits: ['file.version_added'], tool: 'files', agent: { planMode: 'blocked' },
    }),
    write('files.name_version', 'Name a version or give its reason', {
      in: { fileId: id.file, versionId: id.version, name: t.opt(t.str()), reason: t.opt(t.str()) }, out: { ok: t.bool() }, on: ['file', '/fileId'], perm: 'files.write', tool: 'files',
    }),
    read('files.diff', 'Compare two versions of a file, or a version with the current one: unified or split hunks, word marks, paragraph diff for docx and md, image blobs for the slider', {
      in: { fileId: id.file, from: t.opt(id.version), to: t.opt(id.version), mode: t.opt(t.enm('unified', 'split', 'words', 'paragraph')) }, out: diffOut,
      on: ['file', '/fileId'], tool: 'files', label: 'check', cli: 'vyre files diff',
    }),
    // ---- sharing
    write('files.share', 'Share a file with a person, group, role or agent at View, Use, Edit or Manage (folders use access.share)', {
      in: { fileId: id.file, subject: subjectRef, level }, out: { ok: t.bool() }, on: ['file', '/fileId'], level: 'manage', audit: 'always', tool: 'files',
    }),
    outward('files.share_external', 'Make a view-only link to a file for someone outside the Space, with an expiry', {
      in: { fileId: id.file, expiresAt: t.opt(t.ts()) }, out: { url: t.str(), linkId, expiresAt: t.opt(t.ts()) }, on: ['file', '/fileId'],
      perm: 'files.share_external', level: 'manage', gate: { act: 'send', when: "actor.kind != 'person'" }, emits: ['file.shared_external'], tool: 'files', errors: ['permission.above_clearance'],
    }),
    read('files.external_links', 'List the outside links of a file', {
      in: { fileId: id.file }, out: { links: t.arr(t.obj({ linkId, createdBy: t.str(), createdAt: t.ts(), expiresAt: t.opt(t.ts()), opens: t.int() })) }, on: ['file', '/fileId'], level: 'manage', tool: 'files',
    }),
    write('files.revoke_external', 'Revoke an outside link', {
      in: { fileId: id.file, linkId }, out: { ok: t.bool() }, on: ['file', '/fileId'], perm: 'files.share_external', level: 'manage', audit: 'always', emits: ['file.external_revoked'], tool: 'files',
    }),
    // ---- comments, pins and markup
    read('files.comments.list', 'List comments and numbered pins on a file; agents read pins to see what a person marked', {
      in: { fileId: id.file, versionId: t.opt(id.version), includeResolved: t.opt(t.bool()) }, out: { comments: t.arr(commentRow) }, on: ['file', '/fileId'], tool: 'files', label: 'check',
    }),
    write('files.comments.add', 'Comment on a file, a range, a cell, a page or an area (area comments are numbered pins); @ people and agents', {
      in: { fileId: id.file, anchor, text: t.str(), versionId: t.opt(id.version), mentions: t.opt(t.arr(t.str())) }, out: { comment: commentRow },
      on: ['file', '/fileId'], idem: 'key', emits: ['file.comment_added'], tool: 'files', offline: 'queue',
    }),
    write('files.comments.resolve', 'Resolve or reopen a comment', {
      in: { commentId, resolved: t.bool() }, out: { comment: commentRow }, emits: ['file.comment_resolved'], tool: 'files',
    }),
    write('files.comments.delete', 'Delete a comment', { in: { commentId }, out: { deleted: t.bool() }, tool: 'files' }),
    read('files.markup.get', 'Read freehand markup (Draw) saved on an image or page', {
      in: { fileId: id.file, page: t.opt(t.int({ minimum: 1 })) }, out: { strokes: t.arr(t.obj({ page: t.opt(t.int()), color: t.str(), width: t.num(), points: t.arr(t.arr(t.num())) })) }, on: ['file', '/fileId'], tool: 'files', label: 'check',
    }),
    write('files.markup.save', 'Save freehand markup on an image or page', {
      in: { fileId: id.file, page: t.opt(t.int({ minimum: 1 })), strokes: t.arr(t.obj({ color: t.str(), width: t.num(), points: t.arr(t.arr(t.num())) })) },
      out: { ok: t.bool() }, on: ['file', '/fileId'], emits: ['file.markup_saved'], tool: 'files',
    }),
    // ---- file-tree folders
    create('files.folder.create', 'Create a folder', {
      in: { parentId: id.folder, name: t.str(), reviewChanges: t.opt(t.bool()), subject: t.opt(t.obj({ kind: t.enm('agent', 'project'), id: t.str({ examples: ['agt_a1b2c3'] }) })) }, out: { folder: folderRow }, make: ['folder', '/parentId'], perm: 'files.write', emits: ['folder.created'], tool: 'files', offline: 'queue', errors: ['validation.duplicate'],
    }),
    write('files.folder.rename', 'Rename a folder', { in: { folderId: id.folder, name: t.str() }, out: { folder: folderRow }, on: ['folder', '/folderId'], perm: 'files.write', emits: ['folder.renamed'], tool: 'files', errors: ['validation.duplicate'] }),
    write('files.folder.move', 'Move a folder under another folder (its sharing follows the new parent)', {
      in: { folderId: id.folder, toParentId: id.folder }, out: { folder: folderRow }, on: ['folder', '/folderId'], perm: 'files.write', emits: ['folder.moved'], tool: 'files', errors: ['validation.precondition_failed'],
    }),
    write('files.folder.delete', 'Move a folder and its files to Trash', {
      in: { folderId: id.folder }, out: { deleted: t.bool() }, on: ['folder', '/folderId'], perm: 'files.delete', gate: { act: 'delete', when: "actor.kind != 'person'" }, emits: ['folder.deleted'], tool: 'files', errors: ['permission.on_hold'],
    }),
    write('files.folder.restore', 'Bring a folder back from Trash', { in: { folderId: id.folder }, out: { folder: folderRow }, on: ['folder', '/folderId'], perm: 'files.delete', emits: ['folder.restored'], tool: 'files' }),
    write('files.folder.settings', 'Change Review changes, sensitivity label or the working-folder flags of a folder', {
      in: { folderId: id.folder, reviewChanges: t.opt(t.bool()), label: t.opt(label) }, out: { folder: folderRow }, on: ['folder', '/folderId'], perm: 'files.write', level: 'manage',
      audit: 'always', emits: ['folder.settings_changed'], tool: 'files',
    }),
    // ---- changesets (Review changes)
    read('changesets.list', 'List changesets, for example the ones waiting for me', {
      in: { folderId: t.opt(id.folder), state: t.opt(t.enm('open', 'changes_requested', 'approved', 'discarded')), mine: t.opt(t.bool()), ...pageIn }, out: { changesets: t.arr(changesetRow), ...pageOut }, tool: 'files', label: 'filter',
    }),
    read('changesets.get', 'Read a changeset with its file list and counts', {
      in: { changesetId: id.changeset },
      out: { changeset: changesetRow, files: t.arr(t.obj({ path: t.str(), status: t.enm('added', 'modified', 'deleted', 'renamed'), added: t.int(), removed: t.int(), conflict: t.bool() })) },
      tool: 'files', label: 'check',
    }),
    read('changesets.diff', 'Hunks of one file inside a changeset, against its recorded base version', {
      in: { changesetId: id.changeset, path: t.str(), mode: t.opt(t.enm('unified', 'split', 'words', 'paragraph')) }, out: diffOut, tool: 'files', label: 'check',
    }),
    write('changesets.approve', 'Approve and commit a changeset: 3-way merge on the recorded base, conflicts go to the reviewer; optionally push', {
      in: { changesetId: id.changeset, message: t.opt(t.str()), push: t.opt(t.bool()) },
      out: { approved: t.bool(), versionIds: t.arr(id.version), commit: t.opt(t.str()), conflicts: t.arr(t.str()) },
      idem: 'key', audit: 'always', gate: { act: 'push_protected', when: 'input.push == true' }, emits: ['changeset.approved', 'file.version_added'], tool: 'files', errors: ['validation.precondition_failed', 'permission.needs_approval'],
    }),
    write('changesets.request_changes', 'Send the reviewer comments back to the agent thread and keep the changeset open', {
      in: { changesetId: id.changeset, note: t.opt(t.str()) }, out: { sent: t.int() }, emits: ['changeset.changes_requested'], tool: 'files',
    }),
    write('changesets.discard', 'Throw the staged changes away', {
      in: { changesetId: id.changeset }, out: { discarded: t.bool() }, audit: 'always', emits: ['changeset.discarded'], tool: 'files',
    }),
    write('changesets.revert_change', 'Revert a single change (one hunk or one file) inside a changeset', {
      in: { changesetId: id.changeset, path: t.str(), hunkId: t.opt(t.str()) }, out: { fileCount: t.int() }, emits: ['changeset.updated'], tool: 'files',
    }),
    write('changesets.edit', 'Edit a proposed change in place before accepting it: replace a run of lines in one staged file. The proposer stays recorded and so does the editor; Approve still goes through its own Gate', {
      in: { changesetId: id.changeset, path: t.str(), startLine: t.int({ minimum: 1 }), removeLines: t.int({ minimum: 0 }), lines: t.arr(t.str()) },
      out: { fileCount: t.int(), added: t.int(), removed: t.int(), proposedBy: t.str(), editedBy: t.str() },
      audit: 'always', emits: ['changeset.edited'], tool: 'files', errors: ['validation.not_found', 'validation.precondition_failed', 'permission.no_grant'],
    }),
    write('changesets.review_externally', 'Open a changeset to an outside agent (Claude Code, Codex) with a read and comment token; returns a one-time review link (the token is in the link, shown once, never logged)', {
      in: { changesetId: id.changeset, actorId: t.opt(id.actor) }, out: { actorId: id.actor, reviewUrl: t.str({ pattern: '^https?://', examples: ['https://northwind.example.com/review/cs_example?token=otk_example'] }), expiresAt: t.ts() }, emits: ['changeset.sent_for_review'], audit: 'always', tool: 'files',
    }),
    read('changesets.comments.list', 'List inline comments on a changeset', { in: { changesetId: id.changeset }, out: { comments: t.arr(commentRow) }, tool: 'files', label: 'check' }),
    write('changesets.comments.add', 'Add an inline comment to a changeset with @ people and agents (an @ agent answers in the thread)', {
      in: { changesetId: id.changeset, anchor, text: t.str(), mentions: t.opt(t.arr(t.str())) }, out: { comment: commentRow }, idem: 'key', emits: ['file.comment_added'], tool: 'files',
    }),
    // ---- spreadsheets (CSV, XLSX, Google Sheets, Excel in SharePoint) as table files
    read('sheets.info', 'List the sheets of a table file with row counts, columns and the key column', {
      in: { fileId: id.file }, out: { sheets: t.arr(sheetInfo) }, on: ['file', '/fileId'], tool: 'files', label: 'check',
    }),
    read('sheets.read_rows', 'Read rows from a sheet with a filter over column values', {
      in: { fileId: id.file, sheet: t.opt(t.str()), where: t.opt(t.json()), columns: t.opt(t.arr(t.str())), ...pageIn },
      out: { rows: t.arr(t.obj({ rowId, values: t.rec() })), ...pageOut }, on: ['file', '/fileId'], tool: 'files', label: 'check',
    }),
    write('sheets.append_rows', 'Append rows to a sheet; each write is a version labelled with the automation and run, so parallel runs never overwrite', {
      in: { fileId: id.file, sheet: t.opt(t.str()), rows: t.arr(t.rec(), { minItems: 1 }), label: t.opt(t.str()) },
      out: { appended: t.int(), rowIds: t.arr(rowId), versionId: t.opt(id.version) }, on: ['file', '/fileId'], perm: 'files.write', idem: 'key',
      emits: ['sheet.row_appended', 'file.version_added'], tool: 'files', errors: ['validation.too_large'],
    }),
    write('sheets.update_row', 'Update one row by row id or by a key column value', {
      in: { fileId: id.file, sheet: t.opt(t.str()), rowId: t.opt(rowId), key: t.opt(t.obj({ column: t.str(), value: t.json() })), values: t.rec(), label: t.opt(t.str()) },
      out: { rowId, versionId: t.opt(id.version) }, on: ['file', '/fileId'], perm: 'files.write', emits: ['sheet.row_updated', 'file.version_added'], tool: 'files', errors: ['validation.precondition_failed'],
    }),
    write('sheets.upsert_row', 'Update the row that matches the given columns, or append a new one', {
      in: { fileId: id.file, sheet: t.opt(t.str()), match: t.arr(t.str(), { minItems: 1 }), values: t.rec(), label: t.opt(t.str()) },
      out: { rowId, created: t.bool(), versionId: t.opt(id.version) }, on: ['file', '/fileId'], perm: 'files.write', emits: ['sheet.row_appended', 'sheet.row_updated', 'file.version_added'], tool: 'files',
    }),
    write('sheets.delete_row', 'Remove a row from a sheet', {
      in: { fileId: id.file, sheet: t.opt(t.str()), rowId, label: t.opt(t.str()) }, out: { deleted: t.bool() }, on: ['file', '/fileId'], perm: 'files.write',
      emits: ['sheet.row_deleted', 'file.version_added'], tool: 'files',
    }),
    create('sheets.create', 'Create a CSV or XLSX table file with a header row', {
      in: { folderId: id.folder, name: t.str(), format: t.enm('csv', 'xlsx'), columns: t.arr(t.str(), { minItems: 1 }), sheet: t.opt(t.str()) },
      out: { file: fileRow }, make: ['file', '/folderId'], perm: 'files.write', emits: ['file.created', 'file.version_added'], tool: 'files',
    }),
    write('sheets.add_sheet', 'Add a sheet (tab) to a workbook', {
      in: { fileId: id.file, sheet: t.str(), columns: t.arr(t.str()) }, out: { ok: t.bool() }, on: ['file', '/fileId'], perm: 'files.write', emits: ['file.version_added'], tool: 'files', errors: ['validation.duplicate'],
    }),
    read('files.health', 'Blob store and tree health: free space, orphaned blobs, index lag', {
      out: { state: t.enm('healthy', 'degraded', 'down'), detail: t.opt(t.str()), latencyMs: t.opt(t.int()) },
    }),
  ],
  health: [
    health('files.store', 'File store', 'files.health', 'Free disk space on the server or restart the files service in the Console.'),
  ],
  screens: [
    screen('files.tree', 'files', 'ui:FilesTree', {
      slot: 'sidebar', q: { tree: ['files.tree'], trash: ['files.trash.list', {}, false] },
      a: { createFolder: ['files.folder.create', { parentId: '/state/folder', name: '/draft/name' }], move: ['files.move', { fileId: '/state/fileId', toFolderId: '/state/toFolder' }] },
      empty: 'No files yet',
    }),
    screen('files.list', 'files', 'ui:FilesList', {
      q: { items: ['files.list', { section: '/state/section', folder: '/state/folder', kind: '/state/kind' }] },
      a: {
        rename: ['files.rename', { fileId: '/state/fileId', name: '/draft/name' }],
        move: ['files.move', { fileId: '/state/fileId', toFolderId: '/state/toFolder' }],
        remove: ['files.delete', { fileId: '/state/fileId' }],
        newFolder: ['files.folder.create', { parentId: '/state/folder', name: '/draft/name' }],
        share: ['files.share', { fileId: '/state/fileId', subject: '/draft/subject', level: '/draft/level' }],
      },
      empty: 'This folder is empty', primary: 'Upload a file',
    }),
    screen('files.viewer', 'files', 'ui:FilesViewer', {
      q: { viewer: ['files.viewer_data', { fileId: '/state/fileId', versionId: '/state/versionId' }], comments: ['files.comments.list', { fileId: '/state/fileId' }], markup: ['files.markup.get', { fileId: '/state/fileId', page: '/state/page' }] },
      a: {
        write: ['files.write', { fileId: '/state/fileId', content: '/draft/content', baseVersion: '/state/version' }],
        comment: ['files.comments.add', { fileId: '/state/fileId', anchor: '/draft/anchor', text: '/draft/text' }],
        resolve: ['files.comments.resolve', { commentId: '/state/commentId', resolved: '/draft/resolved' }],
        markup: ['files.markup.save', { fileId: '/state/fileId', page: '/state/page', strokes: '/draft/strokes' }],
        shareExternal: ['files.share_external', { fileId: '/state/fileId', expiresAt: '/draft/expiresAt' }],
      },
      empty: 'Pick a file to see it here',
    }),
    screen('files.history', 'files', 'ui:HistoryTab', {
      slot: 'side', q: { versions: ['files.versions', { fileId: '/state/fileId' }] },
      a: { restore: ['files.restore_version', { fileId: '/state/fileId', versionId: '/state/versionId' }, 'Restore this version?'], name: ['files.name_version', { fileId: '/state/fileId', versionId: '/state/versionId', name: '/draft/name' }] },
      empty: 'No earlier versions',
    }),
    screen('files.diff', 'files', 'ui:DiffTab', {
      slot: 'tab', q: { fileDiff: ['files.diff', { fileId: '/state/fileId', from: '/state/from', to: '/state/to', mode: '/state/mode' }], changesetDiff: ['changesets.diff', { changesetId: '/state/changesetId', path: '/state/path', mode: '/state/mode' }], comments: ['changesets.comments.list', { changesetId: '/state/changesetId' }] },
      a: {
        revert: ['changesets.revert_change', { changesetId: '/state/changesetId', path: '/state/path', hunkId: '/state/hunkId' }],
        comment: ['changesets.comments.add', { changesetId: '/state/changesetId', anchor: '/draft/anchor', text: '/draft/text', mentions: '/draft/mentions' }],
        approve: ['changesets.approve', { changesetId: '/state/changesetId', message: '/draft/message' }],
      },
      empty: 'No differences',
    }),
    screen('files.changeset-header', 'files', 'ui:ChangesetHeader', {
      slot: 'side', q: { changeset: ['changesets.get', { changesetId: '/state/changesetId' }] },
      a: {
        approve: ['changesets.approve', { changesetId: '/state/changesetId', message: '/draft/message', push: '/draft/push' }],
        requestChanges: ['changesets.request_changes', { changesetId: '/state/changesetId', note: '/draft/note' }],
        discard: ['changesets.discard', { changesetId: '/state/changesetId' }, 'Discard these changes?'],
        outsideReview: ['changesets.review_externally', { changesetId: '/state/changesetId', actorId: '/draft/actorId' }],
      },
      empty: 'Nothing to review',
    }),
    screen('files.lint-bar', 'files', 'ui:LintBar', {
      slot: 'side', q: { lint: ['files.lint', { fileId: '/state/fileId', text: '/draft/text' }, false] },
      a: { save: ['files.save', { fileId: '/state/fileId', text: '/draft/text', baseVersion: '/state/version', reason: '/draft/reason' }] },
    }),
    screen('files.trash', 'files', 'ui:FilesTrash', {
      q: { trash: ['files.trash.list'] },
      a: { restore: ['files.restore', { fileId: '/state/fileId' }], restoreFolder: ['files.folder.restore', { folderId: '/state/folderId' }], purge: ['files.purge', { fileId: '/state/fileId' }, 'Delete this file for good?'], empty: ['files.trash.empty', {}, 'Empty Trash?'] },
      empty: 'Trash is empty',
    }),
  ],
});
