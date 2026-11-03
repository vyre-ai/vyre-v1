// Vault > Connections (owner rulings D28 and D29, 3 Nov 2026): the one home for every connection an agent can use. This file declares what the page and the Add sheet need beyond the plugin
// capabilities in _agents-plugins.ts: one list with health and use, a person's own (Mine) connections, sharing a Space connection with groups, the Space's rules for who may add what, and the
// server catalog (the official MCP registry, cached so the sheet works offline). Built-in integrations (connections.*, the connectors module) are read by the page beside this list.
// DECISION: a Mine connection belongs to one person. It reaches their chats and their agents' turns for them (the asker), never anyone else's. Anyone may add one, unless the allow-list says no.
// DECISION: a Space connection is for Everyone or for chosen groups; the admin who manages agents sets it. Who may add Space connections is the Space's rule: admins only, or whoever manages agents.
// DECISION: a key is a Vault handle and never a value, and never sits in a command line: an argument that is a handle or looks like a key is refused, so a key only reaches a server through its
// environment or a header.
import { ev, read, t, write } from '../packages/contracts/src/index.ts';
import type { CapabilityDef, EventDef } from '../packages/contracts/src/index.ts';
import { id } from './_common.ts';

const mcsId = t.id('mcs');
const plgId = t.id('plg');
const handleMap = t.rec(t.str({ description: 'A value, or a Vault handle such as #Notion_key.value for a secret' }));
const health = t.enm('ok', 'needs_signin', 'key_refused', 'not_answering', 'needs_setup', 'off', 'unknown');
const source = t.enm('registry', 'paste', 'import', 'hub', 'skill', 'kit', 'hand', 'plugin');

const homeRow = t.obj({
  key: t.str({ description: 'The server key agents see (the tool prefix): the name, or <plugin>/<server>', examples: ['notion'] }),
  kind: t.enm('mcp', 'plugin', 'hub', 'skill'), name: t.str(), title: t.str(), scope: t.enm('mine', 'space', 'agent'),
  connectionId: t.opt(mcsId), pluginId: t.opt(plgId), owner: t.opt(t.str()), agentId: t.opt(id.agent),
  share: t.arr(t.str({ description: 'everyone, or a group id' })),
  transport: t.enm('stdio', 'http', 'sse', 'ws'), address: t.str({ description: 'The https address, or the command line with handles in place of keys' }),
  source, sourceRef: t.opt(t.str({ description: 'The registry name, the file kind, the skill or the plugin it came from' })),
  auth: t.opt(t.enm('oauth')), hub: t.opt(t.enm('composio', 'pipedream')), enabled: t.bool(),
  health, healthNote: t.opt(t.str()), tools: t.opt(t.int({ minimum: 0 })), checkedAt: t.opt(t.ts()),
  usedAt: t.opt(t.ts()), usedBy: t.arr(id.agent),
  keys: t.arr(t.str({ description: 'The Vault handles it uses, by name' })), needs: t.arr(t.str({ description: 'Options it still needs before it can start' })),
  canManage: t.bool(),
});
const policyRow = t.obj({
  spaceAdders: t.enm('admins', 'managers'),
  allowListOn: t.bool(), allowList: t.arr(t.str({ description: 'A registry name, an https host or a package (@acme/server, acme-mcp) that may be added' })),
});
const catalogInput = t.obj({ name: t.str(), description: t.str(), required: t.bool(), secret: t.bool(), value: t.opt(t.str()) });
const catalogRow = t.obj({
  id: t.str(), source: t.enm('official', 'smithery'), name: t.str({ examples: ['com.notion/mcp'] }), title: t.str(), description: t.str(), version: t.str(),
  website: t.opt(t.str()), repository: t.opt(t.str()),
  remote: t.opt(t.obj({ url: t.str(), transport: t.enm('http', 'sse'), headers: t.arr(catalogInput) })),
  package: t.opt(t.obj({ registry: t.enm('npm', 'pypi', 'oci'), runner: t.enm('npx', 'uvx', 'docker'), identifier: t.str(), version: t.str(), env: t.arr(catalogInput) })),
  signIn: t.enm('oauth', 'key', 'none'), allowed: t.bool(),
});
const addIn = {
  name: t.str({ examples: ['notion'] }), title: t.opt(t.str()), url: t.opt(t.str()), command: t.opt(t.str()), args: t.opt(t.arr(t.str())), env: t.opt(handleMap), headers: t.opt(handleMap),
  auth: t.opt(t.enm('oauth')), source: t.opt(source), sourceRef: t.opt(t.str()),
};

