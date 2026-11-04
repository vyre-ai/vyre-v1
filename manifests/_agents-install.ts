// Install from a link, and skills that agents own and share (owner, 4 Nov 2026), declared here and spread into the agents manifest.
// DECISION: reading a link only makes a plan; nothing is put anywhere until install.apply, which the Gate holds for an agent's call as a card the person approves (act `install`).
// DECISION: "Everyone in the Space" is for an admin only. A local MCP server runs in the sandbox through the plugin runtime, or is deployed on Sites when the person picks Run it on the Space.
// DECISION: nothing updates by itself. An update is a new plan with the diff, applied the same held way.
// DECISION: a skill has an owner, a person or an agent; an agent is given use, edit or manage of a skill the way a person is given a level; every save is a version and can be undone.
import { read, t, write } from '../packages/contracts/src/index.ts';
import type { CapabilityDef } from '../packages/contracts/src/index.ts';
import { id } from './_common.ts';

const skoId = t.id('sko');
const level = t.enm('use', 'edit', 'manage');
const insId = t.id('ins');
const needs = t.obj({ domains: t.arr(t.str()), vaultKeys: t.arr(t.str()), files: t.arr(t.str()) });
const diff = t.obj({
  from: t.str(), to: t.str(), added: t.arr(t.str()), removed: t.arr(t.str()),
  changed: t.arr(t.obj({ path: t.str(), plus: t.arr(t.str()), minus: t.arr(t.str()) })),
});
const plan = t.obj({
  planId: insId, state: t.str(), kind: t.enm('skill', 'plugin', 'mcp_local', 'mcp_remote', 'site'), flavor: t.opt(t.enm('claude', 'codex')), name: t.str(),
  summary: t.str({ description: 'What it does, in plain words, read from its README and manifest' }), repo: t.str(), commit: t.str({ description: 'The exact commit it was read at; installs are pinned to it' }), url: t.str(), path: t.opt(t.str()),
  needs, runs: t.opt(t.obj({ command: t.str(), args: t.arr(t.str()) })), skills: t.arr(t.str()), problems: t.arr(t.str()),
  card: t.obj({ name: t.str(), kind: t.str(), summary: t.str(), commit: t.str(), needs }, { description: 'Copy this into install.apply as card: the held act carries it, so the card draws without a second fetch' }),
  who: t.arr(t.obj({ key: t.enm('me', 'agent', 'space'), label: t.str(), allowed: t.bool(), adminOnly: t.opt(t.bool()) })),
  runOn: t.opt(t.arr(t.obj({ key: t.enm('sandbox', 'space'), label: t.str(), needs: t.opt(t.str()) }))), diff: t.opt(diff),
});
const grant = t.obj({ agentId: id.agent, level, by: t.str(), at: t.ts() });
const skillRef = t.obj({ skillId: skoId, name: t.str(), description: t.str(), owner: t.str(), ownerKind: t.enm('person', 'agent'), rev: t.int({ minimum: 1 }), version: t.str(), updatedAt: t.ts() });

