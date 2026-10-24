// updates (lane L7b): server channel, backup-first update, roll back, app compatibility (spec 3.10, ARCH 3.6, 7.10).
import { defineManifest, ev, health, read, t, write } from '../packages/contracts/src/index.ts';
import { id } from './_common.ts';

const version = t.str({ pattern: '^\\d+\\.\\d+\\.\\d+', examples: ['1.0.0'] });
const channel = t.enm('stable', 'beta', 'nightly');

export default defineManifest({
  id: 'updates',
  title: 'Server updates',
  owner: 'L7b',
  events: [
    ev('update.started', 'A server update began (backup taken first)', { p: { from: version, to: version }, subject: ['entity', '/to'] }),
    ev('update.completed', 'A server update finished', { p: { from: version, to: version }, subject: ['entity', '/to'] }),
    ev('update.failed', 'A server update failed and the server rolled back', { p: { to: version, reason: t.str() }, subject: ['entity', '/to'], notify: 'health.degraded' }),
    ev('update.rolled_back', 'The server rolled back to a previous version', { p: { from: version, to: version }, subject: ['entity', '/to'] }),
  ],
  capabilities: [
    read('updates.status', 'Current version, channel, available version and last update result', { out: { current: version, channel, available: t.opt(version), lastResult: t.opt(t.enm('ok', 'failed', 'rolled_back')) }, perm: 'server.update', tool: 'engineer' }),
    write('updates.channel_set', 'Choose the update channel', { in: { channel }, out: { ok: t.bool() }, perm: 'server.update', level: 'manage', audit: 'always', tool: 'engineer' }),
    read('updates.check', 'Check for a newer server version and the apps it supports', { out: { available: t.opt(version), notes: t.opt(t.str()), supportedApps: t.arr(t.str()) }, perm: 'server.update', tool: 'engineer' }),
    write('updates.apply', 'Update the server: backup first, apply, health check, roll back on failure', { in: { to: t.opt(version) }, out: { runId: id.run }, perm: 'server.update', level: 'manage', risk: 'high', audit: 'always', run: { kind: 'update', stoppable: false }, emits: ['update.started', 'update.completed', 'update.failed'], team: true, tool: 'engineer' }),
    write('updates.rollback', 'Roll back to the previous server version', { in: { to: version }, out: { runId: id.run }, perm: 'server.update', level: 'manage', risk: 'high', audit: 'always', run: { kind: 'update', stoppable: false }, emits: ['update.rolled_back'], team: true, tool: 'engineer' }),
    read('updates.history', 'List past updates with result and duration', { out: { updates: t.arr(t.obj({ from: version, to: version, at: t.ts(), result: t.enm('ok', 'failed', 'rolled_back'), seconds: t.int() })) }, perm: 'server.update', tool: 'engineer' }),
    read('updates.app_compat', 'Which app versions this server supports (within 2 minor versions); older apps read-only', { out: { min: version, max: version, updateRequiredBelow: version } }),
    read('updates.health', 'Update health probe: pending security update or failed last update', { out: { state: t.enm('healthy', 'degraded', 'down'), detail: t.opt(t.str()), latencyMs: t.opt(t.int()) } }),
  ],
  health: [health('updates.current', 'Server is on a supported version', 'updates.health', 'Open Console, Infrastructure, Server, Updates.')],
});
