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
    read('console.overview', 'Overview: health, attention items, recent admin activity, usage', {
      out: { health: state, attention: t.arr(attention), activity: t.arr(t.obj({ at: t.ts(), actor: t.str(), action: t.str(), resource: t.opt(t.str()) })), usage: t.obj({ turnsToday: t.int(), costMicrosMonth: t.int(), members: t.int(), agents: t.int() }) },
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
  ],
});
