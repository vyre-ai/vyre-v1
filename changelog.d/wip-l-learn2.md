## What's new

- Undoing what an agent did now teaches it. When you bring back a file, folder, record or task an agent deleted, put an earlier version of a file or record back over its change, move a file back, revert a change it proposed, discard its proposal, or undo its Run, the agent keeps a lesson from it, the same as when you tell it no in chat. Your own undos, and undos of what a colleague did, teach nothing. A lesson from a chat other people read keeps nothing unless you wrote the words yourself, and your switch Learn from my corrections still turns it all off.
- The "Learned: ..." line under a message now says when, in the words the app uses elsewhere ("just now", "12 min ago", "3 h ago", "yesterday"), with the exact time when you point at it.
- When someone else changes a task while you are editing it, the task page now shows what changed instead of one line. For each field you changed, your value sits next to what the task holds now, with who changed it. Keep yours or take theirs per field, or all at once. Save writes only the fields you kept, and one quiet line says what was not kept. Nothing is saved or lost until you choose. If you change another field while the card is open, it joins the card. The description clashes the same way when two people edit it. Done means and its ticks merge instead: if two people add an item or tick a box at once, both changes stay and there is no card.

- lib/reversal.ts is the one seam for this: a module wraps the capability that undoes and the wrapper finds who made the latest act the undo reverses (the event log, or the module's own record: a changeset's author, a task's history, a Run's agents), then calls memory.corrections.record as the person with how "reverse" (how "refuse" for discarding a proposal). One reference per act, so undoing and redoing makes one lesson. Wired to runs.undo, files.restore, files.folder.restore, files.restore_version, files.move, changesets.revert_change, changesets.discard, records.restore, records.restore_version, tasks.restore and mounts.restore. A memory that fails never holds an undo up.
- tasks.update's refusal on an old version also says who changed the task last (details.by).
- A task page save that already names the version it started on (the title) keeps it instead of being overwritten with the page's latest version.
- The prototype copy the lane screenshots use (scripts/shots/prototype/vyre-v1.html) is the current prototype, with the Tasks conflict scene. extract-fixtures.py now takes the inbox and the Journeys from scripts/shots/extract-vm.mjs, which runs the prototype's own code, because the prototype writes them with variables and helper calls. The chat seed copy (prototype-chat.ts) is gone: the Chats prototype has no per-Space seed any more and no screen read it. prototype-data.ts and prototype-seed.generated.json are regenerated, and the inbox test allows a thread two contacts share to repeat its message ids.
- Screenshot mount and targets for the conflict card (TASKCONFLICT_01) and scripts/shots/l-learn2-shoot.mjs.
- tasks.working_notes.set takes an optional expectedFrom, the value of the note the writer started from. When the note holds something else now, nothing is written and the refusal is the same stale_version one as tasks.update, with what the note holds and who changed it. A writer that names no start value (an agent) writes as before.
- An agent writing a task note is held to the same rule: it sends expectedFrom (the note as it last read it). If a person saved since, nothing is written, the refusal gives the current note and tells the agent to make its change again on top of it, and a list note (Done means, the ticks) is merged for it. With no expectedFrom an agent may only append (the note was empty, or its new value starts with what the note holds), so it cannot erase a person's edit it never read. People writing with no expectedFrom still write as before.

## What's new (the @ menu)

- The @ menu shows your own Assistant as "Assistant" with its V logo, never as "Irfad Imtiaz (Agent)". After it come the other agents of the Space and the chat's teammates, each with its own face, then people. Another person's Assistant and anyone's outside agent (Claude Code, Codex and the like, which show as "<person> (Agent)") are not in it, and neither is an agent kept from you. Nothing that is not a mention is in the menu, so a stray Report a problem row is gone. Picking Assistant in a shared channel names your own Assistant. A guest sees only the agents the chat allows.

## What's new (Notes)

- The opened note is calmer. It sits centered over an even dim, and the card it came from stays out of sight while it is open. The pin and an X are together at the top right; Esc and a press outside close it, and it saves as you type ("Edited just now" stays). There is one row of actions (Ask about this note, Turn into task, Turn into record, then colour, image, share and more) and no Close at the foot. The icons have tooltips, and the pin on a card with a picture has a solid backdrop.
- A web address in a note's words gets its link card, with the site, title and picture, even when you type or paste it into the opened note and not only into Take a note. A note that already has a card keeps it; if you remove the card, the same address is not read again.
- Agents make notes. Ask an agent to "save this as a note" and it saves a private note in your Notes that links back to that message ("From: <chat>, <time>", with Open message; the link opens only for people who can read the chat, and a note shared with someone carries no link into your chat). An agent may also offer a small "Save as a note?" card with a preview when something in a chat is worth keeping, with Save and Not now. Offers are rare: once per topic, never within 15 minutes of another, and nothing for a day after you say Not now. After Save the chat shows a quiet "Saved to Notes · Open" line that names nothing the note holds. A note made from a chat other people read is still only yours. Turn offers off in Settings, Notes.
- notes.create takes a source (the chat and message it is saved from) and the note says where it came from (notes.get, notes.list: from). chat.note_offer.make is the agent tool (offer_note) and chat.note_offer.answer the person's Save or Not now; notes_create is the agent tool for "save this as a note". The offer card is written by Vyre itself, so an agent cannot post one with chat.post. Setting notes.offers (person, default on).

## What's new (Threads)

- Threads is no longer a sidebar item. A chat with unread replies you follow turns bold in the chat list and shows the count. Reply threads inside chats work as before: Reply in thread, the right pane, the replies line, follow, mute and alerts.
- Inbox has a Replies tab. It holds the page the Threads item had: Open, Mark as read, Follow, Mute, Leave, Copy link on right-click, and J and K to move.
- Ask history sits in the chat list under an Asks filter next to Recent.
- No screen calls a chat a "thread" any more ("1 in this chat"). "Thread" only means the replies to one message.
- Old links to the Threads page open Inbox > Replies.
- chat.recent rows carry repliesUnread (the unread replies hanging off that chat). The Unread filter and the next-unread jump count them.
- The phone note shows its "From" line like the desktop note.

## What's new (Agent tools)

- When a tool crashes on the server, the agent is told in plain words which tool failed, that nothing was changed, and the trace to give the person, instead of a bare 500.
- Tests for an agent's memory search: a fresh agent, an agent with lessons, a person key held and gone, awkward notes, and the read gate on a search answer.
- A note card is only as tall as its words. Its hover tools sit over its foot and take no room, so one note no longer sits in a tall empty card.
- The closed Take a note bar has a flat edge in place of the wide soft shadow, which showed as a shaded strip under it in dark themes.
