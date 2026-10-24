// health (lane L7b): the health runner, doctor, services, support bundle (spec 4.18, ARCH 3.5 health, 7.10, 7.13).
import { create, defineManifest, ev, health, read, t, write } from '../packages/contracts/src/index.ts';
import { id } from './_common.ts';

const state = t.enm('healthy', 'degraded', 'down');
const probe = { state, detail: t.opt(t.str()), latencyMs: t.opt(t.int()) };
const checkRow = t.obj({ key: t.str(), title: t.str(), state, detail: t.opt(t.str()), checkedAt: t.ts(), module: t.str(), next: t.str() });

export default defineManifest({
  id: 'health',
  title: 'Health and diagnostics',
  owner: 'L7b',
  events: [
    ev('health.changed', 'A health check changed state', { p: { key: t.str(), from: state, to: state, detail: t.opt(t.str()) }, subject: ['entity', '/key'], notify: 'health.degraded', trigger: { title: 'A health check changes state', fields: ['/key', '/to'] } }),
    ev('health.paused', 'An unhealthy dependency paused automations, sync, sends or campaigns', { p: { key: t.str(), paused: t.arr(t.enm('automations', 'sync', 'sends', 'campaigns')), reason: t.str() }, subject: ['entity', '/key'] }),
    ev('health.resumed', 'A paused area resumed after its dependency recovered', { p: { key: t.str() }, subject: ['entity', '/key'] }),
    ev('service.restarted', 'A server service was restarted', { p: { service: t.str() }, subject: ['entity', '/service'] }),
    ev('support_bundle.created', 'A support bundle was made (ids and metadata only, no content)', { p: { bundleId: t.id('bnd'), sizeBytes: t.int() }, subject: ['entity', '/bundleId'] }),
  ],
  capabilities: [
    read('health.status', 'Latest state of every health check, grouped by module', { out: { overall: state, checks: t.arr(checkRow) }, perm: 'console.access', tool: 'engineer' }),
    write('health.run', 'Run one health check or all of them now', { in: { key: t.opt(t.str()) }, out: { checks: t.arr(checkRow) }, perm: 'console.access', emits: ['health.changed', 'health.paused', 'health.resumed'], tool: 'engineer' }),
    read('health.history', 'Samples of a health check over time', { in: { key: t.str(), sinceMs: t.opt(t.ts()) }, out: { samples: t.arr(t.obj({ at: t.ts(), state, latencyMs: t.opt(t.int()), detail: t.opt(t.str()) })) }, perm: 'console.access', tool: 'engineer' }),
    read('health.doctor', 'Doctor results: each check with a plain next step; same output as `vyre-server doctor`', { out: { ok: t.bool(), findings: t.arr(t.obj({ key: t.str(), state, next: t.str() })) }, perm: 'console.access', tool: 'engineer', cli: 'vyre doctor' }),
    read('health.paused_reasons', 'What is paused and why (shown on the paused automation, sync or campaign)', { out: { paused: t.arr(t.obj({ area: t.enm('automations', 'sync', 'sends', 'campaigns'), key: t.str(), reason: t.str() })) } }),
    read('health.services', 'Server services with state, uptime and restart count', { out: { services: t.arr(t.obj({ name: t.str(), state, uptimeSeconds: t.int(), restarts: t.int() })) }, perm: 'server.services', tool: 'engineer' }),
    write('health.service_restart', 'Restart a server service', { in: { service: t.str() }, out: { state }, perm: 'server.services', level: 'manage', risk: 'high', audit: 'always', emits: ['service.restarted'], gate: { act: 'none', reason: 'admin action on the Space own server, audited' }, tool: 'engineer' }),
    create('health.support_bundle', 'Make a support bundle: versions, recent traces, health, logs without content (works with the gateway down through the CLI)', { in: { traceIds: t.opt(t.arr(id.trace)) }, out: { bundleId: t.id('bnd'), fileId: id.file }, perm: 'server.logs', emits: ['support_bundle.created'], tool: 'engineer', cli: 'vyre support-bundle' }),
    read('health.disk_encrypted', 'Probe: the data directory sits on an encrypted volume (FileVault, LUKS, dm-crypt)', { out: probe }),
    read('health.events_db', 'Probe: events.db opens, hash chain head verifies, writer queue is short', { out: probe }),
    read('health.index_db', 'Probe: search index lag behind the log head', { out: probe }),
    read('health.scheduler', 'Probe: the scheduler ticked in the last minute', { out: probe }),
    read('health.docker', 'Probe: Docker (or Colima) answers on its socket', { out: probe }),
    read('health.caddy', 'Probe: Caddy admin API answers and routes are loaded', { out: probe }),
    read('health.disk_space', 'Probe: free disk space on the data directory', { out: { ...probe, freeBytes: t.opt(t.int()) } }),
    read('health.time_skew', 'Probe: clock skew against the relay (HLC clamps at 5 minutes)', { out: { ...probe, skewMs: t.opt(t.int()) } }),
  ],
  health: [
    health('host.disk_encrypted', 'Data directory is on an encrypted volume', 'health.disk_encrypted', 'Enable FileVault or LUKS for the data directory, then run vyre-server doctor.', { states: { downWhen: "state == 'down'" } }),
    health('kernel.events_db', 'Event log healthy', 'health.events_db', 'Run vyre-server doctor and restore from the last backup if the chain fails.', { pauses: ['automations', 'sync'] }),
    health('search.index', 'Search index caught up', 'health.index_db', 'Rebuild the index with vyre rebuild --projection search.fts.', { dependsOn: ['kernel.events_db'] }),
    health('scheduler.tick', 'Scheduler running', 'health.scheduler', 'Restart the scheduler service in Console, Infrastructure, Services.', { pauses: ['automations', 'campaigns'] }),
    health('host.docker', 'Docker running', 'health.docker', 'Start Docker or Colima; sites and agent computers need it.'),
    health('host.caddy', 'Caddy running', 'health.caddy', 'Restart Caddy in Console, Infrastructure, Services.', { dependsOn: ['host.docker'] }),
    health('host.disk_space', 'Disk space', 'health.disk_space', 'Free disk space or extend the volume.', { states: { degradedWhen: 'freeBytes < 5000000000', downWhen: 'freeBytes < 500000000' } }),
    health('host.time_skew', 'Clock in sync', 'health.time_skew', 'Fix the server clock (NTP).', { states: { degradedWhen: 'skewMs > 60000', downWhen: 'skewMs > 300000' } }),
  ],
});
