// @reads /manifests/index.ts
// Coverage fixes from team/v1/prep/MANIFEST-COVERAGE.md (P-PR_33b): every capability, event, setting, screen and notification kind added
// to close a spec gap is declared exactly once, and the new Console and shell screens use only declared capabilities.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { all } from '../../../manifests/index.ts';

const caps = new Map<string, number>();
const events = new Map<string, number>();
const settings = new Map<string, number>();
const screens = new Map<string, number>();
const notifs = new Map<string, number>();
const bump = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1);
for (const m of all) {
  for (const c of m.capabilities ?? []) bump(caps, String(c.name));
  for (const e of m.events ?? []) bump(events, String(e.name));
  for (const s of m.settings ?? []) bump(settings, s.key);
  for (const s of m.screens ?? []) bump(screens, s.id);
  for (const n of m.notificationKinds ?? []) bump(notifs, n.key);
}

const ADDED_CAPABILITIES = [
  // F1 Everyone group defaults
  'access.groups.defaults_get', 'access.groups.defaults_set',
  // F2 agent-filled values, F3 completeness, F4 gap check, F5 record page, F6 sensitivity scan
  'records.values.pending', 'records.values.review', 'records.value_source', 'records.completeness', 'records.gap_check',
  'records.page_prefs.get', 'records.page_prefs.set', 'records.relations_map',
  'schema.layout.get', 'schema.layout.set', 'schema.gap_rules.list', 'schema.gap_rules.set', 'schema.sensitivity.scan',
  // F8 never fill on this site
  'vault.site_rules.list', 'vault.site_rules.set',
  // F10 agent guide and built-in skills
  'agents.guide.get', 'agents.builtin_skills.list',
  // F11 channel stream with collapsed runs and the People / Agents / Runs choice
  'channels.stream', 'channels.stream_prefs.get', 'channels.stream_prefs.set',
  // F12 composer snippets, F13 partial form answers
  'email_builder.snippets.list', 'email_builder.snippets.save', 'email_builder.snippets.delete', 'forms.save_partial',
];
const ADDED_EVENTS = [
  'access.everyone_defaults_changed', 'record.value_proposed', 'record.value_reviewed', 'record.gaps_found', 'vault.site_rule_changed', 'vault.rotation_due',
];
const ADDED_SETTINGS = [
  'security.level', 'security.terminal_mode', 'security.chrome_mode', 'security.team_agents_on_my_computer', 'chrome.agents_use_my_browser', 'space.data_location',
];
const ADDED_SCREENS = [
  'shell.new-tab', 'shell.report-problem', 'console.network', 'console.server-updates', 'console.server-logs', 'console.diagnostics',
  'console.support-bundle', 'console.backups', 'console.labels', 'console.logging', 'console.outside-actors',
];

test('every capability added for the coverage gaps is declared once', () => {
  for (const n of ADDED_CAPABILITIES) assert.equal(caps.get(n), 1, `${n} must be declared exactly once`);
});

test('every event added for the coverage gaps is declared once', () => {
  for (const n of ADDED_EVENTS) assert.equal(events.get(n), 1, `${n} must be declared exactly once`);
});

test('every setting added for the coverage gaps is declared once', () => {
  for (const n of ADDED_SETTINGS) assert.equal(settings.get(n), 1, `${n} must be declared exactly once`);
});

test('every screen added for the coverage gaps is declared once and calls only declared capabilities', () => {
  for (const n of ADDED_SCREENS) assert.equal(screens.get(n), 1, `${n} must be declared exactly once`);
  for (const m of all) {
    for (const s of m.screens ?? []) {
      if (!ADDED_SCREENS.includes(s.id)) continue;
      for (const q of Object.values(s.queries)) assert.ok(caps.has(String(q.cap)), `${s.id} queries unknown capability ${q.cap}`);
      for (const a of Object.values(s.actions)) assert.ok(caps.has(String(a.cap)), `${s.id} calls unknown capability ${a.cap}`);
    }
  }
});

test('the rotation reminder has a notification kind and an event that carries it', () => {
  assert.equal(notifs.get('vault.rotation_due'), 1);
  const ev = all.flatMap((m) => m.events ?? []).find((e) => e.name === 'vault.rotation_due');
  assert.equal(ev?.notify, 'vault.rotation_due');
});

test('records.hold and records.release_hold are agent tools', () => {
  const recs = all.find((m) => m.id === 'records');
  for (const n of ['records.hold', 'records.release_hold']) {
    const c = (recs?.capabilities ?? []).find((x) => x.name === n);
    assert.equal(c?.surfaces.mcp?.toolset, 'records', `${n} toolset`);
  }
});

test('the problem report bundle carries recent errors and the client log', () => {
  const rc = all.find((m) => m.id === 'reports-client');
  const submit = (rc?.capabilities ?? []).find((c) => c.name === 'reports.submit');
  const bundle = submit?.input.properties?.bundle;
  assert.ok(bundle?.properties?.errors, 'bundle.errors');
  assert.ok(bundle?.properties?.clientLogFileId, 'bundle.clientLogFileId');
});
