// chat (lane L2): threads, channels, messages, canonical transcript, Ask panes, helpers, plan and question blocks.
// Sources: ARCHITECTURE-V1.md 4.13, 6.1, 6.2 (queue rows are written by engine), 6.8, 6.9, 7.2; spec 2.5, 3.2, 4.6, 4.13, 4.14.
// The turn engine lives in module engine; this module owns what people see and write: threads, channels, messages, blocks.
// DECISION: a channel is a thread of kind 'channel' with a channel id; messages always carry the thread id. Authorize treats a
//   thread whose kind is channel as the channel resource, so grants on the channel cover its threads and messages.
// DECISION: private chats and Ask panes carry enc=2 per row (messages, thread rows); the entity cannot mix per-row encryption, so
//   the EntityDefs below set e2e 'none' and the row-level `enc` column decides. NOT EXPRESSIBLE: per-row e2e on a mixed entity.
// DECISION: capability names for K-list verbs are kept verbatim: chat.post chat.start chat.thread chat.answer_block chat.approve_plan
//   threads.make_channel channels.create channels.connect_outside_agent; so no `chat.thread.*` names exist (prefix rule).
// DECISION: capabilities backing agent tools carry mcpName equal to the tool name (see module agents agentTools); one tool is generated.
import { block, create, defineManifest, entity, ev, list, read, screen, setting, t, write } from '../packages/contracts/src/index.ts';
import { blockSchema, id, level, pageIn, pageOut, principalRef, purgeOut } from './_common.ts';

const threadKind = t.enm('chat', 'channel', 'thread', 'ask', 'run', 'helper', 'console');
const agentMode = t.enm('lead', 'listen');
const effort = t.enm('low', 'medium', 'high', 'max');
const chatMode = t.enm('ask', 'auto', 'plan');
const threadAgent = t.obj({
  agentId: id.agent, mode: agentMode, model: t.opt(t.str({ examples: ['claude-sonnet-5-5'] })), provider: t.opt(t.str({ examples: ['anthropic'] })),
  effort: t.opt(effort), accountRef: t.opt(t.str({ description: 'Vault handle or subscription account reference; never a secret' })), watches: t.opt(t.bool()),
});
const threadRow = t.obj({
  threadId: id.thread, kind: threadKind, title: t.opt(t.str()), starter: t.opt(t.str()), channelId: t.opt(id.channel),
  parentThreadId: t.opt(id.thread), parentMessageId: t.opt(id.message), recordId: t.opt(id.record), folderId: t.opt(id.folder),
  scopeType: t.opt(t.str({ examples: ['record'] })), scopeId: t.opt(t.str()), listed: t.bool(), planMode: t.bool(), mode: t.opt(chatMode),
  members: t.arr(principalRef), agents: t.arr(threadAgent), createdAt: t.ts(), closedAt: t.opt(t.ts()),
  replyCount: t.opt(t.int({ minimum: 0, description: 'Messages in the thread that are not deleted' })), lastMessageAt: t.opt(t.ts()),
  path: t.opt(t.arr(t.obj({ title: t.str(), threadId: id.thread }), { description: 'Address bar parts for helper chats, each a link back' })),
});
const historyHit = t.obj({
  source: t.enm('message', 'step'), ref: t.str({ examples: ['msg_a1b2c3'] }), messageId: t.opt(id.message), threadId: id.thread, threadTitle: t.opt(t.str()), threadKind: t.str(), seq: t.int(),
  role: t.str({ examples: ['person'] }), author: principalRef, text: t.str(), truncated: t.opt(t.bool()), at: t.ts(), link: t.str({ examples: ['vyre://thread/thr_a1b2c3?m=msg_a1b2c3'] }), score: t.num(),
});
const reaction = t.obj({ emoji: t.str({ examples: ['thumbs_up'] }), by: t.arr(t.str()) });
const messageRow = t.obj({
  messageId: id.message, threadId: id.thread, threadSeq: t.int(), author: principalRef,
  kind: t.enm('text', 'agent', 'system', 'quiet'), body: t.str(), blocks: t.arr(blockSchema), replyTo: t.opt(id.message),
  via: t.opt(t.obj({ routineOwner: id.user })), depth: t.int({ minimum: 0 }), attachments: t.arr(id.file), reactions: t.arr(reaction),
  pinned: t.bool(), editedAt: t.opt(t.ts()), createdAt: t.ts(), enc: t.opt(t.int({ minimum: 0, maximum: 2 })),
});
const channelRow = t.obj({
  channelId: id.channel, mainThreadId: id.thread, name: t.str({ examples: ['intake'] }), topic: t.opt(t.str()), visibility: t.enm('public', 'invite'),
  folderId: t.opt(id.folder), recordId: t.opt(id.record), archived: t.bool(), members: t.arr(principalRef), agents: t.arr(threadAgent),
  unread: t.int(), createdAt: t.ts(), restricted: t.opt(t.bool()),   // Console only: an invite-only channel the admin is not in; they can archive it and change who is in it, not read it
});
const recentRow = t.obj({
  threadId: id.thread, kind: threadKind, title: t.str(), agents: t.arr(id.agent), unread: t.int(), working: t.bool(), starred: t.bool(),
  lastAt: t.ts(), preview: t.opt(t.str()),
});
const mention = t.obj({ kind: t.enm('person', 'agent'), id: t.str({ examples: ['usr_a1b2c3'] }) });
const screenObject = t.obj({ type: t.str({ examples: ['record'] }), id: t.str({ examples: ['rec_a1b2c3'] }), title: t.opt(t.str()) });
// What a place tells the agent about the screen the message was sent from (agent/src/turn-engine/context.ts ScreenContext): ids, titles and short summaries, never content. The agent reads the objects through its tools, as the asker.
const screenContext = t.obj({
  place: t.str({ examples: ['records'], description: 'home, chats, inbox, records, files, apps, automations, vault, console, projects, agents, tasks, calendar' }), title: t.opt(t.str()),
  open: t.opt(t.arr(screenObject)), selection: t.opt(t.arr(screenObject)), filters: t.opt(t.rec()),
  rows: t.opt(t.obj({ shown: t.int({ minimum: 0 }), total: t.opt(t.int({ minimum: 0 })), sample: t.opt(t.arr(t.str())) })),
  actions: t.opt(t.arr(t.str())), focus: t.opt(t.str({ description: 'Name of the focus skill the place asks for' })),
});
const planStep = t.obj({ stepId: t.id('stp'), text: t.str(), state: t.enm('todo', 'doing', 'done', 'skipped'), detail: t.opt(t.str()) });
const option = t.obj({ key: t.str(), label: t.str(), detail: t.opt(t.str()) });
const transcriptHit = t.obj({ turnId: id.turn, threadId: id.thread, idx: t.int(), role: t.enm('user', 'assistant', 'tool', 'system'), snippet: t.str(), at: t.ts(), link: t.str() });
const searchHit = t.obj({
  messageId: id.message, threadId: id.thread, threadSeq: t.int({ minimum: 0 }), author: principalRef, snippet: t.str(), at: t.ts(),
  score: t.num({ description: '0 to 1; higher is a better match' }), found: t.enm('keyword', 'meaning', 'both'),
  thread: t.obj({ kind: threadKind, title: t.opt(t.str()), channelName: t.opt(t.str()), agentIds: t.arr(id.agent), memberIds: t.arr(t.str()) }),
});
const threadT = { threadId: id.thread };
const channelT = { channelId: id.channel };
const streamKind = t.enm('people', 'agents', 'runs');
const streamItem = t.obj({
  kind: t.enm('message', 'run', 'run_group'), at: t.ts(), messageId: t.opt(id.message), authorKind: t.opt(t.enm('person', 'agent', 'actor')),
  runId: t.opt(id.run), runKind: t.opt(t.str({ examples: ['automation'] })), name: t.opt(t.str()),
  status: t.opt(t.enm('queued', 'running', 'waiting', 'succeeded', 'failed', 'stopped')), result: t.opt(t.str()), durationMs: t.opt(t.int({ minimum: 0 })),
  groupKey: t.opt(t.str({ description: 'Same flow, runs next to each other' })), count: t.opt(t.int({ minimum: 2 })), anyFailed: t.opt(t.bool()), runIds: t.opt(t.arr(id.run)),
});
const listIn = { section: t.opt(t.enm('personal', 'shared', 'space')), folderId: t.opt(id.folder), ...pageIn };
// `governance`: Console also lists the invite-only channels the caller is not in but may govern, marked restricted
const channelListIn = { ...listIn, governance: t.opt(t.bool()) };

