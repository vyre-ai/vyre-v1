// terminal (lane L2): tmux sessions on the agent computer, the Space server or a person's computer. Spec 2.7; ARCHITECTURE-V1.md 6.7, 6.11, 7.2.
// Sessions are tmux sessions (no native pty dependency); the module attaches in control mode and relays output as live frames, so a session
// survives its tab and an agent command shows as one step with Open terminal attaching the same session.
// DECISION: a terminal is bound to the Space resource at open time (the host may be a computer or a device); afterwards every capability
//   is bound to the terminal resource. Opening on an agent computer needs a Team Space; the handler refuses it in a Personal Space.
// DECISION: allow, ask and deny rules are per person per Space; an Ask rule parks the turn (turn.waiting) with a request in Needs you.
//   Ask, Allow and Auto never loosen the Gate.
// DECISION: Starred terminals are `stars` rows owned by module spaces; terminal.status gives Home the live status it shows.
// Secrets appear in commands only as #Handle.field; the executing process substitutes the value and scrubs the output (ARCHITECTURE-V1.md 6.11).
import { block, create, defineManifest, ev, health, list, read, screen, t, write } from '../packages/contracts/src/index.ts';
import { id, pageIn, pageOut } from './_common.ts';

const host = t.enm('agent_computer', 'space_server', 'device');
const termState = t.enm('running', 'idle', 'exited');
const terminalRow = t.obj({
  terminalId: id.terminal, name: t.str({ examples: ['build'] }), host, hostTitle: t.str({ examples: ["Intake's computer"] }), agentId: t.opt(id.agent), computerId: t.opt(id.computer), deviceId: t.opt(id.device),
  cwd: t.str(), state: termState, exitCode: t.nullable(t.int()), named: t.bool(), cols: t.int(), rows: t.int(), createdAt: t.ts(), lastActiveAt: t.ts(), runId: t.opt(id.run),
});
const command = t.obj({ command: t.str(), exitCode: t.nullable(t.int()), startedAt: t.ts(), durationMs: t.opt(t.int()) });
const rules = t.obj({ allow: t.arr(t.str()), ask: t.arr(t.str()), deny: t.arr(t.str()), folders: t.arr(id.folder) });
const target = { terminalId: id.terminal };
const listIn = { section: t.opt(t.enm('personal', 'shared', 'space')), folderId: t.opt(id.folder), host: t.opt(host), state: t.opt(t.arr(termState)), ...pageIn };

