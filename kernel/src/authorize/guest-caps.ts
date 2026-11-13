// What a guest may do with a thread or a channel, in ONE table (lane f-guest, 13 Nov 2026). A guest is a person with no standing in the Space (no View on it). However they came to hold a grant on a thread or a channel (the invite to a
// channel, a thread shared with them, an agent's chat), the grant reaches only what this table lets that level do: "view" is allowed for a view or a reply guest, "reply" only for a guest whose grant reaches Use, and
// "never" (and any capability not listed, which fails closed) is refused whatever the grant says. The table is checked at authorize time, so changing it changes every guest grant already stored.
// kernel/tests/authorize.guest-caps.test.ts fails when a capability on a thread or a channel is not classified here. Handlers keep their own checks (edit and delete only the guest's own messages).
export type GuestWhat = "view" | "reply" | "never";

export const GUEST_CAPS: Readonly<Record<string, GuestWhat>> = Object.freeze({
  "channels.agent_watch.set": "never",
  "channels.agents.add": "never",
  "channels.agents.remove": "never",
  "channels.archive": "never",
  "channels.get": "view", // the channel they were added to, its name and people
  "channels.join": "never",
  "channels.leave": "view", // leave the channel they were added to
  "channels.members.add": "never",
  "channels.members.remove": "never",
  "channels.stream": "never",
  "channels.stream_prefs.get": "never",
  "channels.stream_prefs.set": "never",
  "channels.unarchive": "never",
  "channels.update": "never",
  "chat.answer_block": "never",
  "chat.approve_plan": "never",
  "chat.aside": "never",
  "chat.aside_keep": "never",
  "chat.ask_level": "never",
  "chat.catch_up": "view", // what they missed since they last looked
  "chat.crew_line": "never",
  "chat.delete_message": "reply", // delete their own message (the handler refuses anyone elses)
  "chat.edit": "reply", // edit their own message (the handler refuses anyone elses)
  "chat.flow_card": "never",
  "chat.handoff": "never",
  "chat.helper.note": "never",
  "chat.helper.note_seen": "never",
  "chat.helper.notes": "never",
  "chat.helper.restart": "never",
  "chat.helper.start": "never",
  "chat.helper.steer": "never",
  "chat.helpers.list": "never",
  "chat.history.page": "view", // scroll back in the chat
  "chat.hook_line": "never",
  "chat.hook_resolve": "never",
  "chat.make_task": "never",
  "chat.message.get": "view", // read one message
  "chat.messages.list": "view", // read the chat and its reply threads
  "chat.note_offer.answer": "never",
  "chat.note_offer.make": "never",
  "chat.noted": "never",
  "chat.open_as_chat": "never",
  "chat.open_tab": "never",
  "chat.pin": "never",
  "chat.pins.list": "view", // see what is pinned
  "chat.plan.propose": "never",
  "chat.plan.reject": "never",
  "chat.plan.step_done": "never",
  "chat.post": "reply", // say something, mention an agent
  "chat.question.ask": "never",
  "chat.question.withdraw": "never",
  "chat.react": "reply", // react to a message
  "chat.read_floor": "view", // where their history starts
  "chat.remember": "never",
  "chat.reply_details": "view", // who replied in a thread
  "chat.screen.get": "never",
  "chat.share": "never",
  "chat.thread": "reply", // open the reply thread under a message
  "chat.title_make": "never",
  "chat.transcript.append": "never",
  "chat.transcript.get": "never",
  "chat.transcript.read": "never",
  "chat.transcript.summarize": "never",
  "chat.transcript.summary": "never",
  "chat.unpin": "never",
  "console.assistant_context_set": "never",
  "console.diff_propose": "never",
  "engine.account.resolve": "never",
  "engine.compact": "never",
  "engine.crew.chat_repo": "never",
  "engine.crew.list": "never",
  "engine.crew.start": "never",
  "engine.crew.status": "never",
  "engine.crew.wait": "never",
  "engine.crew.workspace": "never",
  "engine.drop_queued": "never",
  "engine.helpers.change_model": "never",
  "engine.helpers.status": "never",
  "engine.helpers.stop_all": "never",
  "engine.interrupt": "never",
  "engine.live_turns": "never",
  "engine.placement.decide": "never",
  "engine.placement.options": "never",
  "engine.placement.set": "never",
  "engine.queue.list": "never",
  "engine.queue.peek": "never",
  "engine.reviewer.get": "never",
  "engine.reviewer.set": "never",
  "engine.route.preview": "never",
  "engine.set_mode": "never",
  "engine.set_model": "never",
  "engine.stop": "never",
  "engine.stop_all": "never",
  "engine.switch": "never",
  "engine.turn.enqueue": "never",
  "engine.turn.of_message": "never",
  "engine.turn.start": "never",
  "engine.turns.list": "never",
  "engine.usage.get": "never",
  "engine.warm": "never",
  "projects.for_channel": "never",
  "projects.from_channel": "never",
  "sites.chat_viewing": "never",
  "terminal.request": "never",
  "threads.add_agent": "never",
  "threads.agent.configure": "never",
  "threads.agent.create": "never",
  "threads.agent_settings.set": "never",
  "threads.archive": "never",
  "threads.close": "never",
  "threads.delete": "never",
  "threads.follow": "view", // follow or mute it
  "threads.get": "view", // open the chat or reply thread
  "threads.invite_guest": "never",
  "threads.leave": "never",
  "threads.make_channel": "never",
  "threads.mark_read": "view", // mark it read
  "threads.mark_unread_from": "view", // mark it unread again
  "threads.members.add": "never",
  "threads.members.remove": "never",
  "threads.move": "never",
  "threads.outside_agent.add": "never",
  "threads.outside_agent.remove": "never",
  "threads.poke": "never",
  "threads.remove_agent": "never",
  "threads.reopen": "never",
  "threads.restore": "never",
  "threads.set_agent_replies": "never",
  "threads.set_folder": "never",
  "threads.set_mode": "never",
  "threads.set_plan_mode": "never",
  "threads.unarchive": "never",
  "threads.update": "never",
});

/**
 * May a guest whose strongest matching grant is `reaches` use this capability? Unknown: no. No capability named: this is not a call of one (a list, a sync filter, a check a handler makes inside a call
 * the gateway already checked by name), so the grant alone decides, as it does for every other role.
 */
export function guestMay(cap: string | undefined, reachesUse: boolean): boolean {
  if (cap === undefined) return true;
  const what = GUEST_CAPS[cap];
  return what === "view" || (what === "reply" && reachesUse);
}

/** The resource types the table governs. */
export const GUEST_TYPES: ReadonlySet<string> = new Set(["thread", "channel"]);