export const installCapabilities: CapabilityDef[] = [
  write('install.from_link', 'Read a GitHub link (pinned to a commit) or an MCP server address and say what it is: a skill, a plugin, a local MCP server, a remote MCP server or a site, what it does, what it needs (network, Vault keys, files) and who can get it. Nothing is installed', {
    in: { url: t.str({ examples: ['https://github.com/anthropics/skills/tree/main/pdf'] }) }, out: { plan },
    perm: null, level: 'use', risk: 'low', idem: 'none', audit: 'always', tool: 'agents', mcpName: 'install_from_link', agent: { planMode: 'blocked', blocks: ['install_plan'] },
    errors: ['validation.bad_input', 'validation.not_found', 'validation.precondition_failed', 'permission.no_grant', 'provider.unavailable'],
  }),
  write('install.apply', 'Install what a plan says, for the person, for one agent, or for everyone in the Space (admin only). An agent asking is held at the Gate as a card with the plan; the person presses Install', {
    in: { planId: insId, card: t.opt(t.obj({ name: t.str(), kind: t.str(), summary: t.str(), commit: t.str(), needs })), for: t.enm('me', 'agent', 'space'), agentId: t.opt(id.agent), runOn: t.opt(t.enm('sandbox', 'space')), authHandle: t.opt(id.handle) },
    out: { installed: t.rec(t.json()) },
    perm: null, level: 'edit', risk: 'high', idem: 'key', audit: 'always', gate: 'install', emits: ['skill.mine_changed', 'skill.added', 'plugin.installed', 'plugin.changed'], tool: 'agents', mcpName: 'install_apply',
    errors: ['validation.bad_input', 'validation.not_found', 'validation.precondition_failed', 'permission.role_lacks_permission'],
  }),
  write('install.check_update', 'Read an install\'s repository again. A newer commit gives an update plan with the diff; nothing changes until the plan is applied', {
    in: { installId: insId }, out: { changed: t.bool(), plan: t.opt(plan) },
    perm: null, level: 'use', risk: 'low', idem: 'none', audit: 'always', tool: 'agents', mcpName: 'install_check_update', agent: { planMode: 'blocked', blocks: ['install_plan'] },
    errors: ['validation.bad_input', 'validation.not_found', 'validation.precondition_failed', 'permission.no_grant', 'provider.unavailable'],
  }),
  read('install.list', 'What was installed from links, by the person asking (an admin may ask for the whole Space)', {
    in: { all: t.opt(t.bool()) }, out: { installs: t.arr(t.obj({ installId: insId, kind: t.str(), name: t.str(), repo: t.str(), commit: t.str(), url: t.str(), by: t.str(), at: t.ts(), installed: t.rec(t.json()) })) },
    perm: null, level: 'view', tool: 'agents', mcpName: 'install_list',
  }),
  read('install.get', 'One plan, as its card draws it: what it is, what it needs, the commit, who can get it, and for an update the diff', {
    in: { planId: insId }, out: { plan, updateOf: t.opt(insId) }, perm: null, level: 'view', tool: 'agents', mcpName: 'install_get', errors: ['validation.not_found'],
  }),
  write('install.remove', 'Take back an install: its skill, plugin or connection is removed', {
    in: { installId: insId }, out: { removed: t.bool() }, perm: null, level: 'edit', risk: 'medium', idem: 'none', audit: 'always', emits: ['skill.mine_changed', 'plugin.uninstalled'], tool: 'agents', mcpName: 'install_remove', errors: ['validation.not_found'],
  }),
  read('skills.of_agents', 'The skills the agents a person owns keep for themselves, one row each', {
    in: {}, out: { skills: t.arr(t.obj({ skillId: skoId, name: t.str(), description: t.str(), agentId: id.agent, agentName: t.str(), version: t.str(), source: t.str(), rev: t.int({ minimum: 1 }), updatedAt: t.ts() })) },
    perm: null, level: 'view', tool: 'agents', mcpName: 'skills_of_agents',
  }),
  write('skills.save', 'Write a skill as its owner (the person, or an agent they own; an agent writes its own) or as an agent given edit: a new skill, or a new version of one. Every save is a version', {
    in: { text: t.str(), files: t.opt(t.rec(t.str())), skillId: t.opt(skoId), ownerAgentId: t.opt(id.agent), source: t.opt(t.str()), summary: t.opt(t.str()) }, out: { skill: skillRef },
    perm: null, level: 'edit', risk: 'medium', idem: 'none', audit: 'always', emits: ['skill.mine_changed'], tool: 'agents', mcpName: 'skill_save',
    errors: ['validation.bad_input', 'validation.too_large', 'validation.not_found', 'permission.role_lacks_permission'],
  }),
  read('skills.history', 'The versions of a skill, newest first, each with who saved it and what changed', {
    in: { skillId: skoId }, out: { revisions: t.arr(t.obj({ rev: t.int({ minimum: 1 }), by: t.str(), authorKind: t.enm('person', 'agent'), summary: t.str(), undoOf: t.opt(t.int()), at: t.ts() })) },
    perm: null, level: 'view', tool: 'agents', mcpName: 'skill_history', errors: ['validation.not_found'],
  }),
  write('skills.undo', 'Undo the latest version of a skill; the version before it comes back as a new version, and undoing again brings the undone one back', {
    in: { skillId: skoId }, out: { skill: skillRef, undid: t.int({ minimum: 1 }) },
    perm: null, level: 'edit', idem: 'none', audit: 'always', emits: ['skill.mine_changed'], tool: 'agents', mcpName: 'skill_undo', errors: ['validation.not_found', 'validation.precondition_failed', 'permission.role_lacks_permission'],
  }),
  write('skills.grant', 'Give an agent use, edit or manage of a skill, or take it back (level null). Use puts it in the agent\'s list; edit lets it save versions; manage lets it share the skill on', {
    in: { skillId: skoId, agentId: id.agent, level: t.nullable(level) }, out: { grants: t.arr(grant) },
    perm: null, level: 'edit', idem: 'none', audit: 'always', emits: ['skill.shared'], tool: 'agents', mcpName: 'skill_grant', errors: ['validation.not_found', 'validation.bad_input', 'permission.role_lacks_permission'],
  }),
  read('skills.grants', 'Who owns a skill and which agents hold it, at what level', {
    in: { skillId: skoId }, out: { owner: t.str(), ownerKind: t.enm('person', 'agent'), grants: t.arr(grant) }, perm: null, level: 'view', tool: 'agents', mcpName: 'skill_grants', errors: ['validation.not_found'],
  }),
];
