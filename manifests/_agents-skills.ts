// Skills for a person, shared skills and the admin's view (owner ruling 3 Nov, decisions D26 and D27), declared here and spread into the agents manifest. Settings > Skills is the same page in
// every Space: cards for skills shared with you, Mine (for you and the agents you pick), From your Space (set by an admin in Console, applied to everyone) and Built in. Console > Skills is the
// admin's view of the same parts.
// DECISION: a shared skill never runs for a recipient until they press Add on its card. An update that can touch more (a new script, server, host or Vault key) waits for Add again.
// DECISION: a Space skill an admin sets applies to every member and their agents with no card; a member sees it and cannot remove it (skills.remove needs agents.manage).
// DECISION (D27): two skills with one name are both kept. The one that came later is renamed with its source, "pdf (from acme/skills)", in the list and in every agent's index.
// DECISION (D26): you alone approve your own skills; an optional admin rule, off by default, keeps skills that run scripts or start servers to admins.
import { ev, read, screen, t, write } from '../packages/contracts/src/index.ts';
import type { CapabilityDef, EventDef, KitScreenDef } from '../packages/contracts/src/index.ts';
import { id } from './_common.ts';

const skoId = t.id('sko');
const mcpNeed = t.obj({ name: t.str(), transport: t.enm('stdio', 'http', 'sse', 'ws'), target: t.str({ description: 'The command it runs or the address it reaches' }), keys: t.arr(t.str({ description: 'A key the server wants, given as a Vault handle at setup' })) });
const perms = t.obj({
  scripts: t.arr(t.str({ description: 'Script files it ships' })), mcpServers: t.arr(mcpNeed),
  network: t.arr(t.str({ description: 'Hosts or tools that reach the internet' })), vaultKeys: t.arr(t.str({ description: 'Vault items it names' })),
});
const agentsPick = t.arr(t.str({ description: '"*" for all of my agents, or agent ids' }));
const ownRow = t.obj({
  skillId: skoId, name: t.str({ description: 'The name load_skill takes; a newcomer with a taken name carries its source in front' }), label: t.opt(t.str({ description: 'pdf (from acme/skills), when renamed' })),
  description: t.str(), source: t.str({ description: 'upload, folder, zip, link:<url>, github:<owner>/<repo>[@ref][/path], marketplace:<m>/<p>, assistant' }), origin: t.str(), version: t.opt(t.str()),
  projectId: t.opt(id.project), agents: agentsPick, enabled: t.bool(), perms, setup: t.rec(t.str({ description: 'server.KEY to a Vault handle' })), needs: t.arr(t.str({ description: 'server.KEY still without a handle' })),
  sharedWith: t.arr(t.str({ description: 'Person ids, or "*" for everyone in the Space' })), updatedAt: t.ts(),
});
const card = t.obj({
  skillId: skoId, name: t.str(), label: t.opt(t.str()), description: t.str(), sharer: t.str(), sharerName: t.str(), toSpace: t.bool(), source: t.str(), origin: t.str(), version: t.opt(t.str()), perms,
  state: t.enm('waiting', 'added', 'not_now'), growth: t.arr(t.str({ description: 'What an update can touch that was not approved; it waits for Add again' })),
  agents: agentsPick, enabled: t.bool(), setup: t.rec(t.str()), needs: t.arr(t.str()), updatedAt: t.ts(),
});
const spaceRow = t.obj({
  skillId: t.str(), name: t.str(), label: t.opt(t.str()), description: t.str(), source: t.str(), origin: t.str(), version: t.opt(t.str()), enabled: t.bool(), perms, setup: t.rec(t.str()), needs: t.arr(t.str()),
  from: t.opt(t.str({ description: 'The member it was made Space-wide from' })), updatedAt: t.opt(t.ts()),
});
const preview = t.obj({ name: t.str(), description: t.str(), text: t.str(), files: t.rec(t.str()), path: t.str(), source: t.str({ description: 'What to keep as its source, so Update can fetch this one skill again' }), kind: t.enm('skill', 'plugin', 'codex'), version: t.opt(t.str()), perms, taken: t.opt(t.str({ description: 'The name it will take, when its own is taken' })) });
const policy = t.obj({ scriptsAdminOnly: t.bool({ description: 'Only admins add skills that run scripts or start tool servers. Off by default.' }) });

