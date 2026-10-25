// Freeze review E (P-PR_38). Extension kinds: gate acts, task kinds, notification kinds,
// health checks, retention classes, settings, steps, triggers, connectors and blocks,
// plus the import sources and lists that generated/kinds.ts also exports.
// Every table is non-empty. Every kind names its declaring module and carries one example.
// Spec 2.14 (gate acts), 2.24 (notification levels) and 4.18 (health next steps, log window).
// ARCH 3.4 steps, triggers and connectors are read from the registry. The other tables are
// the exports of generated/kinds.ts (ARCH 3.5 for blocks, health, gate acts, tasks, notifications).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  blocks, gateActs, healthChecks, importSources, lists, notificationKinds, retention, settings, taskKinds,
} from '../../generated/kinds.ts';
import { registry } from '../../generated/registry.ts';

const modules = new Set(registry.modules.map((m) => m.id));

function moduleOf(module: string, where: string): void {
  assert.equal(typeof module, 'string', where);
  assert.ok(module.length > 0, `${where} has no declaring module`);
  assert.ok(modules.has(module), `${where} module ${module} is not a registry module`);
}

/** A present example: text, a non-empty list, or any other non-null value (object, number, boolean). */
function example(value: unknown, where: string): void {
  assert.notEqual(value, undefined, `${where} has no example`);
  assert.notEqual(value, null, `${where} example is null`);
  if (typeof value === 'string') assert.ok(value.length > 0, `${where} example is blank`);
  if (Array.isArray(value)) assert.ok(value.length > 0, `${where} example is empty`);
}

const kindTables = [
  ['gateActs', gateActs],
  ['taskKinds', taskKinds],
  ['notificationKinds', notificationKinds],
  ['healthChecks', healthChecks],
  ['retention', retention],
  ['settings', settings],
  ['importSources', importSources],
  ['blocks', blocks],
  ['lists', lists],
] as const;

test('kinds.ts tables are the registry tables and none is empty', () => {
  assert.equal(gateActs, registry.gateActs);
  assert.equal(taskKinds, registry.taskKinds);
  assert.equal(notificationKinds, registry.notificationKinds);
  assert.equal(healthChecks, registry.health);
  assert.equal(retention, registry.retention);
  assert.equal(settings, registry.settings);
  assert.equal(importSources, registry.importSources);
  assert.equal(blocks, registry.blocks);
  assert.equal(lists, registry.lists);
  for (const [name, rows] of kindTables) assert.ok(rows.length > 0, `${name} is empty`);
});

test('every kind in the kinds.ts tables has a declaring module and an example', () => {
  for (const g of gateActs) {
    moduleOf(g.module, `gate act ${g.key}`);
    example(g.preview.blocks[0], `gate act ${g.key}`);
  }
  for (const k of taskKinds) {
    moduleOf(k.module, `task kind ${k.key}`);
    example(k.actions[0], `task kind ${k.key}`);
    example(k.title, `task kind ${k.key} title`);
  }
  for (const n of notificationKinds) {
    moduleOf(n.module, `notification ${n.key}`);
    example(n.title, `notification ${n.key}`);
  }
  for (const h of healthChecks) {
    moduleOf(h.module, `health ${h.key}`);
    example(h.next, `health ${h.key}`);
    example(h.cap, `health ${h.key} cap`);
  }
  for (const r of retention) {
    moduleOf(r.module, `retention ${r.key}`);
    example(r.default, `retention ${r.key}`);
    example(r.title, `retention ${r.key} title`);
  }
  for (const s of settings) {
    moduleOf(s.module, `setting ${s.key}`);
    // The default is the example. null, "", [] and {} are real defaults for an empty profile field or an empty list.
    assert.ok(Object.hasOwn(s, 'default'), `setting ${s.key} has no default example`);
    example(s.title, `setting ${s.key} title`);
    assert.ok(s.scope === 'space' || s.scope === 'person', s.key);
  }
  for (const s of importSources) {
    moduleOf(s.module, `import ${s.key}`);
    example(s.accepts[0], `import ${s.key}`);
    example(s.parse, `import ${s.key} parse`);
  }
  for (const b of blocks) {
    moduleOf(b.module, `block ${b.type}`);
    example(b.fallback, `block ${b.type}`);
  }
  for (const l of lists) {
    moduleOf(l.module, `list ${l.type}`);
    example(l.items, `list ${l.type}`);
    assert.equal(l.newItemStartsPersonal, true, l.type);
  }
});