export default defineManifest({
  id: 'chat',
  title: 'Chat',
  owner: 'L2',
  entities: [
    entity('message', 'chat_message', 'msg_', {
      thread: 'text', threadSeq: 'number', author: 'text', kind: 'choice', body: 'text', blocks: 'longtext', replyTo: 'text', via: 'text',
      depth: 'number', attachments: 'files', pinned: 'checkbox', reactions: 'multichoice', editedAt: 'datetime', createdAt: 'datetime',
    }, 'thread', { parent: { entity: 'thread', field: 'thread' }, parentField: 'thread', fts: ['body'], sync: { window: { days: 90 }, profile: { desktop: 'all', phone: 'window', web: 'all' } } }),
    entity('thread', 'chat_thread', 'thr_', {
      kind: 'choice', title: 'text', starter: 'person', recordId: 'text', folderId: 'text', scopeType: 'text', scopeId: 'text', channelId: 'text',
      parentThreadId: 'text', parentMessageId: 'text', listed: 'checkbox', modePlan: 'checkbox', createdAt: 'datetime', closedAt: 'datetime',
    }, 'thread', { ownerField: 'starter', fts: ['title'], sync: { window: { recentCount: 200, starred: true } } }),
    entity('thread_member', 'chat_thread_member', 'thm_', { thread: 'text', principal: 'text', role: 'choice' }, 'thread', { parent: { entity: 'thread', field: 'thread' }, parentField: 'thread' }),
    entity('thread_agent', 'chat_thread_agent', 'tha_', {
      thread: 'text', agentId: 'text', mode: 'choice', model: 'text', provider: 'text', effort: 'choice', accountRef: 'text', addedBy: 'text', watches: 'checkbox',
    }, 'thread', { parent: { entity: 'thread', field: 'thread' }, parentField: 'thread' }),
  ],
  lists: [
    list('channel', 'Channel', 'Channels', 'channels.list'),
  ],
  capabilities: [
    // ---- erase and purge (P-CC_39)
    write('threads.erase', 'Erase one chat thread for good: messages, blocks, pins, reactions, attachment links, transcript rows, summaries and search entries (governance erase)', { level: 'manage', perm: 'policy.manage', idem: 'key', in: { threadId: id.thread }, out: { erased: t.bool() }, emits: ['thread.erased'], audit: 'always', risk: 'high' }),
    write('channels.erase', 'Erase one channel for good with all its messages (governance erase)', { level: 'manage', perm: 'policy.manage', idem: 'key', in: { channelId: id.channel }, out: { erased: t.bool() }, emits: ['channel.erased'], audit: 'always', risk: 'high' }),
    write('chat.transcript.purge', 'Remove messages and blocks older than a time from chats and channels, a batch at a time; threads listed in skipThreadIds (held ones) are left whole (retention)', { level: 'manage', perm: 'policy.manage', idem: 'key', in: { before: t.ts(), limit: t.opt(t.int({ minimum: 1, maximum: 5000 })), skipThreadIds: t.opt(t.arr(id.thread)) }, out: purgeOut, emits: ['transcripts.purged', 'thread.erased'], audit: 'always', risk: 'high' }),
    // ---- threads and chats
    create('chat.start', 'Start a chat or an Ask pane with one or more agents, or a direct message with one person (a third person means a channel)', {
      in: {
        kind: t.enm('chat', 'ask'), agentIds: t.arr(id.agent), personId: t.opt(id.user), title: t.opt(t.str()), scopeType: t.opt(t.str()), scopeId: t.opt(t.str()),
        folderId: t.opt(id.folder), recordId: t.opt(id.record), model: t.opt(t.str()), provider: t.opt(t.str()), effort: t.opt(effort), first: t.opt(t.str({ description: 'First message body' })),
      },
      out: { thread: threadRow }, perm: 'chats.private', emits: ['thread.started', 'agent.engaged', 'message.received', 'message.direct', 'thread.unarchived'], tool: 'chats', offline: 'queue', cli: 'vyre chat start',
    }),
    create('chat.fork', 'Branch a chat at one message: a new private chat that holds a copy of everything up to there, with the same agents and a line that links back', {
      in: { ...threadT, messageId: t.opt(id.message), title: t.opt(t.str()) }, out: { thread: threadRow, copied: t.int({ minimum: 0 }) },
      perm: 'chats.private', emits: ['thread.started', 'agent.engaged'], tool: 'chats', offline: 'queue', cli: 'vyre chat fork', errors: ['validation.precondition_failed'],
    }),
    write('chat.thread', 'Open or create the inline thread under a message; an @mentioned agent works inside it', {
      in: { threadId: id.thread, messageId: id.message }, out: { thread: threadRow }, on: ['thread', '/threadId'], level: 'use',
      emits: ['thread.started'], tool: 'chats', offline: 'queue', idem: 'natural',
    }),
    read('threads.get', 'Read one thread with its members, agents, modes, plan mode and (for helpers) the address bar path', {
      in: threadT, out: { thread: threadRow }, on: ['thread', '/threadId'], tool: 'chats', label: 'check',
    }),
    read('threads.list', 'List threads by kind, folder, scope or record', {
      in: { kind: t.opt(t.arr(threadKind)), folderId: t.opt(id.folder), recordId: t.opt(id.record), parentThreadId: t.opt(id.thread), ...pageIn },
      out: { threads: t.arr(threadRow), ...pageOut }, tool: 'chats', label: 'filter',
    }),
    write('threads.update', 'Rename a thread', {
      in: { ...threadT, title: t.str() }, out: { thread: threadRow }, on: ['thread', '/threadId'], emits: ['thread.updated'], tool: 'chats', offline: 'patch',
    }),
    write('threads.set_folder', 'Set the thread work folder (the folder chip above the composer)', {
      in: { ...threadT, folderId: t.nullable(id.folder) }, out: { thread: threadRow }, on: ['thread', '/threadId'], emits: ['thread.updated'], tool: 'chats', offline: 'patch',
    }),
    write('threads.set_plan_mode', 'Switch plan mode for a thread: the agent may read and plan but changes nothing until a plan is approved', {
      in: { ...threadT, planMode: t.bool() }, out: { thread: threadRow }, on: ['thread', '/threadId'], level: 'use', emits: ['thread.updated', 'thread.plan_mode_changed'], tool: 'chats', offline: 'queue',
    }),
    write('threads.set_mode', 'Set how much the agents of a chat may do alone: auto (the default), ask (Ask first) or plan. Anything that leaves Vyre is held for a yes in every mode', {
      in: { ...threadT, mode: chatMode }, out: { thread: threadRow }, on: ['thread', '/threadId'], level: 'use', emits: ['thread.updated', 'thread.plan_mode_changed'], tool: 'chats', offline: 'queue', idem: 'natural',
    }),
    write('threads.agent.configure', 'Pick the model, provider, effort or account an agent answers with, for this chat or as the agent default; null clears a field', {
      in: {
        ...threadT, agentId: id.agent, model: t.opt(t.nullable(t.str())), provider: t.opt(t.nullable(t.str())), effort: t.opt(t.nullable(effort)), accountRef: t.opt(t.nullable(t.str())),
        scope: t.opt(t.enm('chat', 'agent')),
      },
      out: { thread: threadRow }, on: ['thread', '/threadId'], level: 'use', emits: ['thread.updated'], tool: 'chats', offline: 'queue', idem: 'natural', errors: ['validation.not_found', 'validation.bad_input'],
    }),
    write('threads.close', 'Close a thread (idle with nothing waiting, or done)', {
      in: threadT, out: { thread: threadRow }, on: ['thread', '/threadId'], emits: ['thread.closed'], tool: 'chats',
    }),
    write('threads.reopen', 'Reopen a closed thread', {
      in: threadT, out: { thread: threadRow }, on: ['thread', '/threadId'], emits: ['thread.reopened'], tool: 'chats',
    }),
    write('threads.archive', 'Archive a chat for me: it leaves my list and waits in my Archived section; the others in a group chat still see it. New messages do not bring it back, an @mention of me does', {
      in: threadT, out: { archived: t.bool() }, on: ['thread', '/threadId'], level: 'view', emits: ['thread.archived'], tool: 'chats', offline: 'queue', idem: 'natural', risk: 'low',
      agent: { planMode: 'blocked' }, errors: ['validation.bad_input'],
    }),
    write('threads.unarchive', 'Put an archived chat back in my list', {
      in: threadT, out: { archived: t.bool() }, on: ['thread', '/threadId'], level: 'view', emits: ['thread.unarchived'], tool: 'chats', offline: 'queue', idem: 'natural', risk: 'low',
      agent: { planMode: 'blocked' }, errors: ['validation.bad_input'],
    }),
    write('threads.delete', 'Delete a chat only I am in (me and agents): hidden everywhere, running turns stop first, undone with threads.restore until the retention purge removes it. A chat with other people is left, not deleted', {
      in: threadT, out: { deleted: t.bool() }, on: ['thread', '/threadId'], level: 'view', emits: ['thread.deleted'], audit: 'always', risk: 'medium', idem: 'natural', offline: 'online',
      agent: false, errors: ['validation.bad_input', 'validation.precondition_failed'],
    }),
    write('threads.restore', 'Undo the delete of my chat (the Undo toast), while it has not been purged', {
      in: threadT, out: { thread: threadRow }, on: ['thread', '/threadId'], level: 'view', emits: ['thread.restored'], audit: 'always', risk: 'low', idem: 'natural', offline: 'online', agent: false,
    }),
    write('threads.leave', 'Leave a chat that has other people in it: I stop being a member, they keep it. A channel is left with channels.leave', {
      in: threadT, out: { ok: t.bool() }, on: ['thread', '/threadId'], level: 'view', emits: ['channel.member_removed'], audit: 'sensitive', risk: 'medium', idem: 'natural', offline: 'online',
      agent: false, errors: ['validation.bad_input'],
    }),
    write('threads.mark_read', 'Mark a thread read up to a sequence number', {
      in: { ...threadT, upto: t.opt(t.int()) }, out: { unread: t.int() }, on: ['thread', '/threadId'], level: 'view', tool: 'chats', offline: 'queue', idem: 'natural', risk: 'low',
    }),
    write('threads.add_agent', 'Add an agent to a thread as listening (or leading when it is the only agent)', {
      in: { ...threadT, agentId: id.agent, mode: t.opt(agentMode) }, out: { thread: threadRow }, on: ['thread', '/threadId'], perm: 'channels.agents',
      emits: ['agent.engaged'], tool: 'chats', errors: ['validation.precondition_failed'],
    }),
    write('threads.remove_agent', 'Remove an agent from a thread', {
      in: { ...threadT, agentId: id.agent }, out: { thread: threadRow }, on: ['thread', '/threadId'], perm: 'channels.agents', emits: ['agent.disengaged'], tool: 'chats',
    }),
    write('threads.members.add', 'Add a person to a thread; a private chat never gains people, so this offers a channel instead', {
      in: { ...threadT, personId: id.user }, out: { thread: threadRow }, on: ['thread', '/threadId'], emits: ['channel.member_added'], tool: 'chats',
      errors: ['validation.precondition_failed'],
    }),
    write('threads.members.remove', 'Remove a person from a thread', {
      in: { ...threadT, personId: id.user }, out: { thread: threadRow }, on: ['thread', '/threadId'], emits: ['channel.member_removed'], tool: 'chats',
    }),
    create('threads.make_channel', 'Make a private chat into a channel with another person; the new channel links back to the chat', {
      in: { ...threadT, personId: id.user, name: t.opt(t.str()) }, out: { channel: channelRow }, make: ['thread', '/threadId'],
      perm: 'channels.create', emits: ['channel.created', 'thread.promoted', 'channel.agent_added', 'channel.member_added'], tool: 'chats',
    }),
    // ---- Ask panes
    read('chat.asks_of', 'Ask panes opened on one object (the pane history of a record, file, event, page, site or automation)', {
      in: { resourceType: t.str({ examples: ['record'] }), resourceId: t.str(), ...pageIn }, out: { threads: t.arr(threadRow), ...pageOut }, tool: 'chats', label: 'filter',
    }),
    write('chat.open_as_chat', 'Open an Ask pane as a normal chat so it appears in Recent', {
      in: threadT, out: { thread: threadRow }, on: ['thread', '/threadId'], emits: ['thread.updated'], tool: 'chats', offline: 'patch',
    }),
    read('chat.ask_level', 'The level the caller has on the object an Ask pane is about (view, use, edit or manage), null when none: the Ask pane\'s tools never go past it', {
      in: threadT, out: { level: t.nullable(t.enm('view', 'use', 'edit', 'manage')) }, on: ['thread', '/threadId'], tool: 'chats', label: 'check',
    }),
    read('chat.ask_suggest', 'Suggested agent for an Ask pane: the agent that booked the event, else the contact agent, else the person last used', {
      in: { scopeType: t.str(), scopeId: t.str() }, out: { agentId: t.nullable(id.agent), reason: t.enm('booked_by', 'contact_agent', 'last_used', 'none') }, tool: 'chats',
    }),
    // ---- messages
    write('chat.post', 'Post a message in a thread or channel; routes to the lead agent or @mentioned agents and records mentions', {
      in: {
        ...threadT, body: t.str(), blocks: t.opt(t.arr(t.obj({ type: t.str(), v: t.int({ minimum: 1 }), data: t.json() }))), attachments: t.opt(t.arr(id.file)),
        replyTo: t.opt(id.message), mentions: t.opt(t.arr(mention)), via: t.opt(t.obj({ routineOwner: id.user })), clientId: t.opt(id.message),
        screen: t.opt(screenContext),
      },
      out: { message: messageRow }, on: ['thread', '/threadId'], level: 'use', idem: 'key',
      emits: ['message.received', 'message.mentioned', 'message.direct', 'thread.replied', 'thread.unarchived', 'agent.engaged'], tool: 'chats', offline: 'queue', hook: true, cli: 'vyre chat post',
      rate: { n: 120, perSeconds: 60, scope: 'principal' }, errors: ['permission.plan_mode', 'permission.limit'],
    }),
    read('chat.screen.get', 'The screen context the person sent with a message (or the latest in the thread): the place, open objects, selection, filters and a summary of visible rows', {
      in: { ...threadT, messageId: t.opt(id.message) }, out: { screen: t.nullable(screenContext), messageId: t.opt(id.message) }, on: ['thread', '/threadId'], tool: 'chats', label: 'check',
    }),
    write('chat.edit', 'Edit the text of a message you wrote', {
      in: { messageId: id.message, threadId: id.thread, body: t.str() }, out: { message: messageRow }, on: ['thread', '/threadId'], level: 'use',
      emits: ['message.edited'], tool: 'chats', offline: 'patch',
    }),
    write('chat.delete_message', 'Delete a message you wrote (kept in the audit trail)', {
      in: { messageId: id.message, threadId: id.thread }, out: { deleted: t.bool() }, on: ['thread', '/threadId'], level: 'use',
      emits: ['message.deleted'], tool: 'chats', offline: 'queue', audit: 'sensitive', errors: ['permission.on_hold'],
    }),
    write('chat.react', 'Add or remove a reaction', {
      in: { messageId: id.message, threadId: id.thread, emoji: t.str(), remove: t.opt(t.bool()) }, out: { reactions: t.arr(reaction) }, on: ['thread', '/threadId'], level: 'use',
      emits: ['message.reacted'], tool: 'chats', offline: 'patch', idem: 'natural', risk: 'low',
    }),
    write('chat.make_task', 'Turn a message into a task: the title is its first line, the task points back at it and a "Task created" card in the thread links to the task. An agent may do it for the person it acts for', {
      in: { ...threadT, messageId: id.message, title: t.opt(t.str()), assigneeId: t.opt(t.str({ description: 'A person or an agent in this chat; default the asker' })) },
      out: { taskId: id.task, messageId: id.message }, on: ['thread', '/threadId'], level: 'use', idem: 'key', tool: 'chats', offline: 'online', risk: 'low',
      agent: { planMode: 'blocked' }, errors: ['validation.bad_input', 'validation.not_found'],
    }),
    write('chat.share', 'Share a message to another chat (a channel or a person): a card there carries it, and a card here says where it went; both open the other chat. You must be able to write in the chat it goes to', {
      in: { ...threadT, messageId: id.message, toThreadId: id.thread, to: t.opt(t.str({ description: 'A name for the place it went (a channel name); default the chat itself' })) },
      out: { messageId: id.message, toThreadId: id.thread },
      on: ['thread', '/threadId'], level: 'use', idem: 'key', tool: 'chats', offline: 'online', risk: 'low', agent: { planMode: 'blocked' }, errors: ['validation.bad_input', 'validation.not_found', 'validation.precondition_failed'],
    }),
    write('chat.flow_card', 'Leave the card of a drafted Flow in its chat: its name, what it does in plain words and Turn on and Test buttons. Written by the server from the draft itself; only a draft gets one', {
      in: { ...threadT, automationId: id.automation }, out: { messageId: id.message }, on: ['thread', '/threadId'], level: 'use', idem: 'key', tool: 'chats', offline: 'online', risk: 'low',
      agent: { planMode: 'blocked' }, errors: ['validation.bad_input', 'validation.not_found'],
    }),
    write('chat.aside', 'Ask a side question (/btw) while an agent works: it runs as a separate short read-only turn on your own account with what this chat knows, in a hidden thread; nothing is written into this chat and the agent working here does not see it', {
      in: { ...threadT, question: t.str({ description: 'The question, up to 2000 characters' }) }, out: { asideThreadId: id.thread, messageId: id.message },
      on: ['thread', '/threadId'], level: 'use', idem: 'key', tool: 'chats', offline: 'online', risk: 'low', emits: ['thread.started', 'message.received', 'message.direct', 'message.mentioned', 'thread.replied', 'thread.unarchived'],
      agent: { planMode: 'blocked' }, errors: ['validation.bad_input', 'validation.not_found'],
    }),
    write('chat.aside_keep', 'Keep the answer of an aside: it is posted into the chat it came from as one card from you', {
      in: { asideThreadId: id.thread }, out: { messageId: id.message },
      on: ['thread', '/asideThreadId'], level: 'use', idem: 'key', tool: 'chats', offline: 'online', risk: 'low',
      agent: { planMode: 'blocked' }, errors: ['validation.bad_input', 'validation.not_found', 'validation.precondition_failed'],
    }),
    write('chat.remember', 'Remember a message as a fact in the memory of the project this chat belongs to (else your own), sourced to the message; a "Remembered for ..." card in the thread links to the fact. A shared layer keeps its review rule', {
      in: { ...threadT, messageId: id.message, text: t.opt(t.str({ description: 'The words to keep; default the message' })) },
      out: { factId: id.fact, layer: t.enm('project', 'person'), merged: t.bool(), projectId: t.opt(id.project), projectTitle: t.opt(t.str()), by: t.str() },
      on: ['thread', '/threadId'], level: 'use', idem: 'key', tool: 'chats', offline: 'online', risk: 'low', agent: { planMode: 'blocked' }, errors: ['validation.bad_input', 'validation.not_found', 'permission.provider_label'],
    }),
    write('chat.pin', 'Mark a message as pinned (a content marker, not a Star)', {
      in: { messageId: id.message, threadId: id.thread }, out: { pinned: t.bool() }, on: ['thread', '/threadId'], emits: ['message.pinned'], tool: 'chats', offline: 'patch', idem: 'natural',
    }),
    write('chat.unpin', 'Remove the pinned marker from a message', {
      in: { messageId: id.message, threadId: id.thread }, out: { pinned: t.bool() }, on: ['thread', '/threadId'], emits: ['message.pinned'], tool: 'chats', offline: 'patch', idem: 'natural',
    }),
    read('chat.messages.list', 'Messages of a thread by sequence window (last 50 first, older stream in)', {
      in: { ...threadT, before: t.opt(t.int()), after: t.opt(t.int()), limit: t.opt(t.int({ minimum: 1, maximum: 200 })) },
      out: { messages: t.arr(messageRow), hasMore: t.bool() }, on: ['thread', '/threadId'], tool: 'chats', label: 'filter',
    }),
    read('chat.catch_up', 'What you missed in a thread since you last read it: counts, who wrote, tasks and decisions that landed, and messages with an @ in them. A plain read, kept until something new arrives', {
      in: threadT,
      out: {
        unread: t.int(), since: t.int(), top: t.int(), firstMessageId: t.opt(id.message),
        people: t.arr(t.obj({ id: t.str(), count: t.int() })), tasks: t.arr(t.obj({ messageId: id.message, title: t.str() })),
        decisions: t.arr(t.obj({ messageId: id.message, text: t.str() })), at: t.arr(t.obj({ messageId: id.message, author: t.str(), text: t.str() })),
      },
      on: ['thread', '/threadId'], tool: 'chats', label: 'check',
    }),
    read('chat.message.get', 'Read one message with its blocks', {
      in: { ...threadT, messageId: id.message }, out: { message: messageRow }, on: ['thread', '/threadId'], tool: 'chats', label: 'check',
    }),
    read('chat.pins.list', 'Pinned messages of a thread', {
      in: threadT, out: { messages: t.arr(messageRow) }, on: ['thread', '/threadId'], tool: 'chats', label: 'filter',
    }),
    read('chat.recent', 'Sidebar Recent: Starred, Today, Yesterday, Earlier with unread counts and the working pulse, then the chats I archived (they are in no other group)', {
      in: { filter: t.opt(t.enm('all', 'unread', 'people', 'agents')) },
      out: { starred: t.arr(recentRow), today: t.arr(recentRow), yesterday: t.arr(recentRow), earlier: t.arr(recentRow), archived: t.arr(recentRow), nextUnread: t.nullable(id.thread) }, tool: 'chats', label: 'filter',
    }),
    read('chat.composer.suggest', 'Composer symbol tables: @ people and agents, # folders, channels, records and files, / commands, skills and templates', {
      in: { symbol: t.enm('@', '#', '/'), q: t.str(), threadId: t.opt(id.thread) },
      out: { items: t.arr(t.obj({ group: t.str(), kind: t.str(), id: t.str(), title: t.str(), detail: t.opt(t.str()) })) }, tool: 'chats', label: 'filter',
    }),
    read('chat.search', 'Search the messages of every chat and channel you are in, by the words and by meaning; each hit names its message so a screen can jump to it', {
      in: { q: t.str(), mode: t.opt(t.enm('keyword', 'meaning', 'hybrid')), threadId: t.opt(id.thread), limit: t.opt(t.int({ minimum: 1, maximum: 50 })) },
      out: { hits: t.arr(searchHit), meaning: t.bool(), sealedChats: t.int({ minimum: 0, description: 'End-to-end chats the server cannot read, left out' }), tookMs: t.int({ minimum: 0 }) },
      tool: 'chats', label: 'filter', mcpName: 'chat_search', agent: { planMode: 'allowed' }, rate: { n: 60, perSeconds: 60, scope: 'principal' },
    }),
    // ---- native blocks, plan mode
    write('chat.answer_block', 'Answer a question or plan block; the answer is queued as a wake so the parked turn continues', {
      in: { ...threadT, blockId: id.block, answer: t.json() }, out: { ok: t.bool() }, on: ['thread', '/threadId'], level: 'use',
      emits: ['block.answered'], tool: 'chats', offline: 'queue', errors: ['validation.precondition_failed'],
    }),
    write('chat.question.ask', 'Ask the person a structured question (single, multi or free text); the turn parks until it is answered', {
      in: {
        ...threadT, prompt: t.str(), mode: t.enm('single', 'multi', 'free'), options: t.opt(t.arr(option)), allowOther: t.opt(t.bool()),
        card: t.opt(t.obj({ kind: t.enm('terminal'), command: t.str(), host: t.opt(t.enm('agent_computer', 'space_server', 'device')), risk: t.opt(t.enm('read', 'change', 'danger')) })),
      },
      out: { blockId: id.block, messageId: id.message }, on: ['thread', '/threadId'], level: 'use', emits: ['message.received', 'block.waiting', 'thread.unarchived'],
      tool: 'chats', mcpName: 'ask_question', agent: { planMode: 'allowed', blocks: ['question'] },
    }),
    write('chat.plan.propose', 'Propose a plan with steps as a plan block; used when plan mode is on', {
      in: { ...threadT, title: t.str(), steps: t.arr(t.obj({ text: t.str(), detail: t.opt(t.str()) }), { minItems: 1 }), docFileId: t.opt(id.file) },
      out: { planId: id.plan, blockId: id.block }, on: ['thread', '/threadId'], level: 'use', emits: ['plan.proposed', 'message.received', 'block.waiting', 'thread.unarchived'],
      tool: 'chats', mcpName: 'plan_propose', agent: { planMode: 'allowed', blocks: ['plan'] },
    }),
    write('chat.approve_plan', 'Approve a plan, optionally with edits; clears plan mode for those steps and the agent executes', {
      in: { ...threadT, planId: id.plan, edits: t.opt(t.arr(t.obj({ stepId: t.id('stp'), text: t.opt(t.str()), remove: t.opt(t.bool()) }))) },
      out: { plan: t.obj({ planId: id.plan, state: t.str(), steps: t.arr(planStep) }) }, on: ['thread', '/threadId'], level: 'use', emits: ['plan.approved', 'block.answered', 'thread.plan_mode_changed'],
      tool: 'chats', offline: 'queue', errors: ['validation.precondition_failed'],
    }),
    write('chat.plan.reject', 'Reject a plan with a note; the agent stays in plan mode', {
      in: { ...threadT, planId: id.plan, note: t.opt(t.str()) }, out: { ok: t.bool() }, on: ['thread', '/threadId'], level: 'use', emits: ['plan.rejected', 'block.answered'], tool: 'chats', offline: 'queue',
    }),
    write('chat.plan.step_done', 'Mark one plan step done so the plan block ticks it', {
      in: { ...threadT, planId: id.plan, stepId: t.id('stp') }, out: { plan: t.obj({ planId: id.plan, steps: t.arr(planStep) }) }, on: ['thread', '/threadId'], level: 'use',
      emits: ['plan.step_done'], tool: 'chats', idem: 'natural', risk: 'low',
    }),
    write('chat.open_tab', 'Open a side tab beside the chat for the person (a file, record, diff, terminal); respects the person tab setting and posts a line', {
      in: { ...threadT, targetType: t.str({ examples: ['file'] }), targetId: t.str(), title: t.opt(t.str()) },
      out: { opened: t.bool(), reason: t.opt(t.enm('disabled_by_person', 'no_device')) }, on: ['thread', '/threadId'], level: 'use', emits: ['tab.opened', 'message.received', 'thread.unarchived'],
      tool: 'chats', mcpName: 'open_tab', agent: { planMode: 'blocked', blocks: ['tab_opened'] }, idem: 'natural',
    }),
    write('chat.handoff', 'Hand work to another agent: opens that agent thread linked from this one, counted against the hop limit', {
      in: { ...threadT, toAgentId: id.agent, note: t.str() }, out: { thread: threadRow, depth: t.int() }, on: ['thread', '/threadId'], level: 'use',
      emits: ['agent.handoff', 'thread.started', 'message.received', 'thread.unarchived'], tool: 'chats', mcpName: 'handoff', errors: ['validation.precondition_failed'],
    }),
    write('chat.helper.start', 'Start a helper sub-task thread with its own model, provider and effort; helper chats are read-only', {
      in: {
        ...threadT, title: t.str(), instruction: t.str(), agentId: t.opt(id.agent), model: t.opt(t.str()), provider: t.opt(t.str()), effort: t.opt(effort),
        crew: t.opt(t.bool()),
      },
      out: { helper: threadRow, blockId: id.block }, on: ['thread', '/threadId'], level: 'use', emits: ['helper.started', 'thread.started', 'message.received', 'thread.unarchived'],
      tool: 'chats', mcpName: 'sub_task_model', agent: { planMode: 'blocked', blocks: ['model_switch', 'helper'] },
    }),
    read('chat.helpers.list', 'Helpers running under a chat, with status', {
      in: threadT, out: { helpers: t.arr(t.obj({ threadId: id.thread, title: t.str(), status: t.enm('running', 'done', 'failed', 'stopped'), agentId: id.agent, model: t.opt(t.str()), startedAt: t.ts() })) },
      on: ['thread', '/threadId'], tool: 'chats',
    }),
    // ---- transcript
    read('chat.transcript.search', 'Search transcripts the asker may see: keyword, semantic or hybrid (default), snippets with links, never raw files', {
      in: { q: t.str(), mode: t.opt(t.enm('keyword', 'semantic', 'hybrid')), threadId: t.opt(id.thread), agentId: t.opt(id.agent), limit: t.opt(t.int({ minimum: 1, maximum: 50 })) },
      out: { hits: t.arr(transcriptHit) }, label: 'filter', tool: 'chats', mcpName: 'transcript_search', agent: { planMode: 'allowed' },
    }),
    read('chat.history.search', 'Word-for-word search over the chat messages and transcript rows (turns, tool calls and results) the asker could open themselves; used by memory for exact quotes. Returns the stored words, author, time and a link that opens the chat at that line', {
      in: {
        q: t.opt(t.str()), ref: t.opt(t.str({ description: 'A message id, or <thread>#<index> for a transcript row: read that one line in full' })), threadId: t.opt(id.thread),
        excludeThreadId: t.opt(id.thread), limit: t.opt(t.int({ minimum: 1, maximum: 20 })), minCoverage: t.opt(t.num({ minimum: 0, maximum: 1 })),
      },
      out: { hits: t.arr(historyHit) }, label: 'filter', rate: { n: 120, perSeconds: 60, scope: 'principal' },
    }),
    read('chat.transcript.read', 'Read a window of a transcript as Markdown (the chats/<id>/transcript.md view)', {
      in: { ...threadT, fromIdx: t.opt(t.int()), limit: t.opt(t.int({ minimum: 1, maximum: 500 })) }, out: { markdown: t.str(), next: t.opt(t.int()) },
      on: ['thread', '/threadId'], label: 'check', tool: 'chats', mcpName: 'transcript_read', agent: { planMode: 'allowed' },
    }),
    read('chat.transcript.get', 'Read one turn of a transcript verbatim', {
      in: { ...threadT, turnId: id.turn }, out: { turnId: id.turn, rows: t.arr(t.obj({ idx: t.int(), role: t.str(), kind: t.str(), content: t.json(), toolName: t.opt(t.str()), at: t.ts() })) },
      on: ['thread', '/threadId'], label: 'check', tool: 'chats', mcpName: 'transcript_get', agent: { planMode: 'allowed' },
    }),
    write('chat.transcript.append', 'Append canonical transcript rows for a turn (every engine writes here, API drivers directly and CLI drivers through hooks)', {
      in: { ...threadT, turnId: id.turn, rows: t.arr(t.obj({ role: t.str(), kind: t.str(), content: t.json(), toolName: t.opt(t.str()), toolCallId: t.opt(t.str()) })) },
      out: { appended: t.int() }, on: ['thread', '/threadId'], idem: 'natural', risk: 'low',
    }),
    read('chat.transcript.summary', 'The rolling summary of a thread and the pointer to its transcript, used to hand off to another engine', {
      in: threadT, out: { summary: t.str(), upToIdx: t.int(), updatedAt: t.ts(), transcriptPath: t.str() }, on: ['thread', '/threadId'], label: 'check',
    }),
    write('chat.transcript.summarize', 'Refresh the rolling summary on a cheap model in the background', {
      in: threadT, out: { upToIdx: t.int() }, on: ['thread', '/threadId'], idem: 'natural', risk: 'low',
    }),
    // ---- channels
    create('channels.create', 'Create a channel: public to the Team Space or invite-only, with any mix of people and agents', {
      in: { name: t.str({ examples: ['intake'] }), visibility: t.enm('public', 'invite'), topic: t.opt(t.str()), memberIds: t.opt(t.arr(id.user)), agentIds: t.opt(t.arr(id.agent)), folderId: t.opt(id.folder), recordId: t.opt(id.record) },
      out: { channel: channelRow }, perm: 'channels.create', emits: ['channel.created', 'thread.started', 'channel.agent_added', 'channel.member_added'], tool: 'chats', offline: 'queue', cli: 'vyre channels create',
    }),
    read('channels.list', 'List channels by section and folder (the items capability of the Channels list)', {
      in: channelListIn, out: { channels: t.arr(channelRow), ...pageOut }, tool: 'chats', label: 'filter',
    }),
    read('channels.get', 'Read one channel with members, agents and unread count', {
      in: channelT, out: { channel: channelRow }, on: ['channel', '/channelId'], tool: 'chats', label: 'check',
    }),
    write('channels.update', 'Rename a channel or change its topic or visibility', {
      in: { ...channelT, name: t.opt(t.str()), topic: t.opt(t.str()), visibility: t.opt(t.enm('public', 'invite')) }, out: { channel: channelRow }, on: ['channel', '/channelId'], level: 'manage',
      emits: ['channel.updated'], tool: 'chats', offline: 'patch',
    }),
    write('channels.archive', 'Archive a channel (project and Journey channels archive when the record completes)', {
      in: channelT, out: { channel: channelRow }, on: ['channel', '/channelId'], level: 'manage', emits: ['channel.archived'], tool: 'chats',
    }),
    write('channels.unarchive', 'Bring an archived channel back', {
      in: channelT, out: { channel: channelRow }, on: ['channel', '/channelId'], level: 'manage', emits: ['channel.unarchived'], tool: 'chats',
    }),
    write('channels.join', 'Join a public channel', {
      in: channelT, out: { channel: channelRow }, on: ['channel', '/channelId'], level: 'view', emits: ['channel.member_added'], tool: 'chats', idem: 'natural',
    }),
    write('channels.leave', 'Leave a channel', {
      in: channelT, out: { ok: t.bool() }, on: ['channel', '/channelId'], level: 'view', emits: ['channel.member_removed'], tool: 'chats', idem: 'natural',
    }),
    write('channels.members.add', 'Add people to a channel', {
      in: { ...channelT, personIds: t.arr(id.user, { minItems: 1 }), level: t.opt(level) }, out: { channel: channelRow }, on: ['channel', '/channelId'], level: 'manage',
      emits: ['channel.member_added'], tool: 'chats',
    }),
    write('channels.members.remove', 'Remove a person from a channel', {
      in: { ...channelT, personId: id.user }, out: { channel: channelRow }, on: ['channel', '/channelId'], level: 'manage', emits: ['channel.member_removed'], tool: 'chats',
    }),
    write('channels.agents.add', 'Invite an agent into a channel; agents listen by default', {
      in: { ...channelT, agentId: id.agent, mode: t.opt(agentMode) }, out: { channel: channelRow }, on: ['channel', '/channelId'], level: 'manage', perm: 'channels.agents',
      emits: ['channel.agent_added', 'agent.engaged'], tool: 'chats',
    }),
    write('channels.agents.remove', 'Remove an agent from a channel', {
      in: { ...channelT, agentId: id.agent }, out: { channel: channelRow }, on: ['channel', '/channelId'], level: 'manage', perm: 'channels.agents',
      emits: ['channel.agent_removed', 'agent.disengaged'], tool: 'chats',
    }),
    write('channels.agent_watch.set', 'Let an agent act unmentioned in a channel ("watches this channel"); every such act is logged like a routine', {
      in: { ...channelT, agentId: id.agent, watches: t.bool() }, out: { channel: channelRow }, on: ['channel', '/channelId'], level: 'manage', perm: 'channels.agents',
      emits: ['channel.agent_watch_changed'], tool: 'chats', audit: 'always',
    }),
    write('channels.connect_outside_agent', 'Connect an outside agent (Claude Code, Codex) to a channel: returns the MCP address, a one-time token (once, 10 minutes) and the run command', {
      in: { ...channelT, name: t.str({ examples: ['Claude Code'] }), scopes: t.opt(t.obj({ read: t.bool(), post: t.bool(), readChangesets: t.bool(), writeBranch: t.bool() })) },
      out: { mcpUrl: t.str({ pattern: '^https?://', examples: ['https://northwind.example.com/mcp'] }), oneTimeToken: t.str(), expiresAt: t.ts(), runCommand: t.str() },
      on: ['channel', '/channelId'], level: 'manage', perm: 'channels.agents', audit: 'always', risk: 'high', tool: 'chats', idem: 'key',
      ex: { output: { mcpUrl: 'https://northwind.example.com/mcp', oneTimeToken: 'otk_example', expiresAt: 1760000600000, runCommand: 'claude mcp add vyre https://northwind.example.com/mcp --token otk_example' } },
    }),
    read('channels.stream', 'The channel as a timeline: messages and Run items in order; repeated runs of one flow collapse into one row ("ran 6 times today"); counts feed the People, Agents and Runs menu', {
      in: { ...channelT, before: t.opt(t.int()), limit: t.opt(t.int({ minimum: 1, maximum: 200 })), show: t.opt(t.arr(streamKind)), expand: t.opt(t.arr(t.str())) },
      out: { items: t.arr(streamItem), counts: t.obj({ people: t.int({ minimum: 0 }), agents: t.int({ minimum: 0 }), runs: t.int({ minimum: 0 }) }), hidden: t.arr(streamKind), hasMore: t.bool() },
      on: ['channel', '/channelId'], tool: 'chats', label: 'filter',
    }),
    read('channels.stream_prefs.get', 'My People, Agents and Runs choice for one channel', { in: channelT, out: { hide: t.arr(streamKind) }, on: ['channel', '/channelId'], tool: 'chats' }),
    write('channels.stream_prefs.set', 'Hide or show People, Agents or Runs in one channel for myself (Hide Runs in This Channel); the header says what is hidden', {
      in: { ...channelT, hide: t.arr(streamKind) }, out: { hide: t.arr(streamKind) }, on: ['channel', '/channelId'], tool: 'chats', offline: 'patch',
    }),
  ],
  events: [
    // ---- erase and purge (P-CC_39): governance removes data through these; each hard-deletes inside its own store
    ev('thread.erased', 'A chat thread was erased for good with its messages, blocks, pins and transcript (ids only)', { p: { threadId: id.thread }, subject: ['entity', '/threadId'], retention: 'audit' }),
    ev('channel.erased', 'A channel was erased for good with its messages (ids only)', { p: { channelId: id.channel }, subject: ['entity', '/channelId'], retention: 'audit' }),
    ev('transcripts.purged', 'Chat transcripts past their retention were removed (a count)', { p: { removed: t.int({ minimum: 0 }) }, subject: ['entity', '/removed'], retention: 'audit' }),
    ev('message.received', 'A message was posted in a thread (ids and counts only, never the text)', {
      p: { messageId: id.message, threadId: id.thread, threadSeq: t.int(), author: principalRef, kind: t.str(), depth: t.int(), mentions: t.arr(mention), hasBlocks: t.bool(), via: t.opt(id.user), actingFor: t.opt(id.user) },
      subject: ['thread', '/threadId'], label: 'subject', retention: 'transcripts', trigger: { title: 'A message is posted', fields: ['/threadId', '/author/kind'] },
    }),
    ev('message.edited', 'A message was edited', { p: { messageId: id.message, threadId: id.thread }, subject: ['thread', '/threadId'], label: 'subject', retention: 'transcripts' }),
    ev('message.deleted', 'A message was deleted', { p: { messageId: id.message, threadId: id.thread }, subject: ['thread', '/threadId'], label: 'subject', retention: 'transcripts' }),
    ev('message.reacted', 'A reaction was added or removed', { p: { messageId: id.message, threadId: id.thread, emoji: t.str(), removed: t.bool() }, subject: ['thread', '/threadId'], label: 'subject' }),
    ev('message.pinned', 'A message pinned marker changed', { p: { messageId: id.message, threadId: id.thread, pinned: t.bool() }, subject: ['thread', '/threadId'], label: 'subject' }),
    ev('message.mentioned', 'A person was @mentioned', {
      p: { messageId: id.message, threadId: id.thread, personId: id.user, author: principalRef, inThread: t.bool() }, subject: ['thread', '/threadId'], vis: 'participants', notify: 'mention', label: 'subject',
    }),
    ev('message.direct', 'A person received a direct message from another person', {
      p: { messageId: id.message, threadId: id.thread, personId: id.user, author: principalRef }, subject: ['thread', '/threadId'], vis: 'participants', notify: 'dm', label: 'subject',
    }),
    ev('thread.started', 'A thread, chat or channel main thread was started', {
      p: { threadId: id.thread, kind: threadKind, starter: t.str(), parentThreadId: t.opt(id.thread), channelId: t.opt(id.channel), scopeType: t.opt(t.str()), scopeId: t.opt(t.str()) },
      subject: ['thread', '/threadId'], label: 'subject', vis: 'participants', retention: 'transcripts',
    }),
    ev('thread.updated', 'A thread title, folder or listing changed', { p: { threadId: id.thread, fields: t.arr(t.str()) }, subject: ['thread', '/threadId'], vis: 'participants' }),
    ev('thread.closed', 'A thread was closed', { p: { threadId: id.thread }, subject: ['thread', '/threadId'], vis: 'participants' }),
    ev('thread.reopened', 'A thread was reopened', { p: { threadId: id.thread }, subject: ['thread', '/threadId'], vis: 'participants' }),
    ev('thread.archived', 'A person archived a chat: it left their list only', { p: { person: id.user, threadId: id.thread }, subject: ['entity', '/threadId'], vis: 'owner' }),
    ev('thread.unarchived', 'A chat came back into a person\'s list: they unarchived it, or someone @mentioned them in it', { p: { person: id.user, threadId: id.thread, reason: t.enm('person', 'mention') }, subject: ['entity', '/threadId'], vis: 'owner' }),
    ev('thread.deleted', 'A person deleted a chat only they were in: hidden everywhere, kept for Undo and the audit trail until the retention purge', { p: { person: id.user, threadId: id.thread }, subject: ['entity', '/threadId'], vis: 'owner', retention: 'audit' }),
    ev('thread.restored', 'A person undid the delete of their chat', { p: { person: id.user, threadId: id.thread }, subject: ['entity', '/threadId'], vis: 'owner', retention: 'audit' }),
    ev('thread.replied', 'A reply landed in a thread someone follows', {
      p: { threadId: id.thread, parentThreadId: t.opt(id.thread), messageId: id.message, personId: id.user }, subject: ['thread', '/threadId'], vis: 'participants', notify: 'reply.followed', label: 'subject',
    }),
    ev('thread.plan_mode_changed', 'Plan mode was switched for a thread', { p: { threadId: id.thread, planMode: t.bool(), by: t.str() }, subject: ['thread', '/threadId'], vis: 'participants' }),
    ev('thread.promoted', 'A private chat became a channel with another person', {
      p: { threadId: id.thread, channelId: id.channel, personId: id.user }, subject: ['thread', '/threadId'], vis: 'participants',
    }),
    ev('channel.created', 'A channel was created', { p: { channelId: id.channel, name: t.str(), visibility: t.str(), recordId: t.opt(id.record) }, subject: ['channel', '/channelId'], trigger: { title: 'A channel is created' } }),
    ev('channel.updated', 'A channel changed name, topic or visibility', { p: { channelId: id.channel, fields: t.arr(t.str()) }, subject: ['channel', '/channelId'] }),
    ev('channel.archived', 'A channel was archived', { p: { channelId: id.channel }, subject: ['channel', '/channelId'] }),
    ev('channel.unarchived', 'A channel was brought back', { p: { channelId: id.channel }, subject: ['channel', '/channelId'] }),
    ev('channel.member_added', 'A person joined a channel or thread', { p: { channelId: t.opt(id.channel), threadId: t.opt(id.thread), personId: id.user, by: t.str() }, subject: ['entity', '/personId'], vis: 'participants' }),
    ev('channel.member_removed', 'A person left or was removed from a channel or thread', { p: { channelId: t.opt(id.channel), threadId: t.opt(id.thread), personId: id.user, by: t.str() }, subject: ['entity', '/personId'], vis: 'participants' }),
    ev('channel.agent_added', 'An agent was invited into a channel', { p: { channelId: id.channel, agentId: id.agent, mode: t.str() }, subject: ['channel', '/channelId'] }),
    ev('channel.agent_removed', 'An agent was removed from a channel', { p: { channelId: id.channel, agentId: id.agent }, subject: ['channel', '/channelId'] }),
    ev('channel.agent_watch_changed', 'An agent started or stopped watching a channel', { p: { channelId: id.channel, agentId: id.agent, watches: t.bool(), by: t.str() }, subject: ['channel', '/channelId'] }),
    ev('agent.engaged', 'An agent joined a thread as lead or listener', { p: { threadId: id.thread, agentId: id.agent, mode: t.str(), by: t.str() }, subject: ['thread', '/threadId'], vis: 'participants' }),
    ev('agent.disengaged', 'An agent left a thread', { p: { threadId: id.thread, agentId: id.agent, by: t.str() }, subject: ['thread', '/threadId'], vis: 'participants' }),
    ev('agent.handoff', 'An agent handed work to another agent, in a new linked thread', {
      p: { fromThreadId: id.thread, toThreadId: id.thread, fromAgentId: id.agent, toAgentId: id.agent, depth: t.int() }, subject: ['thread', '/toThreadId'], vis: 'participants',
    }),
    ev('helper.started', 'A helper sub-task thread started under a chat', {
      p: { helperThreadId: id.thread, parentThreadId: id.thread, agentId: id.agent, model: t.opt(t.str()) }, subject: ['thread', '/helperThreadId'], vis: 'participants',
    }),
    ev('plan.proposed', 'An agent proposed a plan', { p: { planId: id.plan, threadId: id.thread, steps: t.int() }, subject: ['thread', '/threadId'], vis: 'participants' }),
    ev('plan.approved', 'A plan was approved (with or without edits)', { p: { planId: id.plan, threadId: id.thread, edited: t.bool(), by: t.str() }, subject: ['thread', '/threadId'], vis: 'participants' }),
    ev('plan.rejected', 'A plan was rejected', { p: { planId: id.plan, threadId: id.thread, by: t.str() }, subject: ['thread', '/threadId'], vis: 'participants' }),
    ev('plan.step_done', 'A plan step finished', { p: { planId: id.plan, threadId: id.thread, stepId: t.id('stp') }, subject: ['thread', '/threadId'], vis: 'participants' }),
    ev('block.waiting', 'A question or plan block is waiting for an answer and the turn is parked', {
      p: { threadId: id.thread, blockId: id.block, blockType: t.enm('question', 'plan') }, subject: ['thread', '/threadId'], vis: 'participants',
    }),
    ev('block.answered', 'A waiting block was answered; the answer is queued as a wake', {
      p: { threadId: id.thread, blockId: id.block, by: t.str() }, subject: ['thread', '/threadId'], vis: 'participants',
    }),
    ev('tab.opened', 'An agent opened a side tab for a person (delivered live to that person devices)', {
      p: { threadId: id.thread, personId: id.user, targetType: t.str(), targetId: t.str(), agentId: id.agent }, subject: ['thread', '/threadId'], vis: 'owner',
    }),
  ],
  blocks: [
    block('question', {
      threadId: id.thread, blockId: id.block, prompt: t.str(), mode: t.enm('single', 'multi', 'free'), options: t.arr(option), allowOther: t.bool(),
      answer: t.opt(t.json()), answeredBy: t.opt(t.str()),
    }, 'Question: {{prompt}}', { waitsForAnswer: true, actions: [{ key: 'answer', label: 'Answer', cap: 'chat.answer_block', input: { threadId: '/threadId', blockId: '/blockId' } }] }),
    block('plan', {
      threadId: id.thread, blockId: id.block, planId: id.plan, title: t.str(), steps: t.arr(planStep), state: t.enm('proposed', 'approved', 'rejected', 'done'), docFileId: t.opt(id.file),
    }, 'Plan: {{title}} ({{steps.length}} steps)', {
      waitsForAnswer: true, opens: { tab: 'file', input: { fileId: '/docFileId' } },
      actions: [
        { key: 'approve', label: 'Approve', cap: 'chat.approve_plan', input: { threadId: '/threadId', planId: '/planId' } },
        { key: 'reject', label: 'Reject', cap: 'chat.plan.reject', input: { threadId: '/threadId', planId: '/planId' } },
      ],
    }),
    block('tab_opened', { targetType: t.str(), targetId: t.str(), title: t.str(), agentId: id.agent }, 'Opened {{title}} beside the chat', { opens: { tab: 'target', input: { type: '/targetType', id: '/targetId' } } }),
    block('helper', {
      threadId: id.thread, parentThreadId: id.thread, title: t.str(), status: t.enm('running', 'done', 'failed', 'stopped'), agentId: id.agent, model: t.opt(t.str()),
      path: t.arr(t.obj({ title: t.str(), threadId: id.thread })),
    }, 'Helper {{title}}: {{status}}', { opens: { tab: 'thread', input: { threadId: '/threadId' } }, actions: [{ key: 'stop', label: 'Stop', cap: 'engine.stop', input: { threadId: '/threadId' } }] }),
    block('crew_result', {
      jobId: t.str(), threadId: id.thread, agentId: id.agent, name: t.str(), title: t.str(), branch: t.str(), base: t.str(), state: t.enm('done', 'failed'),
      commits: t.opt(t.arr(t.obj({ sha: t.str(), subject: t.str() }))), files: t.opt(t.arr(t.obj({ path: t.str(), added: t.int(), deleted: t.int() }))), ahead: t.opt(t.int()), text: t.opt(t.str()),
    }, '{{name}} finished {{title}}', {
      opens: { tab: 'thread', input: { threadId: '/threadId' } },
      actions: [{ key: 'merge', label: 'Merge', cap: 'engine.crew.merge', input: { jobId: '/jobId' } }],
    }),
    block('model_switch', {
      threadId: id.thread, agentId: id.agent, scope: t.enm('sub_task', 'thread'),
      from: t.obj({ provider: t.str(), model: t.str(), effort: t.opt(t.str()) }), to: t.obj({ provider: t.str(), model: t.str(), effort: t.opt(t.str()) }), reason: t.opt(t.str()),
    }, 'Using {{to.model}} for this step'),
    block('table', { title: t.opt(t.str()), columns: t.arr(t.obj({ key: t.str(), title: t.str() })), rows: t.arr(t.rec()) }, 'Table {{title}} ({{rows.length}} rows)'),
    block('doc_excerpt', {
      fileId: id.file, title: t.str(), text: t.str(), filled: t.arr(t.obj({ start: t.int(), end: t.int(), field: t.str() })), link: t.opt(t.str()),
    }, 'Excerpt from {{title}}', { opens: { tab: 'file', input: { fileId: '/fileId' } } }),
    block('form_fields', {
      title: t.opt(t.str()), recordId: t.opt(id.record), fields: t.arr(t.obj({ key: t.str(), label: t.str(), value: t.json(), kind: t.str() })),
    }, 'Fields: {{title}}'),
    block('checklist', { title: t.opt(t.str()), items: t.arr(t.obj({ text: t.str(), done: t.bool(), by: t.opt(t.str()) })) }, 'Checklist {{title}}'),
  ],
  settings: [
    setting('chat.agent_tabs', 'person', 'Chats', 'Let agents open and switch side tabs for me', t.bool(), true),
    setting('chat.ask_agent', 'person', 'Models and usage', 'Agent I last used in Ask panes', t.nullable(id.agent), null),
  ],
  screens: [
    screen('chats.sidebar', 'chats', 'ui:ChatsSidebar', {
      slot: 'sidebar',
      q: { recent: ['chat.recent', { filter: '/state/filter' }, true], channels: ['channels.list', { section: '/state/section', folderId: '/state/folderId' }, true] },
      a: { newChat: ['chat.start', {}], newChannel: ['channels.create', {}], markRead: ['threads.mark_read', { threadId: '/state/threadId' }] },
      empty: 'No chats yet', primary: 'New chat', needs: ['chats.private'],
    }),
    screen('chats.conversation', 'chats', 'ui:Conversation', {
      q: {
        thread: ['threads.get', { threadId: '/state/threadId' }, true], messages: ['chat.messages.list', { threadId: '/state/threadId', before: '/state/before' }, true],
        helpers: ['chat.helpers.list', { threadId: '/state/threadId' }, true],
      },
      a: {
        post: ['chat.post', { threadId: '/state/threadId' }], edit: ['chat.edit', { threadId: '/state/threadId', messageId: '/state/messageId' }],
        react: ['chat.react', { threadId: '/state/threadId', messageId: '/state/messageId' }], answer: ['chat.answer_block', { threadId: '/state/threadId', blockId: '/state/blockId' }],
        approvePlan: ['chat.approve_plan', { threadId: '/state/threadId', planId: '/state/planId' }], setPlanMode: ['threads.set_plan_mode', { threadId: '/state/threadId' }],
        interrupt: ['engine.interrupt', { threadId: '/state/threadId' }], stop: ['engine.stop', { threadId: '/state/threadId' }], stopAll: ['engine.stop_all', { threadId: '/state/threadId' }],
        setMode: ['engine.set_mode', { threadId: '/state/threadId', agentId: '/state/agentId' }], switchEngine: ['engine.switch', { threadId: '/state/threadId' }],
        startChannel: ['threads.make_channel', { threadId: '/state/threadId' }],
      },
      empty: 'Say something to start', primary: 'Write a message', perf: { firstPaintMs: 50, completeMs: 100 },
    }),
    screen('chats.helper-chat', 'chats', 'ui:HelperChat', {
      slot: 'side',
      q: { thread: ['threads.get', { threadId: '/state/threadId' }, true], messages: ['chat.messages.list', { threadId: '/state/threadId' }, true] },
      a: { stop: ['engine.stop', { threadId: '/state/threadId' }] },
      empty: 'The helper has not said anything yet', primary: 'Back to the chat',
    }),
    screen('chats.right-pane', 'chats', 'ui:ChatRightPane', {
      slot: 'side', q: { threads: ['threads.list', { parentThreadId: '/state/threadId' }, true], helpers: ['chat.helpers.list', { threadId: '/state/threadId' }, true], crew: ['engine.crew.list', { threadId: '/state/threadId' }, true] },
      a: { openThread: ['chat.thread', { threadId: '/state/threadId' }] }, empty: 'No threads yet',
    }),
    screen('chats.connect-outside-agent', 'chats', 'ui:ConnectOutsideAgent', {
      slot: 'sheet', q: { channel: ['channels.get', { channelId: '/state/channelId' }, true] }, a: { connect: ['channels.connect_outside_agent', { channelId: '/state/channelId' }] },
      empty: 'No outside agent connected', primary: 'Connect an outside agent',
    }),
    screen('shell.ask-pane', 'shell', 'ui:AskPane', {
      slot: 'side',
      q: { asks: ['chat.asks_of', { resourceType: '/scope/type', resourceId: '/scope/id' }, true], suggested: ['chat.ask_suggest', { scopeType: '/scope/type', scopeId: '/scope/id' }, false] },
      a: { start: ['chat.start', {}], openAsChat: ['chat.open_as_chat', { threadId: '/state/threadId' }], post: ['chat.post', { threadId: '/state/threadId' }] },
      empty: 'Ask about this', primary: 'Ask',
      ask: {
        suggestions: {
          view: ['Explain this', 'Summarise what changed', 'Show its history', 'What did the agent do here?', 'Draft a change for the owners to review'],
          use: ['Explain this', 'Run it for me', 'Show its history'],
          edit: ['Explain this', 'Make this change', 'Fix what looks wrong', 'Show its history'],
          manage: ['Explain this', 'Make this change', 'Who can see this?', 'Show its history'],
        },
      },
    }),
  ],
});