export const skillScopeCapabilities: CapabilityDef[] = [
  read('skills.page', 'Settings > Skills for the person asking: cards for skills shared with them, their own skills (Mine), the Space skills an admin set, the built-in ones, and their agents to assign them to', {
    in: { projectId: t.opt(id.project) },
    out: {
      waiting: t.arr(card), mine: t.arr(ownRow), shared: t.arr(card), space: t.arr(spaceRow), builtin: t.arr(t.obj({ name: t.str(), description: t.str() })),
      agents: t.arr(t.obj({ agentId: id.agent, name: t.str() })), policy, admin: t.bool(), me: t.str({ description: 'The person asking' }),
    },
    perm: null, level: 'view', tool: 'agents', mcpName: 'skills_page',
  }),
  read('skills.view', 'The full text and files of one skill: your own, one shared with you (before you add it, too), a Space one or a built-in one', {
    in: { skillId: t.opt(t.str()), name: t.opt(t.str()) },
    out: { skill: t.obj({ name: t.str(), description: t.str(), text: t.str(), files: t.arr(t.obj({ path: t.str(), bytes: t.int({ minimum: 0 }), text: t.str() })), perms, source: t.str(), version: t.opt(t.str()) }) },
    perm: null, level: 'view', tool: 'agents', mcpName: 'skills_view', errors: ['validation.not_found'],
  }),
  read('skills.preview', 'Read the skills in a link (a SKILL.md, a GitHub repo or folder, a zip), a dropped folder or a zip, with what each can touch. Nothing is saved', {
    in: { link: t.opt(t.str({ examples: ['https://github.com/anthropics/skills/tree/main/pdf'] })), zip: t.opt(t.str({ description: 'The zip, base64' })), files: t.opt(t.rec(t.str())), hint: t.opt(t.str({ description: 'The folder name, for a lone AGENTS.md' })), marketplace: t.opt(t.obj({ marketplaceId: t.id('mkt'), plugin: t.str() })) },
    out: { skills: t.arr(preview), problems: t.arr(t.str()), skipped: t.arr(t.str({ description: 'Binary files left out' })), source: t.str() },
    perm: null, level: 'view', tool: 'agents', mcpName: 'skills_preview', errors: ['validation.bad_input', 'provider.unavailable', 'validation.too_large', 'validation.not_found', 'validation.precondition_failed'],
  }),
  read('skills.members', 'Console: the skills each member keeps for themselves, by name only; contents only of the ones they shared', {
    in: {}, out: { skills: t.arr(t.obj({ owner: t.str(), ownerName: t.str(), name: t.str(), shared: t.bool(), skillId: t.opt(skoId), toSpace: t.bool() })) },
    perm: 'agents.manage', level: 'manage', tool: 'agents',
  }),
  write('skills.mine.add', 'Add a skill for yourself and your agents (Mine), or replace one of yours. A name already taken is kept, and this one is renamed with its source', {
    in: {
      text: t.str(), files: t.opt(t.rec(t.str())), source: t.opt(t.str()), version: t.opt(t.str()), projectId: t.opt(id.project), agents: t.opt(agentsPick), replaces: t.opt(skoId),
    },
    out: { skill: ownRow }, perm: null, level: 'edit', risk: 'medium', idem: 'key', audit: 'always', emits: ['skill.mine_changed'], tool: 'agents', mcpName: 'skills_mine_add',
    errors: ['validation.bad_input', 'validation.too_large', 'validation.duplicate', 'permission.role_lacks_permission'],
  }),
  write('skills.mine.set', 'Switch one of your skills (or one shared with you) on or off, pick the agents that use it, or give its tool servers their Vault keys', {
    in: { skillId: skoId, enabled: t.opt(t.bool()), agents: t.opt(agentsPick), setup: t.opt(t.rec(t.str({ description: 'A Vault handle such as #Notion_key.api_key' }))) },
    out: { skillId: skoId, enabled: t.bool(), agents: agentsPick, setup: t.rec(t.str()), needs: t.arr(t.str()) },
    perm: null, level: 'edit', idem: 'key', audit: 'always', emits: ['skill.mine_changed'], tool: 'agents', mcpName: 'skills_mine_set', errors: ['validation.not_found', 'validation.bad_input'],
  }),
  write('skills.mine.remove', 'Remove one of your skills (and its shares), or take a shared one off your list', {
    in: { skillId: skoId }, out: { removed: t.bool() }, perm: null, level: 'edit', idem: 'key', audit: 'always', emits: ['skill.mine_changed'], tool: 'agents', mcpName: 'skills_mine_remove',
  }),
  write('skills.mine.update', 'Fetch one of your skills again from its link or repo; whoever it is shared with approves again if it can now touch more', {
    in: { skillId: skoId }, out: { skill: ownRow, changed: t.bool(), growth: t.arr(t.str()) },
    perm: null, level: 'edit', risk: 'medium', idem: 'key', audit: 'always', emits: ['skill.mine_changed'], tool: 'agents', mcpName: 'skills_mine_update', errors: ['validation.not_found', 'validation.bad_input', 'provider.unavailable', 'permission.role_lacks_permission'],
  }),
  write('skills.share', 'Share one of your skills with chosen people in this Space, or with everyone here. Each of them gets a card and decides', {
    in: { skillId: skoId, to: t.opt(t.arr(id.user)), space: t.opt(t.bool()), stop: t.opt(t.bool({ description: 'Stop sharing with these instead' })) },
    out: { sharedWith: t.arr(t.str()) }, perm: null, level: 'edit', idem: 'key', audit: 'always', emits: ['skill.shared'], tool: 'agents', mcpName: 'skills_share', errors: ['validation.not_found', 'validation.bad_input'],
  }),
  write('skills.shared.decide', 'Add a skill shared with you, so it applies to you and your agents, or say Not now', {
    in: { skillId: skoId, decision: t.enm('add', 'not_now') }, out: { card },
    perm: null, level: 'edit', idem: 'key', audit: 'always', emits: ['skill.share_decided'], tool: 'agents', mcpName: 'skills_shared_decide', errors: ['validation.not_found', 'permission.role_lacks_permission'],
  }),
  write('skills.space.install', 'Console: set a skill for everyone in the Space. It applies to every member and their agents at once, with no card', {
    in: { text: t.str(), files: t.opt(t.rec(t.str())), source: t.opt(t.str()), version: t.opt(t.str()) }, out: { skill: spaceRow },
    perm: 'agents.manage', level: 'manage', risk: 'medium', idem: 'key', audit: 'always', emits: ['skill.added'], tool: 'agents', mcpName: 'skills_space_install', errors: ['validation.bad_input', 'validation.too_large', 'validation.duplicate'],
  }),
  write('skills.space.update', 'Console: fetch a Space skill again from its link or repo', {
    in: { name: t.str() }, out: { skill: spaceRow, changed: t.bool() }, perm: 'agents.manage', level: 'manage', risk: 'medium', idem: 'key', audit: 'always', emits: ['skill.added'], errors: ['validation.not_found', 'validation.bad_input', 'provider.unavailable'],
  }),
  write('skills.space.adopt', 'Console: make a skill a member shared Space-wide, so it applies to everyone with no card', {
    in: { skillId: skoId }, out: { skill: spaceRow }, perm: 'agents.manage', level: 'manage', risk: 'medium', idem: 'key', audit: 'always', emits: ['skill.added'], errors: ['validation.not_found'],
  }),
  write('skills.space.setup', 'Console: give the tool servers of a Space skill their Vault keys', {
    in: { name: t.str(), setup: t.rec(t.str()) }, out: { skill: spaceRow }, perm: 'agents.manage', level: 'manage', idem: 'key', audit: 'always', emits: ['skill.changed'], errors: ['validation.not_found', 'validation.bad_input'],
  }),
  write('skills.policy.set', 'Console: who may add skills that run scripts or start tool servers (everyone, the default, or only admins)', {
    in: { scriptsAdminOnly: t.bool() }, out: { policy }, perm: 'agents.manage', level: 'manage', risk: 'medium', idem: 'key', audit: 'always', emits: ['skill.policy_changed'],
  }),
];

