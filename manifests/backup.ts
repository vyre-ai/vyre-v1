// backup (lane L7b): encrypted backups to S3 or a drive, restore with tombstone replay, verification (spec 5 Backups and export, 2.26).
import { create, defineManifest, ev, health, outward, read, setting, t, write } from '../packages/contracts/src/index.ts';
import { id, pageIn, pageOut } from './_common.ts';

const backupId = t.id('bkp');
const target = t.obj({ kind: t.enm('s3', 'drive', 'local'), bucket: t.opt(t.str()), region: t.opt(t.str()), path: t.opt(t.str()), vaultName: t.opt(t.str({ description: 'Vault item that holds the credentials' })) });
const row = t.obj({ backupId, at: t.ts(), sizeBytes: t.int(), seq: t.int(), kind: t.enm('scheduled', 'manual', 'pre_update'), verified: t.bool(), target: t.str() });

export default defineManifest({
  id: 'backup',
  title: 'Backups',
  owner: 'L7b',
  events: [
    ev('backup.completed', 'A backup finished and was written to the target', { p: { backupId, seq: t.int(), sizeBytes: t.int() }, subject: ['entity', '/backupId'], replay: 'stub' }),
    ev('backup.failed', 'A backup failed', { p: { backupId: t.opt(backupId), reason: t.str() }, subject: ['entity', '/reason'], notify: 'health.degraded' }),
    ev('backup.verified', 'A backup restored cleanly into a scratch directory', { p: { backupId } , subject: ['entity', '/backupId'] }),
    ev('backup.restored', 'A backup was restored; tombstones were replayed before the Space opened', { p: { backupId, tombstonesReplayed: t.int() }, subject: ['entity', '/backupId'], replay: 'stub' }),
    ev('backup.config_changed', 'Backup target or schedule changed', { p: { target: t.str(), schedule: t.str() }, subject: ['entity', '/target'] }),
  ],
  capabilities: [
    read('backup.config_get', 'Read the backup target, schedule and encryption status', { out: { target: t.opt(target), schedule: t.str(), encrypted: t.bool(), lastBackupAt: t.opt(t.ts()) }, perm: 'server.backups', tool: 'engineer' }),
    write('backup.config_set', 'Set the backup target and schedule (one switch)', { in: { target, schedule: t.str({ examples: ['0 3 * * *'] }), enabled: t.bool() }, out: { ok: t.bool() }, perm: 'server.backups', level: 'manage', risk: 'high', audit: 'always', emits: ['backup.config_changed'], tool: 'engineer' }),
    read('backup.list', 'List backups with size, sequence number and verification state', { in: pageIn, out: { backups: t.arr(row), ...pageOut }, perm: 'server.backups', tool: 'engineer' }),
    outward('backup.run', 'Run a backup now', { in: {}, out: { backupId }, perm: 'server.backups', level: 'manage', run: { kind: 'backup', stoppable: true }, emits: ['backup.completed', 'backup.failed'], gate: { act: 'none', reason: 'destination is chosen by an admin in the backup config; nothing is shared with a person' }, tool: 'engineer', team: true }),
    read('backup.restore_preview', 'Show what a restore would change: sequence range, tombstones to replay, members affected', { in: { backupId }, out: { fromSeq: t.int(), toSeq: t.int(), tombstones: t.int(), downtimeSeconds: t.int() }, perm: 'server.backups', tool: 'engineer' }),
    write('backup.restore', 'Restore from a backup (takes a fresh backup first, replays tombstones before opening for traffic)', { in: { backupId, confirm: t.lit(true) }, out: { runId: id.run }, perm: 'server.backups', level: 'manage', risk: 'high', audit: 'always', run: { kind: 'restore', stoppable: false }, emits: ['backup.restored'], team: true, gate: { act: 'delete', when: 'true' } }),
    write('backup.verify', 'Restore a backup into a scratch directory and check the hash chain', { in: { backupId }, out: { ok: t.bool(), checkedEvents: t.int() }, perm: 'server.backups', emits: ['backup.verified'], tool: 'engineer' }),
    write('backup.delete', 'Delete a backup file from the target', { in: { backupId }, out: { deleted: t.bool() }, perm: 'server.backups', level: 'manage', risk: 'high', audit: 'always', gate: { act: 'delete' }, tool: 'engineer' }),
    create('backup.export_start', 'Start the owner full export as a zip (never secret values, never other people private chats or personal memory)', { in: {}, out: { runId: id.run }, perm: 'server.backups', level: 'manage', risk: 'high', audit: 'always', run: { kind: 'export', stoppable: true } }),
    read('backup.health', 'Backup health probe: age of the last good backup', { out: { state: t.enm('healthy', 'degraded', 'down'), detail: t.opt(t.str()), latencyMs: t.opt(t.int()), ageHours: t.opt(t.int()) } }),
  ],
  health: [health('backups.recent', 'Recent backup', 'backup.health', 'Open Console, Infrastructure, Backups and run a backup now.', { intervalSec: 900, states: { degradedWhen: 'ageHours > 30', downWhen: 'ageHours > 72' } })],
  settings: [setting('backup.encrypt', 'space', 'backups', 'Encrypt backups under the Space key', t.bool(), true)],
});
