// console-views (lane L7b): aggregate reads behind the Console Overview, Usage and Speed pages (CONSOLE-SPEC, ARCH 7.10, 9).
import { defineManifest, read, screen, t } from '../packages/contracts/src/index.ts';
import { id } from './_common.ts';

const state = t.enm('healthy', 'degraded', 'down');
const attention = t.obj({ kind: t.enm('failing_check', 'expiring_certificate', 'failed_run', 'stuck_update', 'limit_hit', 'access_review_due'), title: t.str(), ref: t.opt(t.str()), since: t.ts(), next: t.str() });
const usageRow = t.obj({ key: t.str(), name: t.str(), turns: t.int(), tokensIn: t.int(), tokensOut: t.int(), costMicros: t.int() });

export default defineManifest({
  id: 'console-views',
  title: 'Console views',
  owner: 'L7b',
  capabilities: [
    read('console.overview', 'Overview: health, attention items, recent admin activity, usage, server CPU, memory and disk, and the last backup', {
      out: { health: state, attention: t.arr(attention), activity: t.arr(t.obj({ at: t.ts(), actor: t.str(), action: t.str(), resource: t.opt(t.str()) })), usage: t.obj({ turnsToday: t.int(), costMicrosMonth: t.int(), members: t.int(), agents: t.int() }),
        machine: t.opt(t.obj({
          cpuPercent: t.opt(t.num({ minimum: 0, maximum: 100 })), memoryUsedBytes: t.opt(t.int({ minimum: 0 })), memoryTotalBytes: t.opt(t.int({ minimum: 0 })),
          diskFreeBytes: t.opt(t.int({ minimum: 0 })), diskTotalBytes: t.opt(t.int({ minimum: 0 })),
        })),
        lastBackup: t.opt(t.obj({ at: t.ts(), result: t.enm('verified', 'unverified') })) },
      perm: 'console.access', tool: 'engineer',
    }),
    read('console.attention', 'Attention items: failing checks, expiring certificates, failed runs, stuck updates, hit limits', { out: { items: t.arr(attention) }, perm: 'console.access', tool: 'engineer' }),
    read('console.activity', 'Recent admin activity from the audit log', { in: { limit: t.opt(t.int({ minimum: 1, maximum: 100 })) }, out: { rows: t.arr(t.obj({ at: t.ts(), actor: t.str(), action: t.str(), resource: t.opt(t.str()) })) }, perm: 'console.access', tool: 'engineer' }),
    read('console.usage', 'Usage and limits by agent, person and model for a period, plus the design-beta sentence', { in: { period: t.enm('day', 'week', 'month'), by: t.enm('agent', 'person', 'model') }, out: { rows: t.arr(usageRow), note: t.str({ examples: ['Vyre is in design beta. Contact Clearfield Labs for more information on plans and pricing.'] }) }, perm: 'console.access', tool: 'engineer' }),
    read('console.speed', 'Speed page: spans rolled up per budget id, p50 and p95 against perf/budgets.json, link to the worst trace', {
      in: { windowMinutes: t.opt(t.int({ minimum: 1 })) },
      out: { rows: t.arr(t.obj({ budgetId: t.str(), p50: t.num(), p95: t.num(), budgetP95: t.num(), worstTraceId: t.opt(id.trace), over: t.bool() })) },
      perm: 'console.access', tool: 'engineer',
    }),
    read('console.nav', 'Console navigation pruned by what the caller may open (pages hide by permission)', { out: { groups: t.arr(t.obj({ key: t.str(), title: t.str(), pages: t.arr(t.obj({ key: t.str(), title: t.str() })) })) }, perm: 'console.access', tool: 'engineer' }),
  ],
  screens: [
    screen('console.overview', 'console', 'ui:ConsoleOverview', { q: { overview: ['console.overview'] }, a: {}, needs: ['console.access'], empty: 'Nothing needs attention', perf: { firstPaintMs: 100, completeMs: 300 } }),
    screen('console.speed', 'console', 'ui:ConsoleSpeed', { q: { speed: ['console.speed'] }, needs: ['console.access'], empty: 'No speed samples yet' }),
    screen('console.usage', 'console', 'ui:ConsoleUsage', { q: { usage: ['console.usage', { period: '/period', by: '/by' }] }, needs: ['console.access'], empty: 'No usage in this period' }),
    screen('console.network', 'console', 'ui:ConsoleNetwork', {
      needs: ['server.network'],
      q: { status: ['network.status'], servers: ['network.servers'], hostnames: ['network.public_hostnames'] },
      a: {
        domain: ['network.domain_set', { domain: '/draft/domain' }], relay: ['network.relay_set', { mode: '/draft/mode' }], renew: ['network.certificate_renew', { host: '/state/host' }],
        check: ['network.ingress_check'], join: ['network.server_join_code'], reconnect: ['network.server_reconnect', { serverId: '/state/serverId' }],
        remove: ['network.server_remove', { serverId: '/state/serverId' }, 'Remove this server?'],
      },
      empty: 'No servers yet', primary: 'Add a server',
    }),
    screen('console.server-updates', 'console', 'ui:ConsoleServerUpdates', {
      needs: ['server.update'],
      q: { status: ['updates.status'], history: ['updates.history'] },
      a: {
        check: ['updates.check'], apply: ['updates.apply', { to: '/state/to' }, 'Back up, then update?'], rollback: ['updates.rollback', { to: '/state/to' }, 'Roll back to this version?'],
        channel: ['updates.channel_set', { channel: '/draft/channel' }],
      },
      empty: 'No updates yet', primary: 'Check for updates',
    }),
    screen('console.server-logs', 'console', 'ui:ConsoleServerLogs', {
      needs: ['server.logs'],
      q: {
        tail: ['logs.tail'],
        entries: ['logs.query', { level: '/state/level', person: '/state/person', agent: '/state/agent', cap: '/state/cap', recordId: '/state/recordId', runId: '/state/runId', traceId: '/state/traceId', sinceMs: '/state/sinceMs' }, false],
      },
      a: { trace: ['logs.trace', { traceId: '/state/traceId' }], export: ['logs.export'] },
      empty: 'No log lines match',
    }),
    screen('console.diagnostics', 'console', 'ui:ConsoleDiagnostics', {
      needs: ['console.access'],
      q: { status: ['health.status'], services: ['health.services'], history: ['health.history', { key: '/state/key', sinceMs: '/state/sinceMs' }, false] },
      a: { run: ['health.run', { key: '/state/key' }], restart: ['health.service_restart', { service: '/state/service' }, 'Restart this service?'], doctor: ['health.doctor'] },
      empty: 'Every check is healthy', primary: 'Run checks',
    }),
    screen('console.support-bundle', 'console', 'ui:ConsoleSupportBundle', {
      needs: ['server.logs'],
      q: { doctor: ['health.doctor', {}, false] },
      a: { bundle: ['health.support_bundle', { traceIds: '/state/traceIds' }] },
      empty: 'No bundle yet', primary: 'Make a support bundle',
    }),
    screen('console.backups', 'console', 'ui:ConsoleBackups', {
      needs: ['server.backups'],
      q: { backups: ['backup.list'], config: ['backup.config_get'] },
      a: {
        run: ['backup.run'], verify: ['backup.verify', { backupId: '/state/backupId' }], preview: ['backup.restore_preview', { backupId: '/state/backupId' }],
        config: ['backup.config_set', { enabled: '/draft/enabled', schedule: '/draft/schedule', target: '/draft/target' }], remove: ['backup.delete', { backupId: '/state/backupId' }, 'Delete this backup?'],
      },
      empty: 'No backups yet', primary: 'Back up now',
    }),
    screen('console.labels', 'console', 'ui:ConsoleLabels', {
      needs: ['policy.manage'],
      q: { labels: ['access.labels.list'] },
      a: { set: ['access.labels.set', { label: '/draft/label', resource: '/state/resource' }], scan: ['schema.sensitivity.scan', { type: '/state/type' }] },
      empty: 'No labels set',
    }),
    screen('console.logging', 'console', 'ui:ConsoleLogging', {
      needs: ['server.logs'],
      q: { settings: ['logs.settings_get'] },
      a: { set: ['logs.settings_set', { level: '/draft/level', fullDays: '/draft/fullDays', aggregateDays: '/draft/aggregateDays' }] },
      empty: 'Logging is on its defaults',
    }),
    screen('console.outside-actors', 'console', 'ui:ConsoleOutsideActors', {
      needs: ['access.manage'],
      q: { actors: ['access.actors.list'] },
      a: {
        create: ['access.actors.create', { name: '/draft/name', provider: '/draft/provider', roleIds: '/draft/roleIds' }], update: ['access.actors.update', { actorId: '/state/actorId', provider: '/draft/provider', roleIds: '/draft/roleIds' }],
        engineer: ['access.actors.set_engineer_mcp', { actorId: '/state/actorId', enabled: '/draft/enabled' }], scopes: ['mcp.scopes.set', { actorId: '/state/actorId', scopes: '/draft/scopes' }],
        revoke: ['access.actors.revoke', { actorId: '/state/actorId' }, 'Revoke this token?'],
      },
      empty: 'No outside actors or API keys yet', primary: 'Connect an outside tool',
    }),
  ],
});
