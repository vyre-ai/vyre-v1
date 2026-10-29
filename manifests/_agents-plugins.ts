// Plugins and outside tools for agents (CHAT-DESIGN rulings 4 and 6), declared here and spread into the agents manifest. A plugin is a Claude Code plugin from a marketplace (a git URL or a folder):
// its skills become Vyre skills, its commands become / commands, its sub-agents become agent templates, its MCP servers become the agent's tool connections and its hooks run only in the
// sandbox. Any MCP server (a URL, or a command that runs in the sandbox) can also be connected on its own. Plugin code never runs in the daemon or on the Space host.
// DECISION: installing and the allowlist are admin acts (kits.install). Putting a plugin into one agent needs agents.manage and the plugin on the allowlist.
// DECISION: a secret is a Vault handle (#Name.field) and the value is filled at the last moment, in the sandbox environment or the request header. No value is stored here.
import { read, t, write } from '../packages/contracts/src/index.ts';
import type { CapabilityDef, EventDef } from '../packages/contracts/src/index.ts';
import { ev } from '../packages/contracts/src/index.ts';
import { id, pageIn } from './_common.ts';

const mktId = t.id('mkt');
const plgId = t.id('plg');
const mcsId = t.id('mcs');
const userField = t.obj({ key: t.str(), type: t.str(), title: t.str(), description: t.str(), required: t.bool(), sensitive: t.bool() });
const marketplaceRow = t.obj({
  marketplaceId: mktId, name: t.str({ examples: ['acme-tools'] }), kind: t.enm('git', 'local'), source: t.str({ description: 'The git URL or the folder it was added from' }), ref: t.opt(t.str()),
  owner: t.str(), description: t.opt(t.str()), plugins: t.int({ minimum: 0 }), allowed: t.bool(), warnings: t.arr(t.str()), revision: t.opt(t.str()), updatedAt: t.ts(),
});
const parts = t.obj({ skills: t.arr(t.str()), commands: t.arr(t.str()), agents: t.arr(t.str()), hooks: t.int({ minimum: 0 }), mcpServers: t.arr(t.str()) });
const pluginRow = t.obj({
  pluginId: plgId, name: t.str({ examples: ['deploy-tools'] }), marketplace: t.str(), marketplaceId: mktId, scope: t.enm('space', 'agent'), agentId: t.opt(id.agent),
  version: t.opt(t.str()), description: t.opt(t.str()), enabled: t.bool(), parts, userConfig: t.arr(userField), config: t.rec(t.str()), configured: t.bool(), warnings: t.arr(t.str()), installedAt: t.ts(),
});
const browseRow = t.obj({
  marketplaceId: mktId, marketplace: t.str(), name: t.str(), description: t.opt(t.str()), version: t.opt(t.str()), category: t.opt(t.str()), source: t.str({ description: 'path, github, git, npm, archive or command' }),
  allowed: t.bool(), installed: t.arr(t.obj({ pluginId: plgId, scope: t.enm('space', 'agent'), agentId: t.opt(id.agent) })),
});
const commandRow = t.obj({ name: t.str({ examples: ['deploy-tools:status'] }), description: t.str(), argumentHint: t.opt(t.str()), plugin: t.str(), pluginId: plgId });
const mcpSpec = t.obj({
  key: t.str({ description: 'plugin:<plugin>/<server> or <name> for a connection made by hand', examples: ['deploy-tools/api'] }), name: t.str(),
  from: t.enm('plugin', 'connection'), pluginId: t.opt(plgId), transport: t.enm('stdio', 'http', 'sse', 'ws'),
  command: t.opt(t.str()), args: t.arr(t.str()), env: t.rec(t.str()), url: t.opt(t.str()), headers: t.rec(t.str()),
  files: t.opt(t.str({ description: 'Plugin id whose files the command runs from; the folder is ${CLAUDE_PLUGIN_ROOT}' })),
  needs: t.arr(t.str({ description: 'Options of the plugin that have no value yet; the server is not started until they do' })),
});
const hookRow = t.obj({ pluginId: plgId, plugin: t.str(), event: t.str({ examples: ['PostToolUse'] }), matcher: t.str(), command: t.str(), args: t.arr(t.str()), timeoutSec: t.opt(t.int({ minimum: 1 })) });
const connectionRow = t.obj({
  connectionId: mcsId, name: t.str(), scope: t.enm('space', 'agent'), agentId: t.opt(id.agent), transport: t.enm('stdio', 'http'), url: t.opt(t.str()), command: t.opt(t.str()), args: t.arr(t.str()),
  env: t.rec(t.str()), headers: t.rec(t.str()), enabled: t.bool(), createdAt: t.ts(),
});
const allowRow = t.obj({ kind: t.enm('marketplace', 'plugin'), marketplace: t.str(), plugin: t.opt(t.str()), by: t.str(), at: t.ts() });
const handleMap = t.rec(t.str({ description: 'A value, or a Vault handle such as #Dana_Api.token for a secret' }));

