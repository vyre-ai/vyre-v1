// mcp (lane L2): the Vyre MCP server for outside agents (Claude Code, Cursor and any MCP client) and for CLI engine sessions, tool_search, and sign-in for outside agents.
// Sources: ARCHITECTURE-V1.md 6.6 (one MCP server per CLI session), 6.7, spec 2.2, 3.2 flow 9, b9 (one API, toolsets); MCP authorization (OAuth 2.1, RFC 8414, 7591, 7636, 8707, 9207, 9728).
// The tool list itself is generated from the capability manifests (3.7 output 6); this module serves it and enforces the toolset rules.
// DECISION: the same server and code serve outside agents and CLI driver sessions; only the token differs. An outside agent is a normal agent, runtime outside: every call runs as that agent acting for the person who allowed it,
//   through the same access check, Gate and audit. There is no scope list. agent/src/mcp/outside.ts keeps what stays with people.
// DECISION: Vyre is the authorization server of its own /mcp. Sign-in is a browser round trip, not a capability: modules/mcp/oauth.ts, mounted by the host at /oauth/* and /.well-known/*. A person's press is the capability mcp.oauth.allow.
// DECISION: none of the mcp.oauth and mcp.connected capabilities is a tool. An agent cannot reach them.
// DECISION: the `engineer` toolset is listed only for callers holding engineer.mcp (agents whose person is an admin or developer).
import { defineManifest, ev, health, read, screen, t, write } from '../packages/contracts/src/index.ts';
import { id, pageIn, pageOut } from './_common.ts';

const toolset = t.enm('records', 'files', 'memory', 'vault', 'automations', 'chats', 'inbox', 'sites', 'terminal', 'computer', 'agents', 'tasks', 'meta', 'engineer');
const toolInfo = t.obj({ name: t.str({ examples: ['records_query'] }), summary: t.str(), toolset, deferred: t.bool(), input: t.opt(t.json()) });
const sessionRow = t.obj({
  sessionId: id.session, kind: t.enm('outside', 'driver'), principal: t.str(), actingFor: t.opt(t.str()), threadId: t.opt(id.thread), runId: t.opt(id.run), name: t.opt(t.str()),
  startedAt: t.ts(), lastCallAt: t.opt(t.ts()), calls: t.int(), closedAt: t.opt(t.ts()), expiresAt: t.opt(t.ts()),
});
const requestId = t.id('oar');
const allowRow = t.obj({
  requestId, clientName: t.str({ description: 'What the app calls itself. Vyre has not checked it.', examples: ['Claude Code'] }), redirectHost: t.opt(t.str({ description: 'Where it goes when allowed, when that is not this computer', examples: ['tools.example.com'] })),
  spaceName: t.str(), match: t.str({ description: 'The code the tab that asked shows too', pattern: '^[0-9]{4}$', examples: ['4821'] }), expiresAt: t.ts(), rejoins: t.bool({ description: 'This app is already connected for this person' }),
});
const connectedRow = t.obj({
  agentId: id.agent, clientName: t.str(), redirectHost: t.opt(t.str()), connectedAt: t.ts(), lastSeenAt: t.opt(t.ts()), calls: t.int({ minimum: 0 }),
});
const activityRow = t.obj({
  id: t.id('mca'), tool: t.str({ examples: ['records_query'] }), cap: t.opt(t.str()), outcome: t.enm('ok', 'error', 'held'), threadId: t.opt(id.thread), taskId: t.opt(id.task), at: t.ts(),
});