export default defineManifest({
  id: 'terminal',
  title: 'Terminal',
  owner: 'L2',
  lists: [
    list('terminal', 'Terminal', 'Terminals', 'terminal.list'),
  ],
  capabilities: [
    read('terminal.list', 'List terminal sessions you can see, including named leftover scripts', {
      in: listIn, out: { terminals: t.arr(terminalRow), ...pageOut }, tool: 'terminal', label: 'filter', cli: 'vyre terminal list',
    }),
    read('terminal.get', 'Read one terminal session: host, state, working folder, last exit code', {
      in: target, out: { terminal: terminalRow }, on: ['terminal', '/terminalId'], tool: 'terminal', errors: ['validation.not_found'],
    }),
    read('terminal.status', 'Live status of terminals for Home (state and last line read from tmux)', {
      in: { terminalIds: t.arr(id.terminal, { maxItems: 50 }) }, out: { rows: t.arr(t.obj({ terminalId: id.terminal, state: termState, lastLine: t.opt(t.str()), exitCode: t.nullable(t.int()) })) },
      tool: 'terminal', label: 'filter',
    }),
    create('terminal.open', 'Open a terminal session on an agent computer or on your own computer (the device daemon)', {
      in: {
        host: t.enm('agent_computer', 'device'), agentId: t.opt(id.agent), computerId: t.opt(id.computer), deviceId: t.opt(id.device), name: t.opt(t.str()),
        cwd: t.opt(t.str()), cols: t.opt(t.int({ minimum: 20, maximum: 500 })), rows: t.opt(t.int({ minimum: 5, maximum: 200 })),
      },
      out: { terminal: terminalRow }, perm: 'terminal.use', emits: ['terminal.opened'], tool: 'terminal', errors: ['permission.needs_team', 'provider.unavailable'], cli: 'vyre terminal open',
    }),
    create('terminal.open_server', 'Open a shell on the Space server (needs server.services; locked state with Ask for access otherwise)', {
      in: { name: t.opt(t.str()), cwd: t.opt(t.str()), cols: t.opt(t.int({ minimum: 20, maximum: 500 })), rows: t.opt(t.int({ minimum: 5, maximum: 200 })) },
      out: { terminal: terminalRow }, perm: 'server.services', level: 'manage', risk: 'high', audit: 'always', emits: ['terminal.opened'], tool: 'terminal',
    }),
    write('terminal.rename', 'Name a session so it can be found and starred (leftover scripts become named sessions)', {
      in: { ...target, name: t.str() }, out: { terminal: terminalRow }, on: ['terminal', '/terminalId'], emits: ['terminal.renamed'], tool: 'terminal', offline: 'patch',
    }),
    write('terminal.close', 'Close a session and kill its tmux session', {
      in: target, out: { closed: t.bool() }, on: ['terminal', '/terminalId'], level: 'edit', emits: ['terminal.closed'], tool: 'terminal', idem: 'natural', offline: 'online',
    }),
    write('terminal.input', 'Send keystrokes to a session (a person typing in the terminal tab; output returns as live frames)', {
      in: { ...target, data: t.str() }, out: { ok: t.bool() }, on: ['terminal', '/terminalId'], level: 'use', tool: 'terminal', idem: 'none', offline: 'online', risk: 'medium',
      rate: { n: 600, perSeconds: 60, scope: 'principal' },
    }),
    write('terminal.interrupt', 'Send Ctrl-C to a session', {
      in: target, out: { ok: t.bool() }, on: ['terminal', '/terminalId'], level: 'use', tool: 'terminal', idem: 'none', offline: 'online', risk: 'low',
    }),
    write('terminal.resize', 'Resize the terminal window', {
      in: { ...target, cols: t.int({ minimum: 20, maximum: 500 }), rows: t.int({ minimum: 5, maximum: 200 }) }, out: { ok: t.bool() }, on: ['terminal', '/terminalId'], level: 'use',
      idem: 'natural', offline: 'online', risk: 'low', tool: 'terminal',
    }),
    read('terminal.read', 'Read the scrollback of a session (secrets already scrubbed)', {
      in: { ...target, lines: t.opt(t.int({ minimum: 1, maximum: 5000 })), since: t.opt(t.int()) }, out: { text: t.str(), next: t.int() }, on: ['terminal', '/terminalId'], tool: 'terminal', label: 'check',
    }),
    read('terminal.attach', 'Attach to a session as a live stream; the same session an agent used, so Open terminal shows its commands', {
      in: target, out: { ticket: t.str(), expiresAt: t.ts(), replay: t.str() }, on: ['terminal', '/terminalId'], level: 'view', tool: 'terminal',
    }),
    write('terminal.run', 'Run a command in a session and wait for it (the terminal_run tool); secrets only as #Handle.field; output is scrubbed before it returns', {
      in: {
        command: t.str(), terminalId: t.opt(id.terminal), host: t.opt(t.enm('agent_computer', 'device')), agentId: t.opt(id.agent), cwd: t.opt(t.str()),
        timeoutSec: t.opt(t.int({ minimum: 1, maximum: 3600 })), env: t.opt(t.rec(t.str({ description: 'Literal or a #Handle.field reference' }))),
      },
      out: { terminalId: id.terminal, exitCode: t.nullable(t.int()), output: t.str(), truncated: t.bool(), durationMs: t.int() },
      on: ['terminal', '/terminalId'], level: 'use', perm: 'terminal.use', emits: ['terminal.opened', 'terminal.command_finished'], tool: 'terminal', mcpName: 'terminal_run',
      agent: { planMode: 'blocked', blocks: ['terminal'] }, idem: 'key', audit: 'sensitive', risk: 'high', offline: 'online',
      errors: ['permission.needs_approval', 'timeout.deadline', 'provider.unavailable'],
    }),
    read('terminal.rules.get', 'Your allow, ask and deny rules and the folders the terminal is locked to', {
      out: { rules }, tool: 'terminal',
    }),
    write('terminal.rules.set', 'Change your allow, ask and deny rules and the extra folders (a Personal Space terminal is locked to its own folder plus these)', {
      in: { rules }, out: { rules }, perm: 'terminal.use', emits: ['terminal.rules_changed'], tool: 'terminal', audit: 'sensitive', idem: 'natural', offline: 'patch',
    }),
    read('terminal.health', 'Health of tmux and the session relay on the host', {
      out: { state: t.enm('healthy', 'degraded', 'down'), detail: t.opt(t.str()), latencyMs: t.opt(t.int()), sessions: t.int() },
    }),
  ],
  events: [
    ev('terminal.opened', 'A terminal session was opened', { p: { terminalId: id.terminal, host: t.str(), agentId: t.opt(id.agent), by: t.str() }, subject: ['terminal', '/terminalId'], vis: 'participants' }),
    ev('terminal.closed', 'A terminal session was closed', { p: { terminalId: id.terminal, by: t.str() }, subject: ['terminal', '/terminalId'], vis: 'participants' }),
    ev('terminal.renamed', 'A terminal session was renamed', { p: { terminalId: id.terminal, name: t.str() }, subject: ['terminal', '/terminalId'], vis: 'participants' }),
    ev('terminal.command_finished', 'A command finished (exit code and duration only, never the command or output)', {
      p: { terminalId: id.terminal, exitCode: t.nullable(t.int()), durationMs: t.int(), by: t.str(), runId: t.opt(id.run) }, subject: ['terminal', '/terminalId'], vis: 'participants', retention: 'logs',
    }),
    ev('terminal.rules_changed', 'A person changed their terminal rules', { p: { personId: id.user }, subject: ['entity', '/personId'], vis: 'owner' }),
  ],
  blocks: [
    block('terminal', {
      terminalId: id.terminal, title: t.str(), host, hostTitle: t.str(), commands: t.arr(command), tail: t.str(), state: termState, exitCode: t.nullable(t.int()),
    }, 'Ran {{commands.length}} commands on {{hostTitle}}', {
      opens: { tab: 'terminal', input: { terminalId: '/terminalId' } },
      actions: [
        { key: 'interrupt', label: 'Interrupt', cap: 'terminal.interrupt', input: { terminalId: '/terminalId' } },
        { key: 'close', label: 'Close', cap: 'terminal.close', input: { terminalId: '/terminalId' } },
      ],
    }),
  ],
  health: [
    health('terminal', 'Terminals', 'terminal.health', 'Check that tmux is installed on the host, then reopen the session'),
  ],
  screens: [
    screen('chats.terminal-tab', 'chats', 'ui:TerminalTab', {
      slot: 'tab',
      q: { terminal: ['terminal.get', { terminalId: '/state/terminalId' }, true], attach: ['terminal.attach', { terminalId: '/state/terminalId' }, false] },
      a: {
        input: ['terminal.input', { terminalId: '/state/terminalId' }], resize: ['terminal.resize', { terminalId: '/state/terminalId' }], interrupt: ['terminal.interrupt', { terminalId: '/state/terminalId' }],
        rename: ['terminal.rename', { terminalId: '/state/terminalId' }], close: ['terminal.close', { terminalId: '/state/terminalId' }, 'Close this session?'],
      },
      empty: 'No session', primary: 'New terminal', needs: ['terminal.use'],
    }),
    screen('chats.terminal-list', 'chats', 'ui:TerminalList', {
      slot: 'popover',
      q: { terminals: ['terminal.list', { section: '/state/section', folderId: '/state/folderId', host: '/state/host' }, true] },
      a: { open: ['terminal.open', {}], openServer: ['terminal.open_server', {}] },
      empty: 'No terminals yet', primary: 'New terminal', needs: ['terminal.use'],
    }),
    screen('chats.terminal-rules', 'chats', 'ui:TerminalRules', {
      slot: 'sheet', q: { rules: ['terminal.rules.get', {}, true] }, a: { save: ['terminal.rules.set', {}] }, empty: 'No rules yet', primary: 'Add a rule', needs: ['terminal.use'],
    }),
  ],
});