export const skillScopeEvents: EventDef[] = [
  ev('skill.mine_changed', 'A person added, changed or removed one of their own skills', { p: { skillId: skoId, name: t.str(), op: t.enm('added', 'changed', 'removed', 'updated'), by: t.str() }, subject: ['entity', '/skillId'], vis: 'owner' }),
  ev('skill.shared', 'A person shared one of their skills, or stopped', { p: { skillId: skoId, name: t.str(), to: t.arr(t.str()), stop: t.bool(), by: t.str() }, subject: ['entity', '/skillId'], vis: 'participants' }),
  ev('skill.share_decided', 'A person added a skill shared with them, or said Not now', { p: { skillId: skoId, name: t.str(), decision: t.enm('add', 'not_now'), by: t.str() }, subject: ['entity', '/skillId'], vis: 'participants' }),
  ev('skill.policy_changed', 'An admin changed who may add skills that run scripts', { p: { scriptsAdminOnly: t.bool(), by: t.str() }, subject: ['entity', '/by'] }),
];

export const skillScopeScreens: KitScreenDef[] = [
  screen('settings.skills', 'settings', 'ui:SettingsSkills', {
    q: { page: ['skills.page', {}, true] },
    a: {
      add: ['skills.mine.add', {}], set: ['skills.mine.set', { skillId: '/state/skillId' }], remove: ['skills.mine.remove', { skillId: '/state/skillId' }, 'Remove this skill?'],
      share: ['skills.share', { skillId: '/state/skillId' }], decide: ['skills.shared.decide', { skillId: '/state/skillId' }], preview: ['skills.preview', {}],
    },
    empty: 'No skills of your own yet', primary: 'Add a skill',
  }),
];
