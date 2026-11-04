// hooks (lane l-hooks): one hooks layer for every model. A hook runs at an event (a session starts, a message is submitted, before and after a tool, before anything leaves Vyre, a turn ends, a helper starts
// or ends) and is a command (in the agent's sandbox, exit 2 stops it), a check (a small model reads one instruction against the event on the asker's own AI account) or an action (one capability with fixed
// arguments, through the normal Gate). It belongs to a scope: the Space (admins), a person, an agent, one chat, or one run and the helpers that run starts.
// DECISION: a hook can only stop work, add a note to the model's context, or run its own action. Nothing in it approves, loosens or skips: Space hooks run first and an admin's block ends the run of hooks.
// DECISION: an agent sets hooks for itself (agent, chat and run scope) and for the helpers it starts; never Space or person hooks. An admin can turn agent-made hooks off for the Space.
// DECISION: a hook that errors or runs out of time never blocks; it is logged (hooks.runs.list) and a quiet line says so in the chat.
// DECISION: hooks.fire is the one question every engine asks: the API drivers (through the tool session), the engine around each turn, and a CLI's own built-in tools (through the vyre-hook shim). The tool
//   events of Vyre's own tools come from the tool session for every engine; a CLI reports only its built-in tools and subagents, so nothing fires twice.
import { block, defineManifest, ev, read, t, write } from '../packages/contracts/src/index.ts';
import { id } from './_common.ts';

const scope = t.enm('space', 'person', 'agent', 'chat', 'run');
const event = t.enm('session.start', 'prompt.submit', 'tool.before', 'tool.after', 'outward.before', 'turn.end', 'helper.start', 'helper.end');
const kind = t.enm('command', 'check', 'action');
const madeByKind = t.enm('admin', 'person', 'agent');
const hookRow = t.obj({
  id: t.str({ examples: ['hok_a1b2c3'] }), scope, event, kind, matcher: t.str({ description: 'A tool name, a capability or a family like mail, or a pattern; empty is every tool' }),
  line: t.str({ description: 'The plain sentence for the hook, like "before any email, check the address is in Contacts"' }), paused: t.bool(), madeBy: t.str({ description: 'Who made it: a person or agent id, or the plugin' }), madeByKind,
  threadId: t.opt(id.thread), agentId: t.opt(id.agent), helpers: t.bool({ description: 'A run hook that also reaches the helpers the run starts' }), timeoutSec: t.int({ minimum: 1, maximum: 60 }),
  createdAt: t.ts(), updatedAt: t.ts(), spec: t.json(), mine: t.bool(), canChange: t.bool({ description: 'The reader may change, pause or remove it; false for a Space hook seen by a non-admin' }), endedAt: t.opt(t.ts()),
});
const runRow = t.obj({ id: t.int(), hookId: t.str(), event: t.str(), threadId: t.opt(t.str()), agentId: t.opt(t.str()), tool: t.opt(t.str()), outcome: t.enm('ok', 'blocked', 'note', 'error', 'timeout', 'skipped', 'allowed_once'), detail: t.opt(t.str()), ms: t.int(), at: t.ts() });
const verdict = t.obj({
  block: t.nullable(t.obj({ reason: t.str(), hookId: t.str(), by: t.str(), scope: t.str() })), notes: t.arr(t.str()), ran: t.int(),
});
const setIn = {
  id: t.opt(t.str({ description: 'Give the id of a hook you made to change it' })), scope, event, kind,
  matcher: t.opt(t.str({ description: 'For tool events: a tool name, a capability, a family like mail, or a pattern. Empty is every tool', examples: ['mail.send'] })),
  command: t.opt(t.str({ description: 'For a command hook: runs in the agent\'s own sandbox with the event as JSON on stdin; exit 2 stops it and stderr is the reason' })),
  args: t.opt(t.arr(t.str(), { maxItems: 40 })),
  instruction: t.opt(t.str({ maxLength: 1000, description: 'For a check hook: one short instruction a small model reads against the event and answers allow, block with a reason, or note', examples: ['The address must be in Contacts'] })),
  cap: t.opt(t.str({ description: 'For an action hook: the one capability to call', examples: ['chat.post'] })), input: t.opt(t.json()),
  timeoutSec: t.opt(t.int({ minimum: 1, maximum: 60 })),
  summary: t.opt(t.str({ maxLength: 200, description: 'The plain sentence people read in the chat', examples: ['before any email, check the address is in Contacts'] })),
  threadId: t.opt(id.thread), agentId: t.opt(id.agent), helpers: t.opt(t.bool()), paused: t.opt(t.bool()),
};

