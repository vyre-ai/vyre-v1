// mounts (lane L4): Google Shared Drives and folders, SharePoint libraries and OneDrive folders, folders on a person's computer, and GitHub repositories as normal folders (spec 2.16 Mounts, architecture 7.5 and 8.5).
// A mount is a real directory on the host synced by the mount engine; access never widens (the provider decides what a person opens, Vyre grants narrow it).
// DECISION: local folder mounts default to a server copy (private to the person, shareable); live_only keeps no server copy and is read only while the computer is online (provisional b17).
// DECISION: GitHub mounts are clones made through the git module with the installation token; mounts.add hands the clone to git and registers the mount.
// DECISION: mounts.browse is a read although it calls the provider, because it only lists names the person can already open there.
import { create, defineManifest, ev, health, read, screen, t, write } from '../packages/contracts/src/index.ts';
import { id, pageIn, pageOut, runStarted } from './_common.ts';

const kind = t.enm('google_drive', 'sharepoint', 'onedrive', 'local', 'github');
const mode = t.enm('server_copy', 'live_only');

const source = t.obj({
  kind, connectionId: t.opt(id.connection), ref: t.opt(t.str({ description: 'Drive or folder id, library path, or owner/repo' })),
  path: t.opt(t.str()), branch: t.opt(t.str()), deviceId: t.opt(id.device), localPath: t.opt(t.str({ description: 'Path on the device; only the device sees it' })),
});

const mountRow = t.obj({
  mountId: id.mount, folderId: id.folder, kind, provider: t.str({ examples: ['Google Drive'] }), ref: t.opt(t.str()), name: t.str(),
  state: t.enm('idle', 'syncing', 'paused', 'failing', 'device_offline'), mode, reviewChanges: t.bool(),
  lagSeconds: t.opt(t.int({ minimum: 0 })), lastSyncAt: t.opt(t.ts()), pendingChanges: t.int({ minimum: 0 }), conflicts: t.int({ minimum: 0 }),
  fromDevice: t.opt(t.str({ examples: ["Irfad's MacBook"] })), error: t.opt(t.str()),
});

const browseItem = t.obj({ ref: t.str(), name: t.str(), isFolder: t.bool(), path: t.opt(t.str()), shared: t.opt(t.bool()) });

