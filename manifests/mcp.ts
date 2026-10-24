// mcp (lane L2): the Vyre MCP server for outside actors (Claude Code, Codex) and for CLI engine sessions, tool_search, and one-time token registration.
// Sources: ARCHITECTURE-V1.md 6.6 (one MCP server per CLI session), 6.7 (outside actors: one-time 10-minute registration, then a token, revoke is one click),
// spec 2.2 (outside actor), 3.2 flow 9, b9 (one API, toolsets). The tool list itself is generated from the capability manifests (3.7 output 6);
// this module serves it and enforces the toolset rules. Revoking a token is owned by module access (event token.revoked).
// DECISION: the same server and code serve outside actors and CLI driver sessions; only the token differs (outside-actor token or a session token
//   that encodes principal, actingFor, thread, run and trace). Every call runs as the intersection of actor and person access, through the Gate and audit.
// DECISION: scopes of an outside actor are read, post in threads, read changesets, and write on a branch (off, approval needed). Vault values are never available.
// DECISION: the one-time token lifetime is fixed by the spec at 10 minutes and is not a setting.
// DECISION: the `engineer` toolset is listed only for callers holding engineer.mcp (agents whose person is an admin or developer).
import { create, defineManifest, ev, health, read, screen, t, write } from '../packages/contracts/src/index.ts';
import { id, pageIn, pageOut } from './_common.ts';

const scopes = t.obj({ read: t.bool(), post: t.bool(), readChangesets: t.bool(), writeBranch: t.bool() });
const toolset = t.enm('records', 'files', 'memory', 'vault', 'automations', 'chats', 'inbox', 'sites', 'terminal', 'computer', 'agents', 'tasks', 'meta', 'engineer');
const toolInfo = t.obj({ name: t.str({ examples: ['records_query'] }), summary: t.str(), toolset, deferred: t.bool(), input: t.opt(t.json()) });
const sessionRow = t.obj({
  sessionId: id.session, kind: t.enm('outside', 'driver'), principal: t.str(), actingFor: t.opt(t.str()), threadId: t.opt(id.thread), runId: t.opt(id.run), name: t.opt(t.str()),
  scopes: t.opt(scopes), startedAt: t.ts(), lastCallAt: t.opt(t.ts()), calls: t.int(),
});
const tokenId = t.id('tok');

export default defineManifest({
  id: 'mcp',
  title: 'MCP',
  owner: 'L2',
  capabilities: [
    // ---- tokens
    create('mcp.token.issue', 'Issue a one-time registration token for an outside agent: works once, within 10 minutes; reveal and copy are logged', {
      in: {
        name: t.str({ examples: ['Claude Code'] }), kind: t.enm('claude_code', 'codex', 'other'), channelId: t.opt(id.channel), scopes: t.opt(scopes),
      },
      out: { tokenId, oneTimeToken: t.str(), expiresAt: t.ts(), mcpUrl: t.str({ pattern: '^https?://', examples: ['https://northwind.example.com/mcp'] }) },
      perm: 'channels.agents', level: 'use', emits: ['token.issued'], audit: 'always', risk: 'high', tool: 'meta',
      ex: { output: { tokenId: 'tok_a1b2c3', oneTimeToken: 'otk_example', expiresAt: 1760000600000, mcpUrl: 'https://northwind.example.com/mcp' } },
    }),
    write('mcp.token.register', 'Exchange a one-time token for a registered outside-actor token (called by the outside tool, not by a signed-in person)', {
      in: { oneTimeToken: t.str(), clientName: t.str(), clientVersion: t.opt(t.str()) },
      out: { actorId: id.actor, token: t.str({ description: 'The registered token; shown once' }), mcpUrl: t.str(), scopes },
      emits: ['token.registered'], audit: 'always', risk: 'high', idem: 'natural', offline: 'online',
      rate: { n: 10, perSeconds: 60, scope: 'space' }, errors: ['auth.invalid_code', 'auth.expired'],
      ex: { output: { actorId: 'act_a1b2c3', token: 'vyr_example', mcpUrl: 'https://northwind.example.com/mcp', scopes: { read: true, post: true, readChangesets: true, writeBranch: false } } },
    }),
    write('mcp.token.log_reveal', 'Log that a one-time token was revealed or copied in the connect sheet', {
      in: { tokenId, action: t.enm('reveal', 'copy') }, out: { ok: t.bool() }, emits: ['token.revealed'], audit: 'always', tool: 'engineer', idem: 'none', risk: 'low',
    }),
    write('mcp.scopes.set', 'Change the scopes of an outside actor (read, post in threads, read changesets, write on a branch with approval)', {
      in: { actorId: id.actor, scopes }, out: { scopes }, perm: 'access.manage', level: 'manage', emits: ['mcp.scopes_changed'], audit: 'always', risk: 'high', tool: 'engineer',
    }),
    // ---- sessions
    write('mcp.session.open', 'Open an MCP session from a registered token: resolves the actor, scopes and the toolsets it may list', {
      in: { token: t.str(), clientName: t.opt(t.str()) },
      out: { sessionId: id.session, principal: t.str(), actingFor: t.opt(t.str()), scopes, toolsets: t.arr(toolset) },
      emits: ['mcp.session_started'], idem: 'none', offline: 'online', risk: 'medium', errors: ['auth.unauthenticated', 'auth.expired', 'permission.revoked'],
    }),
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
    ev('token.issued', 'A one-time registration token was issued for an outside agent (never the token itself)', {
      p: { tokenId, name: t.str(), kind: t.str(), channelId: t.opt(id.channel), by: t.str(), expiresAt: t.ts() }, subject: ['entity', '/tokenId'], vis: 'participants',
    }),
    ev('token.registered', 'An outside agent registered with a one-time token and became an outside actor', {
      p: { tokenId, actorId: id.actor, name: t.str(), scopes: t.obj({ read: t.bool(), post: t.bool(), readChangesets: t.bool(), writeBranch: t.bool() }) }, subject: ['entity', '/actorId'], vis: 'participants',
    }),
    ev('token.revealed', 'A one-time token was revealed or copied', { p: { tokenId, action: t.str(), by: t.str() }, subject: ['entity', '/tokenId'], vis: 'participants', retention: 'audit' }),
    ev('mcp.scopes_changed', 'The scopes of an outside actor changed', { p: { actorId: id.actor, by: t.str() }, subject: ['entity', '/actorId'], vis: 'participants' }),
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