export const pluginCapabilities: CapabilityDef[] = [
  read('plugins.marketplaces.list', 'Marketplaces added to this Space', { in: {}, out: { marketplaces: t.arr(marketplaceRow) }, perm: null, level: 'view', tool: 'agents', mcpName: 'plugins_marketplaces' }),
  read('plugins.browse', 'Plugins the marketplaces offer, with whether each is on the allowlist and where it is installed', {
    in: { marketplaceId: t.opt(mktId), q: t.opt(t.str()), ...pageIn }, out: { plugins: t.arr(browseRow), next: t.opt(t.str()), total: t.opt(t.int()) }, perm: null, level: 'view', tool: 'agents', mcpName: 'plugins_browse',
  }),
  read('plugins.list', 'Installed plugins: in the whole Space, and in one agent when agentId is given', { in: { agentId: t.opt(id.agent) }, out: { plugins: t.arr(pluginRow) }, perm: null, level: 'view', tool: 'agents', mcpName: 'plugins_list' }),
  read('plugins.get', 'One installed plugin with the skills, commands, sub-agents, hooks and MCP servers it brought', { in: { pluginId: plgId }, out: { plugin: pluginRow }, perm: null, level: 'view', errors: ['validation.not_found'], tool: 'agents', mcpName: 'plugins_get' }),
  read('plugins.commands.list', 'The / commands that plugins add for a chat with this agent (or the Space when no agent)', {
    in: { agentId: t.opt(id.agent) }, out: { commands: t.arr(commandRow) }, perm: null, level: 'view', tool: 'agents', mcpName: 'plugins_commands',
  }),
  read('plugins.command.render', 'The prompt a plugin command stands for, with its arguments filled in; the chat sends it as the person\'s message', {
    in: { name: t.str({ examples: ['deploy-tools:status'] }), args: t.opt(t.str()), agentId: t.opt(id.agent) },
    out: { prompt: t.str(), description: t.str(), allowedTools: t.arr(t.str()), model: t.opt(t.str()), pluginId: plgId }, perm: null, level: 'view', errors: ['validation.not_found'], tool: 'agents', mcpName: 'plugins_command',
  }),
  read('plugins.agent_templates.list', 'Sub-agents that installed plugins bring, as templates a new agent can start from', {
    in: {}, out: { templates: t.arr(t.obj({ pluginId: plgId, plugin: t.str(), name: t.str(), description: t.str(), tools: t.arr(t.str()), model: t.opt(t.str()) })) }, perm: null, level: 'view', tool: 'agents', mcpName: 'plugins_agent_templates',
  }),
  read('plugins.allow.list', 'The marketplaces and plugins the admin allows', { in: {}, out: { allowed: t.arr(allowRow) }, perm: null, level: 'view', tool: 'agents', mcpName: 'plugins_allowlist' }),
  read('plugins.mcp.servers', 'The MCP servers a chat with this agent connects to: from plugins in the Space, plugins in the agent and connections made by hand. Secrets are Vault handles.', {
    in: { agentId: t.opt(id.agent) }, out: { servers: t.arr(mcpSpec) }, perm: null, level: 'view', tool: 'agents', mcpName: 'plugins_mcp_servers',
  }),
  read('plugins.hooks.list', 'The hooks of the plugins that apply to this agent. They run only in the sandbox.', { in: { agentId: t.opt(id.agent) }, out: { hooks: t.arr(hookRow) }, perm: null, level: 'view' }),
  read('plugins.files', 'The text files of an installed plugin, for the sandbox to be given (its MCP servers and hooks run from them)', {
    in: { pluginId: plgId }, out: { files: t.rec(t.str()) }, perm: null, level: 'view', errors: ['validation.not_found'],
  }),
  read('plugins.connections.list', 'MCP connections made by hand (a URL or a command)', { in: { agentId: t.opt(id.agent) }, out: { connections: t.arr(connectionRow) }, perm: null, level: 'view', tool: 'agents', mcpName: 'plugins_connections' }),

  write('plugins.marketplace.add', 'Add a marketplace by git URL (https) or a folder on this server; reads its marketplace.json and puts it on the allowlist', {
    in: { source: t.str({ examples: ['https://github.com/acme/tools'] }), ref: t.opt(t.str()) }, out: { marketplace: marketplaceRow },
    perm: 'kits.install', level: 'manage', risk: 'high', idem: 'key', audit: 'always', emits: ['plugin.marketplace_added'], tool: 'agents', mcpName: 'plugins_marketplace_add', errors: ['validation.duplicate', 'provider.unavailable'],
  }),
  write('plugins.marketplace.refresh', 'Fetch a marketplace again and update its list', {
    in: { marketplaceId: mktId }, out: { marketplace: marketplaceRow }, perm: 'kits.install', level: 'manage', risk: 'medium', idem: 'key', audit: 'always', emits: ['plugin.marketplace_refreshed'], errors: ['validation.not_found', 'provider.unavailable'],
    tool: 'agents', mcpName: 'plugins_marketplace_refresh',
  }),
  write('plugins.marketplace.remove', 'Remove a marketplace; the plugins installed from it stay until they are removed', {
    in: { marketplaceId: mktId }, out: { removed: t.bool() }, perm: 'kits.install', level: 'manage', risk: 'medium', idem: 'key', audit: 'always', emits: ['plugin.marketplace_removed'], tool: 'agents', mcpName: 'plugins_marketplace_remove',
  }),
  write('plugins.allow.set', 'Allow or stop allowing a whole marketplace, or one plugin of it', {
    in: { kind: t.enm('marketplace', 'plugin'), marketplace: t.str(), plugin: t.opt(t.str()), allowed: t.bool() }, out: { allowed: t.arr(allowRow) }, perm: 'kits.install', level: 'manage', risk: 'high', idem: 'key', audit: 'always',
    emits: ['plugin.allowlist_changed'], tool: 'agents', mcpName: 'plugins_allow',
  }),
  write('plugins.install', 'Install a plugin from a marketplace into the whole Space (admin) or into one agent: its skills, commands, sub-agents, hooks and MCP servers become available', {
    in: { marketplaceId: mktId, plugin: t.str({ examples: ['deploy-tools'] }), scope: t.enm('space', 'agent'), agentId: t.opt(id.agent), config: t.opt(handleMap) },
    out: { plugin: pluginRow }, perm: 'agents.manage', level: 'manage', risk: 'high', idem: 'key', audit: 'always', emits: ['plugin.installed'], tool: 'agents', mcpName: 'plugins_install',
    errors: ['validation.not_found', 'validation.precondition_failed', 'validation.duplicate', 'provider.unavailable', 'validation.too_large'],
  }),
  write('plugins.uninstall', 'Remove an installed plugin and what it brought', {
    in: { pluginId: plgId }, out: { removed: t.bool() }, perm: 'agents.manage', level: 'manage', risk: 'medium', idem: 'key', audit: 'always', emits: ['plugin.uninstalled'], tool: 'agents', mcpName: 'plugins_uninstall',
  }),
  write('plugins.set_enabled', 'Turn an installed plugin off or on without removing it', {
    in: { pluginId: plgId, enabled: t.bool() }, out: { plugin: pluginRow }, perm: 'agents.manage', level: 'manage', idem: 'key', audit: 'always', emits: ['plugin.changed'], errors: ['validation.not_found'], tool: 'agents', mcpName: 'plugins_set_enabled',
  }),
  write('plugins.config.set', 'Set the options a plugin asks for; a secret option takes a Vault handle, never a value', {
    in: { pluginId: plgId, config: handleMap }, out: { plugin: pluginRow }, perm: 'agents.manage', level: 'manage', idem: 'key', audit: 'always', emits: ['plugin.changed'], errors: ['validation.not_found', 'validation.bad_input'], tool: 'agents', mcpName: 'plugins_config',
  }),
  write('plugins.agent_template.use', 'Make an agent from a sub-agent a plugin brought (its description becomes the role line and its prompt the start of AGENT.md)', {
    in: { pluginId: plgId, name: t.str(), agentName: t.opt(t.str()) }, out: { agentId: id.agent }, perm: 'agents.manage', level: 'manage', idem: 'key', audit: 'always', emits: ['plugin.changed', 'agent.created'], errors: ['validation.not_found', 'validation.duplicate'],
    tool: 'agents', mcpName: 'plugins_agent_template_use',
  }),
  write('plugins.connection.add', 'Connect an MCP server by URL (remote) or by command (runs in the sandbox), for the Space or one agent; works for every model', {
    in: {
      name: t.str({ examples: ['crm'] }), scope: t.enm('space', 'agent'), agentId: t.opt(id.agent), url: t.opt(t.str()), command: t.opt(t.str()), args: t.opt(t.arr(t.str())), env: t.opt(handleMap), headers: t.opt(handleMap),
    },
    out: { connection: connectionRow }, perm: 'agents.manage', level: 'manage', risk: 'high', idem: 'key', audit: 'always', emits: ['plugin.connection_added'], tool: 'agents', mcpName: 'plugins_connection_add', errors: ['validation.duplicate'],
  }),
  write('plugins.connection.remove', 'Disconnect an MCP server made by hand', {
    in: { connectionId: mcsId }, out: { removed: t.bool() }, perm: 'agents.manage', level: 'manage', idem: 'key', audit: 'always', emits: ['plugin.connection_removed'], tool: 'agents', mcpName: 'plugins_connection_remove',
  }),
];