export default defineManifest({
  id: 'mcp',
  title: 'MCP',
  owner: 'L2',
  capabilities: [
    // ---- sign-in: a person's press. The browser round trip around it is modules/mcp/oauth.ts
    read('mcp.oauth.request', 'An app that asked to join this Space: what it calls itself and where it goes, for the Allow sheet', {
      in: { requestId }, out: { request: allowRow }, level: 'member', errors: ['validation.not_found', 'auth.expired'], ex: { output: { request: { requestId: 'oar_a1b2c3', clientName: 'Claude Code', spaceName: 'Northwind', match: '4821', expiresAt: 1760000300000, rejoins: false } } },
    }),
    write('mcp.oauth.allow', 'A person allows an app to join: it becomes an agent they own, acting for them, and only the tab that asked can collect the sign-in', {
      in: { requestId }, out: { agentId: id.agent, name: t.str() }, level: 'member', emits: ['mcp.client_allowed'], audit: 'always', risk: 'high', idem: 'natural', offline: 'online', errors: ['validation.not_found', 'auth.expired', 'permission.no_grant'],
    }),
    write('mcp.oauth.decline', 'A person says no to an app that asked to join', {
      in: { requestId }, out: { declined: t.bool() }, level: 'member', emits: ['mcp.client_declined'], audit: 'always', idem: 'natural', risk: 'low', offline: 'online',
    }),
    write('mcp.oauth.replayed', 'System: a used code or refresh token came back, so that sign-in ended', {
      in: { agentId: id.agent, person: t.str(), why: t.str() }, out: { noted: t.bool() }, emits: ['mcp.client_replayed'], audit: 'always', idem: 'none', risk: 'medium',
    }),
    read('mcp.connected.list', 'The outside agents you connected', { out: { agents: t.arr(connectedRow) }, level: 'member' }),
    read('mcp.connected.link', 'The address to paste into an MCP app, and the one line for Claude Code', {
      out: { url: t.str({ pattern: '^https?://', examples: ['https://northwind.vyre.run/mcp'] }), claudeCode: t.str({ examples: ['claude mcp add --transport http vyre https://northwind.vyre.run/mcp'] }) }, level: 'member',
    }),
    write('mcp.connected.remove', 'Remove an outside agent: its tokens end at once, a call in flight fails, and the agent goes to Trash', {
      in: { agentId: id.agent }, out: { removed: t.bool() }, level: 'member', emits: ['mcp.client_removed'], audit: 'always', risk: 'high', idem: 'natural', offline: 'online', errors: ['validation.not_found', 'permission.no_grant'],
    }),
    read('mcp.activity.list', 'What an outside agent did: the tool, how it ended and where, never an input or an answer', {
      in: { agentId: id.agent, ...pageIn }, out: { rows: t.arr(activityRow), ...pageOut }, level: 'member', errors: ['validation.not_found'],
    }),
    // ---- sessions
    write('mcp.session.mint', 'Mint the loopback session for a CLI engine: a session token that encodes principal, acting-for person, thread, run and trace', {
      in: { principal: t.str(), actingFor: t.str(), threadId: id.thread, runId: t.opt(id.run), traceId: id.trace, ttlSec: t.opt(t.int({ minimum: 60, maximum: 86400 })) },
      out: { sessionId: id.session, sessionToken: t.str(), url: t.str({ examples: ['http://127.0.0.1:41800/mcp'] }), expiresAt: t.ts() },
      emits: ['mcp.session_started'], idem: 'none', risk: 'medium', audit: 'sensitive',
    }),
    write('mcp.session.close', 'Close an MCP session', {
      in: { sessionId: id.session }, out: { closed: t.bool() }, emits: ['mcp.session_ended'], idem: 'natural', risk: 'low', tool: 'engineer',
    }),
    read('mcp.sessions.list', 'Active and recent MCP sessions for the Console (outside actors and CLI engines)', {
      in: { kind: t.opt(t.enm('outside', 'driver')), ...pageIn }, out: { sessions: t.arr(sessionRow), ...pageOut }, perm: null, level: 'manage', tool: 'engineer',
    }),
    // ---- tools
    read('mcp.tools.list', 'Tools listed for this caller: about 60 by default; the rest are deferred and found with tool_search', {
      in: { toolset: t.opt(toolset), includeDeferred: t.opt(t.bool()) }, out: { tools: t.arr(toolInfo), total: t.int() }, tool: 'meta',
    }),
    read('mcp.tool.search', 'Find tools by what you want to do; returns names, summaries and schemas, then the tools are callable', {
      in: { query: t.str(), toolset: t.opt(toolset), limit: t.opt(t.int({ minimum: 1, maximum: 50 })) }, out: { tools: t.arr(toolInfo) },
      tool: 'meta', mcpName: 'tool_search', agent: { planMode: 'allowed' },
    }),
    read('mcp.tool.describe', 'Full schema and examples of named tools', {
      in: { names: t.arr(t.str(), { minItems: 1, maxItems: 20 }) }, out: { tools: t.arr(toolInfo) }, tool: 'meta', agent: { planMode: 'allowed' },
    }),
    read('mcp.toolsets.list', 'Toolsets the caller may use (engineer needs engineer.mcp)', {
      out: { toolsets: t.arr(t.obj({ toolset, tools: t.int(), listed: t.int(), allowed: t.bool() })) }, tool: 'meta',
    }),
    read('mcp.health', 'Health of the MCP endpoint: reachable, session count, registry hash served', {
      out: { state: t.enm('healthy', 'degraded', 'down'), detail: t.opt(t.str()), latencyMs: t.opt(t.int()), sessions: t.int(), registryHash: t.str() },
    }),
  ],
  events: [
    ev('mcp.client_allowed', 'A person allowed an app to join; it acts as the agent named (never a token)', {
      p: { agentId: id.agent, person: t.str(), clientName: t.str(), redirectHost: t.opt(t.str()) }, subject: ['agent', '/agentId'], vis: 'participants', retention: 'audit',
    }),
    ev('mcp.client_declined', 'A person said no to an app', { p: { requestId: t.str(), person: t.str(), clientName: t.str() }, subject: ['entity', '/requestId'], vis: 'participants' }),
    ev('mcp.client_removed', 'A person removed an outside agent; its sign-in ended', { p: { agentId: id.agent, by: t.str() }, subject: ['agent', '/agentId'], vis: 'participants', retention: 'audit' }),
    ev('mcp.client_replayed', 'A used code or refresh token came back, so that sign-in ended', { p: { agentId: id.agent, person: t.str(), why: t.str() }, subject: ['agent', '/agentId'], vis: 'participants', retention: 'audit' }),
    ev('mcp.session_started', 'An MCP session started', {
      p: { sessionId: id.session, kind: t.str(), principal: t.str(), actingFor: t.opt(t.str()), threadId: t.opt(id.thread) }, subject: ['entity', '/sessionId'], vis: 'participants',
    }),
    ev('mcp.session_ended', 'An MCP session ended', { p: { sessionId: id.session, calls: t.opt(t.int()) }, subject: ['entity', '/sessionId'], vis: 'participants' }),
  ],
  health: [
    health('mcp', 'MCP server', 'mcp.health', 'Open Console > Infrastructure > Health and restart the MCP service'),
  ],
  screens: [
    screen('console.mcp-sessions', 'console', 'ui:ConsoleMcpSessions', {
      q: { sessions: ['mcp.sessions.list', { kind: '/filter/kind' }, true] },
      a: { close: ['mcp.session.close', { sessionId: '/state/sessionId' }, 'Close this session?'] },
      empty: 'No MCP sessions', primary: 'Close', needs: ['console.access'],
    }),
  ],
});