export default defineManifest({
  id: 'hooks',
  title: 'Hooks',
  owner: 'L2',
  events: [
    ev('hook.changed', 'A hook was added, changed, removed, paused or turned back on, or an admin switched agent-made hooks', { p: { hookId: t.str(), scope: t.str(), change: t.enm('added', 'changed', 'removed', 'paused', 'resumed', 'allowed_once', 'agents_on', 'agents_off'), by: t.str(), line: t.str(), threadId: t.opt(t.str()), agentId: t.opt(t.str()) }, subject: ['entity', '/hookId'] }),
    ev('hook.admin_asked', 'Someone asked the Space admins about a hook that stopped something', { p: { hookId: t.str(), threadId: t.str(), line: t.str(), reason: t.opt(t.str()), by: t.str(), note: t.opt(t.str()) }, subject: ['thread', '/threadId'], vis: 'participants', label: 'subject', notify: 'hook.asked' }),
    ev('hook.blocked', 'A hook stopped a message, a tool call, an outward act or a helper', { p: { hookId: t.str(), event: t.str(), threadId: t.str(), agentId: t.str(), reason: t.str(), scope: t.str(), by: t.str() }, subject: ['thread', '/threadId'], vis: 'participants', label: 'subject' }),
  ],
  capabilities: [
    read('hooks.list', 'List hooks: the Space\'s, yours, and an agent\'s or one chat\'s. Each has a plain line, when it runs, what it does and who made it. Use this before you add one', {
      in: { scope: t.opt(scope), threadId: t.opt(id.thread), agentId: t.opt(id.agent) }, out: { hooks: t.arr(hookRow), agentHooks: t.bool({ description: 'false when an admin turned off hooks made by agents' }) },
      level: 'member', tool: 'agents', mcpName: 'hooks_list', agent: { planMode: 'allowed' }, errors: ['permission.no_grant'],
    }),
    write('hooks.set', 'Add or change a hook that runs at an event (before a tool, before anything leaves Vyre, a message, a turn end, a helper) as a command, a check or one action. For yourself: scope agent, chat or run. It can stop something, add a note or run its own action; never skip a rule', {
      in: setIn, out: { hook: hookRow }, level: 'member', emits: ['hook.changed'], audit: 'always', idem: 'natural',
      tool: 'agents', mcpName: 'hooks_set', agent: { planMode: 'blocked', blocks: ['hook'] }, errors: ['permission.no_grant', 'validation.bad_input', 'validation.not_found', 'permission.limit'],
    }),
    write('hooks.remove', 'Remove a hook you made', {
      in: { id: t.str(), threadId: t.opt(id.thread) }, out: { removed: t.bool() }, level: 'member', emits: ['hook.changed'], audit: 'always', idem: 'natural',
      tool: 'agents', mcpName: 'hooks_remove', agent: { planMode: 'blocked', blocks: ['hook'] }, errors: ['permission.no_grant'],
    }),
    write('hooks.pause', 'Pause a hook, or turn it back on', {
      in: { id: t.str(), paused: t.bool(), threadId: t.opt(id.thread) }, out: { hook: hookRow }, level: 'member', emits: ['hook.changed'], audit: 'always', idem: 'natural', errors: ['permission.no_grant', 'validation.not_found'],
    }),
    read('hooks.runs.list', 'What hooks did lately: which ran, what they answered, and the ones that failed or ran out of time, newest first', {
      in: { hookId: t.opt(t.str()), threadId: t.opt(id.thread), limit: t.opt(t.int({ minimum: 1, maximum: 200 })) }, out: { runs: t.arr(runRow) }, level: 'member',
      tool: 'agents', mcpName: 'hooks_runs', agent: { planMode: 'allowed' },
    }),
    read('hooks.policy.get', 'Whether agents may make hooks in this Space', { in: {}, out: { agentHooks: t.bool() }, level: 'member' }),
    write('hooks.policy.set', 'Space admins: allow or turn off hooks made by agents for the whole Space. Hooks agents already made stay but do not run while it is off', {
      in: { agentHooks: t.bool() }, out: { agentHooks: t.bool() }, level: 'member', emits: ['hook.changed'], audit: 'always', idem: 'natural', errors: ['permission.no_grant'],
    }),
    write('hooks.allow_once', 'Let a hook that stopped something go by, once, in this chat: the next time it would stop the same kind of call it lets it through. A person presses it, never an agent; a Space hook only an admin may let through. The pass ends after one use or ten minutes', {
      in: { id: t.str(), threadId: id.thread }, out: { allowed: t.bool(), expiresAt: t.ts() }, level: 'member', emits: ['hook.changed'], audit: 'always', idem: 'none', errors: ['permission.no_grant', 'validation.not_found'],
    }),
    write('hooks.ask_admin', 'Ask the Space admins about a hook that stopped something: one Inbox line for each admin, and a quiet line in the chat saying you asked', {
      in: { id: t.str(), threadId: id.thread, note: t.opt(t.str({ maxLength: 300 })) }, out: { asked: t.bool() }, level: 'member', emits: ['hook.admin_asked'], audit: 'always', idem: 'none', errors: ['validation.not_found', 'permission.no_grant'],
    }),
    write('hooks.fire', 'System: ask what the hooks say about one event. The engine, the tool session and the CLI shim call it; it returns a block with its reason, notes for the model, and how many ran. Hooks that fail or run out of time never block', {
      in: {
        event, agentId: id.agent, threadId: id.thread, asker: t.opt(id.user), turnId: t.opt(t.str()), threadKind: t.opt(t.str()), engine: t.opt(t.str()), source: t.opt(t.enm('engine', 'tools', 'cli')),
        tool: t.opt(t.str()), cap: t.opt(t.str()), input: t.opt(t.json()), output: t.opt(t.json()), ok: t.opt(t.bool()), prompt: t.opt(t.str()), title: t.opt(t.str()),
      },
      out: verdict, level: 'member', emits: ['hook.blocked'], errors: [],
    }),
  ],
  blocks: [
    block('hook', {
      threadId: id.thread, kind: t.enm('added', 'changed', 'removed', 'paused', 'resumed', 'blocked', 'failed', 'allowed', 'asked'), line: t.str(), hookId: t.opt(t.str()), scope: t.opt(t.str()), by: t.opt(t.str()), byKind: t.opt(madeByKind), reason: t.opt(t.str()), tool: t.opt(t.str()), subject: t.opt(t.str()),
    }, '{{line}}'),
  ],
});