export const pluginEvents: EventDef[] = [
  ev('plugin.marketplace_added', 'A marketplace was added', { p: { marketplaceId: mktId, name: t.str(), source: t.str(), by: t.str() }, subject: ['entity', '/marketplaceId'] }),
  ev('plugin.marketplace_refreshed', 'A marketplace was fetched again', { p: { marketplaceId: mktId, name: t.str(), plugins: t.int(), by: t.str() }, subject: ['entity', '/marketplaceId'] }),
  ev('plugin.marketplace_removed', 'A marketplace was removed', { p: { marketplaceId: mktId, name: t.str(), by: t.str() }, subject: ['entity', '/marketplaceId'] }),
  ev('plugin.allowlist_changed', 'The plugin allowlist changed', { p: { kind: t.enm('marketplace', 'plugin'), marketplace: t.str(), plugin: t.opt(t.str()), allowed: t.bool(), by: t.str() }, subject: ['entity', '/marketplace'] }),
  ev('plugin.installed', 'A plugin was installed', { p: { pluginId: plgId, name: t.str(), marketplace: t.str(), scope: t.enm('space', 'agent'), agentId: t.opt(id.agent), by: t.str() }, subject: ['entity', '/pluginId'] }),
  ev('plugin.uninstalled', 'A plugin was removed', { p: { pluginId: plgId, name: t.str(), by: t.str() }, subject: ['entity', '/pluginId'] }),
  ev('plugin.changed', 'A plugin was turned on or off, configured, or used to make an agent', { p: { pluginId: plgId, name: t.str(), by: t.str() }, subject: ['entity', '/pluginId'] }),
  ev('plugin.connection_added', 'An MCP server was connected', { p: { connectionId: mcsId, name: t.str(), scope: t.enm('space', 'agent'), agentId: t.opt(id.agent), by: t.str() }, subject: ['entity', '/connectionId'] }),
  ev('plugin.connection_removed', 'An MCP connection was removed', { p: { connectionId: mcsId, name: t.str(), by: t.str() }, subject: ['entity', '/connectionId'] }),
];