export const connectionCapabilities: CapabilityDef[] = [
  read('plugins.connections.home', 'Every connection you can use, for Vault > Connections: yours (Mine), the Space\'s (for everyone or your groups), your agents\' own, and the servers plugins bring, each with its health, who can use it, which agents used it and when', {
    in: {}, out: { mine: t.arr(homeRow), space: t.arr(homeRow), agents: t.arr(homeRow), policy: policyRow, canAddSpace: t.bool(), admin: t.bool() }, perm: null, level: 'member', tool: 'agents', mcpName: 'plugins_connections_home',
  }),
  read('plugins.registry.search', 'Search the MCP server catalog (the official MCP registry). Answers from the last fetch when the registry cannot be reached, and says so.', {
    in: { q: t.opt(t.str()), cursor: t.opt(t.str()), source: t.opt(t.enm('official', 'smithery')), limit: t.opt(t.int({ minimum: 1, maximum: 100 })) },
    out: { entries: t.arr(catalogRow), next: t.opt(t.str()), offline: t.bool(), fetchedAt: t.opt(t.ts()), source: t.enm('official', 'smithery') }, perm: null, level: 'member', tool: 'agents', mcpName: 'plugins_registry_search',
  }),
  write('plugins.connection.add_mine', 'Connect an MCP server for you and your agents only (Mine): by https address, or by a command that runs in the sandbox (npx, uvx). A key is a Vault handle in env or a header.', {
    in: addIn, out: { connection: t.obj({ connectionId: mcsId, name: t.str(), scope: t.enm('mine'), owner: t.str() }) }, perm: null, level: 'member', risk: 'medium', idem: 'key', audit: 'always',
    emits: ['plugin.connection_added'], tool: 'agents', mcpName: 'plugins_connection_add_mine', errors: ['validation.duplicate', 'validation.precondition_failed'],
  }),
  write('plugins.connection.update', 'Rename a connection, turn it off or on, switch it to OAuth sign-in, or (admins) choose who in the Space can use it: Everyone or groups', {
    in: { connectionId: mcsId, title: t.opt(t.str()), enabled: t.opt(t.bool()), auth: t.opt(t.enm('oauth', 'none')), share: t.opt(t.arr(t.str({ description: 'everyone, or a group id' }))) },
    out: { connectionId: mcsId }, perm: null, level: 'member', idem: 'key', audit: 'always', emits: ['plugin.connection_changed'], tool: 'agents', mcpName: 'plugins_connection_update', errors: ['validation.not_found', 'permission.role_lacks_permission'],
  }),
  write('plugins.connection.forget', 'Remove a connection you may manage: your own (Mine), or a Space or agent one when you manage agents', {
    in: { connectionId: mcsId }, out: { removed: t.bool() }, perm: null, level: 'member', idem: 'key', audit: 'always', emits: ['plugin.connection_removed'], tool: 'agents', mcpName: 'plugins_connection_forget', errors: ['permission.role_lacks_permission'],
  }),
  write('plugins.connection.checked', 'The host records what a connection last did: answered with N tools, wants a sign-in, refused its key, or did not answer; and which agent called it', {
    in: { connectionId: mcsId, health: t.opt(health), note: t.opt(t.str()), tools: t.opt(t.int({ minimum: 0 })), usedBy: t.opt(id.agent) }, out: { ok: t.bool() }, perm: null, level: 'member', audit: 'none', agent: false,
    emits: ['plugin.connection_checked'],
  }),
  read('plugins.connections.policy', 'Who may add Space connections, and the allow-list that limits what anyone else may add', { in: {}, out: { policy: policyRow }, perm: null, level: 'member' }),
  write('plugins.connections.policy_set', 'Set who may add Space connections (admins, or whoever manages agents) and the allow-list (registry names, https hosts, packages) for everyone who is not an admin', {
    in: { spaceAdders: t.opt(t.enm('admins', 'managers')), allowListOn: t.opt(t.bool()), allowList: t.opt(t.arr(t.str())) }, out: { policy: policyRow }, perm: 'policy.manage', level: 'manage', risk: 'high', idem: 'key', audit: 'always',
    emits: ['plugin.connections_policy_changed'],
  }),
];

export const connectionEvents: EventDef[] = [
  ev('plugin.connection_changed', 'A connection was renamed, turned off or on, switched to sign-in, or shared with other people', { p: { connectionId: mcsId, name: t.str(), by: t.str() }, subject: ['entity', '/connectionId'] }),
  ev('plugin.connection_checked', 'A connection\'s health changed', { p: { connectionId: mcsId, name: t.str(), health }, subject: ['entity', '/connectionId'] }),
  ev('plugin.connections_policy_changed', 'The Space\'s rules for adding connections changed', { p: { spaceAdders: t.enm('admins', 'managers'), allowListOn: t.bool(), by: t.str() }, subject: ['entity', '/by'] }),
];