export default defineManifest({
  id: 'mounts',
  title: 'Mounts',
  owner: 'L4',
  events: [
    ev('folder.mounted', 'A drive, library, local folder or repository was mounted as a folder', {
      p: { mountId: id.mount, folderId: id.folder, kind, by: t.str() }, subject: ['folder', '/folderId'], trigger: { title: 'A folder is mounted', fields: ['/kind'] },
    }),
    ev('mount.updated', 'Mount options changed', { p: { mountId: id.mount, folderId: id.folder, fields: t.arr(t.str()) }, subject: ['folder', '/folderId'] }),
    ev('mount.removed', 'A mount was removed', { p: { mountId: id.mount, folderId: id.folder, keptCopy: t.bool() }, subject: ['folder', '/folderId'] }),
    ev('mount.synced', 'A mount sync pass finished', { p: { mountId: id.mount, folderId: id.folder, pulled: t.int(), pushed: t.int(), conflicts: t.int(), ms: t.int() }, subject: ['folder', '/folderId'], replay: 'stub' }),
    ev('mount.failed', 'A mount sync failed and needs attention', { p: { mountId: id.mount, folderId: id.folder, error: t.str() }, subject: ['folder', '/folderId'], notify: 'sync.attention' }),
    ev('mount.paused', 'A mount was paused', { p: { mountId: id.mount, folderId: id.folder }, subject: ['folder', '/folderId'] }),
    ev('mount.resumed', 'A paused mount resumed', { p: { mountId: id.mount, folderId: id.folder }, subject: ['folder', '/folderId'] }),
  ],
  capabilities: [
    read('mounts.browse', 'Browse a drive, library or repository search to pick what to mount', {
      in: { kind, connectionId: t.opt(id.connection), parent: t.opt(t.str()), q: t.opt(t.str()), ...pageIn }, out: { items: t.arr(browseItem), ...pageOut },
      tool: 'files', errors: ['provider.auth_failed', 'provider.unavailable'],
    }),
    read('mounts.list', 'List mounts the caller can see', { in: { kind: t.opt(kind), ...pageIn }, out: { mounts: t.arr(mountRow), ...pageOut }, tool: 'files', label: 'filter' }),
    read('mounts.get', 'Read one mount: state, lag, pending changes and conflicts (the sync line of a folder)', { in: { mountId: id.mount }, out: { mount: mountRow }, tool: 'files', label: 'check' }),
    create('mounts.add', 'Mount a Google or SharePoint folder, a folder on your computer or a GitHub repository into a folder of the tree; the first sync is a Run', {
      in: { into: id.folder, source, name: t.opt(t.str()), mode: t.opt(mode), reviewChanges: t.opt(t.bool()) },
      out: { mountId: id.mount, folderId: id.folder, ...runStarted }, make: ['folder', '/into'], perm: 'files.write', run: { kind: 'mount_sync', stoppable: true },
      emits: ['folder.mounted', 'mount.synced', 'mount.failed'], audit: 'always', tool: 'files', cli: 'vyre mounts add', errors: ['provider.auth_failed', 'provider.unavailable', 'validation.duplicate'],
    }),
    write('mounts.update', 'Change mount options: server copy or live only, Review changes, read-only pull', {
      in: { mountId: id.mount, mode: t.opt(mode), reviewChanges: t.opt(t.bool()), pullOnly: t.opt(t.bool()), name: t.opt(t.str()) }, out: { mount: mountRow },
      perm: 'files.write', level: 'manage', emits: ['mount.updated'], tool: 'files',
    }),
    write('mounts.remove', 'Remove a mount; keep the files as a plain folder or delete the copy', {
      in: { mountId: id.mount, keepCopy: t.opt(t.bool()) }, out: { removed: t.bool() }, perm: 'files.write', level: 'manage', audit: 'always',
      gate: { act: 'delete', when: "actor.kind != 'person'" }, emits: ['mount.removed'], tool: 'files', cli: 'vyre mounts remove',
    }),
    write('mounts.sync_now', 'Sync a mount now (a Run); the provider change feed and the folder both move', {
      in: { mountId: id.mount }, out: runStarted, perm: null, run: { kind: 'mount_sync', stoppable: true }, idem: 'key',
      emits: ['mount.synced', 'mount.failed', 'file.version_added', 'file.conflict_kept'], tool: 'files', offline: 'online', cli: 'vyre mounts sync',
    }),
    write('mounts.pause', 'Pause syncing of a mount', { in: { mountId: id.mount }, out: { ok: t.bool() }, perm: 'files.write', level: 'manage', emits: ['mount.paused'], tool: 'files' }),
    write('mounts.resume', 'Resume a paused mount', { in: { mountId: id.mount }, out: { ok: t.bool() }, perm: 'files.write', level: 'manage', emits: ['mount.resumed'], tool: 'files' }),
    write('mounts.local_report', 'A device reports changes in a mounted local folder and uploads their blobs (system)', {
      in: { mountId: id.mount, deviceId: id.device, changes: t.arr(t.obj({ path: t.str(), op: t.enm('add', 'modify', 'delete', 'rename'), blobId: t.opt(id.blob), mtime: t.ts(), from: t.opt(t.str()) })) },
      out: { applied: t.int(), conflicts: t.int() }, level: 'use', idem: 'key', emits: ['file.version_added', 'file.conflict_kept', 'mount.synced'], offline: 'online',
    }),
    read('mounts.lag', 'Worst mount lag in seconds and the mounts that are failing', {
      out: { state: t.enm('healthy', 'degraded', 'down'), detail: t.opt(t.str()), latencyMs: t.opt(t.int()), worstLagSeconds: t.int({ minimum: 0 }), failing: t.arr(id.mount) },
    }),
  ],
  health: [
    health('mounts.lag', 'Mount lag', 'mounts.lag', 'Reconnect the Google or Microsoft account, or turn on the computer that holds the local folder.', { pauses: ['sync'] }),
  ],
  screens: [
    screen('files.mount-sheet', 'files', 'ui:MountSheet', {
      slot: 'sheet',
      q: { items: ['mounts.browse', { kind: '/draft/kind', connectionId: '/draft/connectionId', parent: '/state/parent', q: '/draft/q' }, false] },
      a: { add: ['mounts.add', { into: '/state/into', source: '/draft/source', name: '/draft/name', mode: '/draft/mode', reviewChanges: '/draft/reviewChanges' }] },
      needs: ['files.write'], primary: 'Mount',
    }),
    screen('files.sync-line', 'files', 'ui:SyncLine', {
      slot: 'side',
      q: { mount: ['mounts.get', { mountId: '/state/mountId' }] },
      a: {
        syncNow: ['mounts.sync_now', { mountId: '/state/mountId' }],
        pause: ['mounts.pause', { mountId: '/state/mountId' }],
        resume: ['mounts.resume', { mountId: '/state/mountId' }],
        update: ['mounts.update', { mountId: '/state/mountId', mode: '/draft/mode', reviewChanges: '/draft/reviewChanges' }],
        remove: ['mounts.remove', { mountId: '/state/mountId', keepCopy: '/draft/keepCopy' }, 'Remove this mount?'],
      },
    }),
  ],
});
