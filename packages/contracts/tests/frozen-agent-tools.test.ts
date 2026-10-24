// @reads /generated/tool-index.json
// @reads /docs/frozen/agent-tools.md
// @reads /manifests/index.ts
// Freeze review D (P-PR_37): agent tools. ARCH 3.7 output 6 and 6.7: toolsets, agent parity with the UI, deferred flags,
// and a default listed toolset of about 60 tools. The frozen default list is the one in docs/frozen/agent-tools.md.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { all } from '../../../manifests/index.ts';
import { agentVisible } from '../../../tools/gen/src/validate.ts';
import type { CapabilityDef } from '../src/index.ts';

type Tool = { name: string; summary: string; toolset: string; deferred: boolean };
const read = (f: string): string => readFileSync(new URL(`../../../${f}`, import.meta.url), 'utf8');
const tools = (JSON.parse(read('generated/tool-index.json')) as { tools: Tool[] }).tools;
const byName = new Map(tools.map((t) => [t.name, t]));

const TOOLSETS = ['records', 'files', 'memory', 'vault', 'automations', 'chats', 'inbox', 'sites', 'terminal', 'computer', 'agents', 'tasks', 'meta', 'engineer'];

/** The frozen default listed toolset: ARCH 6.7 names these by toolset. Everything else is found with tool_search. */
export const DEFAULT_TOOLS: Record<string, string[]> = {
  records: ['schema_describe', 'records_query', 'records_get', 'records_create', 'records_update', 'records_bulk_upsert', 'records_history', 'records_as_of', 'records_relate'],
  files: ['files_list', 'files_read', 'files_write', 'mounts_add', 'git_status', 'git_diff', 'git_commit', 'changesets_get', 'changesets_diff'],
  memory: ['memory_search', 'read_note', 'facts_as_of', 'memory_propose'],
  vault: ['vault_use', 'vault_request'],
  automations: ['automations_list', 'automations_create', 'automations_run', 'journeys_start', 'wait_for'],
  chats: ['chat_post', 'chat_thread', 'handoff', 'ask_question', 'plan_propose', 'open_tab'],
  inbox: ['mail_message_search', 'mail_draft', 'mail_send', 'calendar_list_events', 'calendar_create_event'],
  sites: ['sites_build', 'sites_tables', 'sites_deploy', 'sites_previews', 'sites_promote'],
  terminal: ['terminal_run', 'terminal_open'],
  computer: ['screen_screenshot', 'screen_click', 'chrome_snapshot', 'chrome_act'],
  agents: ['agents_list', 'agents_get'],
  tasks: ['tasks_create', 'tasks_list', 'tasks_update', 'tasks_transition'],
  meta: ['tool_search', 'switch_model'],
};
const defaults = Object.values(DEFAULT_TOOLS).flat();

test('every generated tool has a known toolset, a unique snake_case name and a plain summary', () => {
  assert.equal(byName.size, tools.length, 'tool names are unique');
  for (const t of tools) {
    assert.match(t.name, /^[a-z][a-z0-9_]*$/, t.name);
    assert.ok(TOOLSETS.includes(t.toolset), `${t.name} has toolset ${t.toolset}`);
    assert.equal(typeof t.deferred, 'boolean', t.name);
    assert.ok(t.summary.length > 0 && !/\u2014|\u00a7/u.test(t.summary), `${t.name} summary`);
  }
  for (const ts of TOOLSETS) assert.ok(tools.some((t) => t.toolset === ts), `toolset ${ts} is empty`);
});

test('agent parity: every capability a person-facing screen reaches is an agent tool or has an agent tool wrapping it', () => {
  const caps = new Map<string, CapabilityDef>();
  const wrapped = new Set<string>();
  for (const m of all) {
    for (const c of m.capabilities ?? []) caps.set(c.name, c);
    for (const a of m.agentTools ?? []) if (a.cap) wrapped.add(a.cap);
  }
  const missing: string[] = [];
  let reached = 0;
  for (const m of all) for (const s of m.screens ?? []) {
    if ((s.caller ?? 'principal') !== 'principal') continue;
    const uses = [...Object.values(s.queries ?? {}).map((q) => q.cap), ...Object.values(s.actions ?? {}).map((a) => a.cap)];
    for (const cap of uses) {
      reached++;
      const c = caps.get(cap);
      if (!c) { missing.push(`${s.id}: unknown ${cap}`); continue; }
      if ((c.caller ?? 'principal') === 'principal' && !agentVisible(c) && !wrapped.has(cap)) missing.push(`${s.id}: ${cap} has no agent tool`);
    }
  }
  assert.ok(reached > 500, `only ${reached} screen references checked`);
  assert.deepEqual(missing, []);
});

test('pre-auth capabilities stay off the agent surface and no capability opts out of agents without being unreachable', () => {
  for (const m of all) for (const c of m.capabilities ?? []) {
    if ((c.caller ?? 'principal') !== 'principal') assert.ok(!agentVisible(c) && !c.surfaces.mcp, `${c.name} is pre-auth but visible to agents`);
  }
});

test('the frozen default toolset is 60 plus or minus 5 and only lists real, listed, non-engineer tools', () => {
  assert.ok(defaults.length >= 55 && defaults.length <= 65, `default toolset has ${defaults.length} tools`);
  assert.equal(new Set(defaults).size, defaults.length, 'no tool listed twice');
  for (const [toolset, names] of Object.entries(DEFAULT_TOOLS)) {
    assert.ok(TOOLSETS.includes(toolset) && toolset !== 'engineer', toolset);
    for (const n of names) {
      const t = byName.get(n);
      assert.ok(t, `${n} is not a generated tool`);
      assert.equal(t.toolset, toolset, `${n} is in toolset ${t.toolset}, not ${toolset}`);
      assert.equal(t.deferred, false, `${n} is deferred, so it cannot be in the default list`);
    }
  }
});

test('the default list covers every toolset ARCH 6.7 names, and tool_search, wait_for and plan_propose are in it', () => {
  for (const ts of TOOLSETS.filter((t) => t !== 'engineer')) assert.ok(DEFAULT_TOOLS[ts]?.length, `${ts} has no default tool`);
  for (const n of ['tool_search', 'wait_for', 'switch_model', 'plan_propose', 'ask_question', 'handoff']) assert.ok(defaults.includes(n), n);
});

test('the frozen doc lists exactly the default tools in the test', () => {
  const doc = read('docs/frozen/agent-tools.md');
  const inDoc = new Set([...doc.matchAll(/^\| `([a-z0-9_]+)` \|/gm)].map((m) => m[1]));
  assert.deepEqual([...inDoc].sort(), [...defaults].sort());
});