test('steps, triggers and connectors each have a declaring module and an example', () => {
  const gateKeys = new Set(gateActs.map((g) => g.key));
  const healthKeys = new Set(healthChecks.map((h) => h.key));
  assert.ok(registry.steps.length > 0, 'steps is empty');
  for (const s of registry.steps) {
    moduleOf(s.module, `step ${s.key}`);
    example(s.sample, `step ${s.key}`);
    if (s.gateAct !== undefined) assert.ok(gateKeys.has(s.gateAct), `step ${s.key} gate ${s.gateAct}`);
  }
  assert.ok(registry.triggers.length > 0, 'triggers is empty');
  for (const trig of registry.triggers) {
    moduleOf(trig.module, `trigger ${trig.key}`);
    example(trig.sample, `trigger ${trig.key}`);
  }
  const webhook = registry.triggers.find((trig) => trig.key === 'webhook');
  assert.ok(webhook, 'webhook trigger');
  assert.equal(webhook.personalOk, false);
  assert.ok(registry.connectors.length > 0, 'connectors is empty');
  for (const c of registry.connectors) {
    moduleOf(c.module, `connector ${c.key}`);
    example(c.domains[0], `connector ${c.key}`);
    assert.ok(healthKeys.has(c.health), `connector ${c.key} health ${c.health}`);
  }
});

test('gate acts follow spec 2.14', () => {
  assert.deepEqual(gateActs.map((g) => g.key).sort(), [
    'campaign_launch', 'delete', 'pay', 'post', 'push_protected', 'secret_export', 'send', 'signature_send', 'site_promote', 'spend_raise',
  ]);
  const humanToo = new Set(['campaign_launch', 'push_protected', 'secret_export', 'site_promote']);
  for (const g of gateActs) {
    assert.equal(g.module, 'gate', g.key);
    assert.equal(g.sendsOnApprove, 'gate.release', g.key);
    assert.equal(g.timeout.afterHours, 24, g.key);
    assert.equal(g.timeout.onTimeout, 'escalate', g.key);
    assert.equal(g.timeout.escalateTo, 'delegate', g.key);
    assert.equal(g.timeout.emailBackstopHours, 4, g.key);
    assert.equal(g.approvers.peopleOnly, true, g.key);
    assert.equal(g.appliesTo.humanToo, humanToo.has(g.key), g.key);
    example(g.preview.blocks[0]?.type, `preview ${g.key}`);
  }
});

test('notification kinds use the three spec 2.24 levels', () => {
  const levels = new Set(['interrupt', 'badge', 'digest']);
  for (const n of notificationKinds) {
    assert.equal(n.module, 'notifications', n.key);
    assert.ok(levels.has(n.level), `${n.key} level ${n.level}`);
    if (n.level === 'interrupt') {
      assert.equal(n.respectHours, false, n.key);
      example(n.pushTitle, `push ${n.key}`);
    }
  }
  const approval = notificationKinds.find((n) => n.key === 'approval.requested');
  assert.ok(approval, 'approval.requested');
  assert.equal(approval.level, 'interrupt');
  assert.equal(approval.place, 'chats');
  assert.equal(approval.backstopEmailAfterHours, 4);
  const blocked = notificationKinds.find((n) => n.key === 'agent.blocked');
  assert.ok(blocked, 'agent.blocked');
  assert.equal(blocked.level, 'interrupt');
  assert.equal(blocked.place, 'chats');
});

test('health checks and the logs retention class follow spec 4.18', () => {
  for (const h of healthChecks) {
    example(h.cap, `cap ${h.key}`);
    example(h.next, `next ${h.key}`);
    assert.ok(h.intervalSec > 0 && h.timeoutMs > 0, h.key);
  }
  const logs = retention.find((r) => r.key === 'logs');
  assert.ok(logs, 'logs retention');
  assert.equal(logs.module, 'governance');
  assert.equal(logs.default, '30d');
});

test('task kinds and retention classes are the closed sets their modules own', () => {
  assert.deepEqual(taskKinds.map((k) => k.key).sort(), ['answer', 'approve', 'review', 'signature', 'unblock', 'work']);
  for (const k of taskKinds) assert.equal(k.module, 'tasks', k.key);
  assert.deepEqual(retention.map((r) => r.key).sort(), [
    'audit', 'backups', 'events', 'file_versions', 'logs', 'memory', 'records', 'run_logs', 'transcripts', 'trash',
  ]);
  for (const r of retention) assert.equal(r.module, 'governance', r.key);
});

// Run on the final commit of this packet, after merging main, so the CI log lists this file as ok.

// Run on the final commit of this packet, after merging main, so the CI log lists this file as ok.

// Run on the final commit of this packet, after merging main, so the CI log lists this file as ok.

// Run on the final commit of this packet, after merging main, so the CI log lists this file as ok.

// Run on the final commit of this packet, after merging main, so the CI log lists this file as ok.
// rerun on final commit
// run on the final commit of P-CC_33
// run on the final commit of the lanes PR
