// The permission catalogue (V1-SPEC 4.12 plus gap-ruling additions). Rows of the Console roles matrix.
// Reads need no row: they are grant-only (`permission: null`, level `view`).
import { perm } from '../packages/contracts/src/index.ts';
import type { PermissionDef } from '../packages/contracts/src/index.ts';

export const PERMISSIONS: PermissionDef[] = [
  // Space
  perm('members.invite', 'space', 'Invite people', 'medium', ['owner', 'admin']),
  perm('members.remove', 'space', 'Remove people', 'high', ['owner', 'admin']),
  perm('access.manage', 'space', 'Manage roles, groups, grants and outside actors', 'high', ['owner', 'admin']),
  perm('policy.manage', 'space', 'Manage policies, retention and erase a person', 'high', ['owner', 'admin']),
  perm('audit.read', 'space', 'Read the audit log', 'medium', ['owner', 'admin']),
  perm('console.access', 'space', 'Open the Console', 'medium', ['owner', 'admin', 'developer']),
  perm('engineer.mcp', 'space', 'Use the Engineer MCP toolset', 'high', ['owner', 'admin', 'developer']),
  perm('connectors.manage', 'space', 'Manage connectors, connections and webhooks', 'medium', ['owner', 'admin', 'developer'], ['connector', 'connection']),
  // Records
  perm('records.create', 'records', 'Create records', 'low', ['owner', 'admin', 'developer', 'member'], ['record_type', 'record']),
  perm('records.edit', 'records', 'Edit records', 'low', ['owner', 'admin', 'developer', 'member'], ['record_type', 'record']),
  perm('records.delete', 'records', 'Delete and merge records', 'medium', ['owner', 'admin'], ['record_type', 'record']),
  perm('records.export', 'records', 'Export records', 'medium', ['owner', 'admin'], ['record_type', 'record']),
  perm('schema.manage', 'records', 'Change record types and fields', 'high', ['owner', 'admin', 'developer'], ['record_type']),
  perm('records.reveal', 'records', 'Reveal sealed fields', 'high', ['owner', 'admin'], ['record']),
  perm('records.hold', 'records', 'Place and release holds', 'medium', ['owner', 'admin'], ['record', 'file', 'channel']),
  perm('records.share_external', 'records', 'Share records outside the Space', 'medium', ['owner', 'admin'], ['record', 'record_type']),
  // Files
  perm('files.write', 'files', 'Write files', 'low', ['owner', 'admin', 'developer', 'member'], ['file', 'folder']),
  perm('files.delete', 'files', 'Delete files', 'medium', ['owner', 'admin', 'developer', 'member'], ['file', 'folder']),
  perm('files.share_external', 'files', 'Share files outside the Space', 'medium', ['owner', 'admin'], ['file', 'folder']),
  // Chats and channels
  perm('channels.create', 'chats', 'Create channels', 'low', ['owner', 'admin', 'developer', 'member']),
  perm('channels.agents', 'chats', 'Invite agents to channels', 'low', ['owner', 'admin', 'developer', 'member'], ['channel']),
  perm('chats.private', 'chats', 'Hold private chats', 'low', ['owner', 'admin', 'developer', 'member']),
  // Agents
  perm('agents.create', 'agents', 'Create agents', 'medium', ['owner', 'admin', 'developer', 'member']),
  perm('agents.manage', 'agents', 'Manage agents', 'medium', ['owner', 'admin', 'developer'], ['agent']),
  perm('agents.schedule', 'agents', 'Schedule agent routines', 'medium', ['owner', 'admin', 'developer', 'member'], ['agent']),
  perm('computers.use', 'agents', 'Use agent computers', 'medium', ['owner', 'admin', 'developer', 'member'], ['computer']),
  perm('computers.watch', 'agents', 'Watch an agent computer', 'low', ['owner', 'admin', 'developer', 'member'], ['computer']),
  perm('computers.take_over', 'agents', 'Take over an agent computer', 'high', ['owner', 'admin', 'developer'], ['computer']),
  perm('memory.admin', 'agents', 'Open the everything memory view and erase memory', 'high', ['owner', 'admin'], ['agent']),
  // Automations
  perm('automations.personal', 'automations', 'Build personal automations', 'low', ['owner', 'admin', 'developer', 'member']),
  perm('automations.space', 'automations', 'Build Space automations', 'medium', ['owner', 'admin', 'developer'], ['automation', 'automation_group']),
  perm('campaigns.launch', 'automations', 'Launch campaigns', 'high', ['owner', 'admin'], ['campaign']),
  perm('journeys.manage', 'automations', 'Design Journeys', 'medium', ['owner', 'admin', 'developer']),
  // Comms
  perm('comms.shared_send', 'comms', 'Send from shared inboxes', 'medium', ['owner', 'admin', 'member'], ['inbox', 'mailbox']),
  perm('comms.agent_send', 'comms', 'Let agents send', 'high', ['owner', 'admin'], ['mailbox']),
  perm('comms.numbers', 'comms', 'Manage phone numbers', 'medium', ['owner', 'admin'], ['number']),
  perm('comms.domains', 'comms', 'Manage sending domains', 'medium', ['owner', 'admin'], ['domain']),
  // Vault
  perm('vault.shared_create', 'vault', 'Create shared vault items', 'medium', ['owner', 'admin', 'developer', 'member'], ['vault_folder']),
  perm('vault.reveal', 'vault', 'Reveal vault values', 'high', ['owner', 'admin'], ['vault_item']),
  perm('vault.export', 'vault', 'Export vault values as a file', 'high', ['owner', 'admin'], ['vault_folder']),
  perm('vault.policy', 'vault', 'Set vault policy', 'high', ['owner', 'admin']),
  // AI
  perm('ai.models', 'ai', 'Set allowed models and providers', 'medium', ['owner', 'admin']),
  perm('ai.spend', 'ai', 'Set spend caps', 'medium', ['owner', 'admin']),
  perm('ai.incidents', 'ai', 'Manage AI incidents', 'medium', ['owner', 'admin']),
  // Server
  perm('server.update', 'server', 'Update the server', 'high', ['owner', 'admin']),
  perm('server.logs', 'server', 'Read server logs and traces', 'medium', ['owner', 'admin', 'developer']),
  perm('server.services', 'server', 'Restart services and use the server shell', 'high', ['owner', 'admin']),
  perm('server.backups', 'server', 'Run and restore backups', 'high', ['owner', 'admin']),
  perm('server.network', 'server', 'Change domain, certificate and relay', 'high', ['owner', 'admin']),
  // Added by gap rulings
  perm('forms.publish', 'apps', 'Publish forms and booking pages', 'medium', ['owner', 'admin', 'developer', 'member'], ['form']),
  perm('sites.deploy', 'sites', 'Deploy sites to staging', 'medium', ['owner', 'admin', 'developer', 'member'], ['site']),
  perm('sites.promote', 'sites', 'Promote sites to production (Gate)', 'high', ['owner', 'admin'], ['site']),
  perm('sites.domains', 'sites', 'Manage site domains', 'medium', ['owner', 'admin'], ['site', 'domain']),
  perm('kits.install', 'kits', 'Install Kits and templates', 'high', ['owner', 'admin'], ['kit']),
  perm('kits.publish', 'kits', 'Publish Kits', 'high', ['owner', 'admin'], ['kit']),
  perm('runs.manage', 'runs', 'Stop and retry any Run', 'medium', ['owner', 'admin'], ['run']),
  perm('terminal.use', 'terminal', 'Use terminals', 'medium', ['owner', 'admin', 'developer', 'member'], ['terminal', 'computer']),
];
