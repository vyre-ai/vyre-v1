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
- An agent is told in its base instructions to say in plain words what failed and never paste ids or traces. A tool that crashes on the server returns a plain sentence to the agent, with the trace in the error's own fields and not in the words it would repeat.
- In Inbox > Replies, pressing a reply (or Enter on it) opens that chat with the thread open beside the message, and marks the reply read. The chat's name in the row opens the chat itself. A reply row now leads with who replied, then the reply.
- A link to a chat can name the thread to open beside it (side=...).

## What's new (Chat names)

- A chat has one name, the same in the sidebar, the header, the tabs and notifications. A direct message is named after the person. Any other chat is named by its title, and until it has a real title it shows who is in it ("Dex", "Dex and Aliza"). The first line of a message and the day no longer stand in for a name.
- A chat is named automatically after the first real request, never from a greeting ("Heyy", "hi", "test"): 2 to 5 plain words from a cheap model on the account that ran the turn, or from the request's own words when no model is at hand. A title made from a very short first request is made again once, from the first fuller one. After you rename a chat, from the header or the sidebar, it is never renamed for you.
- chat.title_make names a chat from its first real request. Notifications say where in the chat's one name, never "a chat".
- The cheapest-model pick moved to lib/cheap-model.ts so chat and memory share it.
- Inbox > Replies on a phone is a two-line row: who replied and the chat name with the time, then the words with the count or Muted. A chat that is not a direct message shows the other people's faces in its header.
- Make task and Remember under an agent's answer in a chat of people are drawn as buttons with an edge and an icon, so they no longer read as stray text.
- Audit rows and the Console overview read as sentences: "Priya Raman assigned a role to Omar Haddad", "Intake revealed the record Rivera engagement, for Priya Raman", in place of "role changed Omar". The sentence is made in lib/words/actions.ts from the act's name, in the past tense, with no dots, underscores or ids; a guard test covers every audited capability.
- Make task and Remember for an agent's answer in a chat of people sit in the message's hover bar next to Copy, Reply in thread, Fork and Pin (and Make a Task and Remember in the long-press sheet on a phone). Nothing of them is drawn at rest.

## What's new (Agents)

- An agent that asks a question in a chat now stops there: its turn waits for the answer and makes no further model call. A question taken back by its agent (chat.question.withdraw) closes its card and its task leaves Needs you. A turn that ends without waiting takes back any question it left open. A question of fewer than three words, or only "test", is refused with a plain message.
- A turn parked on a hold or a question now records the usage it had up to that point and is closed when its wake starts, so no turn is left running with nothing counted.
- Text that comes after a tool step starts a new paragraph, so a reply no longer reads "Let me look.Found 3 leads."
- No tool is called to see if it works: a call whose arguments are placeholders (example.com, a bare "test", foo and bar, __probe ids, lorem ipsum) is refused before it runs, with "Don't call tools to test them. Call with the real thing the person asked for, or don't call." No card, hold, task or message reaches the chat. Every agent is told the same in its rules.
- On update, a one-time clean-up closes open question cards and drops holds whose content is a placeholder, and their tasks leave Needs you. Nothing else is touched.
- The Notes guidance moved from working-in-vyre into its own small skill, working-with-notes, so working-in-vyre stays under its line cap.

## What's new (Inbox drafts)

- An agent's draft in Inbox says who drafted it by name ("Assistant drafted a reply"), never by id, and the line under it reads "Sends from techmanager@... when you press Send" in place of "Gate: <id> sends from ...".
- One pending draft per thread per agent: a new draft from the same agent on the same thread takes the old one's place. The card says Updated with the time and the earlier draft is one click away.
- By contact shows only drafts to or from that contact. A draft is filed under a contact only when one of its recipients is that contact's address, and a draft already filed under the wrong contact is left out of the list.
- Edit and Send on an agent draft in Inbox use the stored draft, not the card preview: Edit opens the draft in its own card with every character of its body and Save keeps its recipients and thread; Send goes to the draft's own recipients and Cc from its own mailbox, filed under its own contact, never to or under the thread that happens to be open. A body that ends in a cut-off marker the person did not type is never sent.
- A draft is filed under a contact only when one of the people it is addressed to is that contact. Someone on Cc, copied on two contacts' threads, files it under no one.
- mail.send sends an agent's draft as it is stored: its own recipients, Cc, Bcc, subject and every character of its body, whatever the caller holds. An agent draft that ends in a cut-off marker and has not been saved by a person is refused with a plain message, and nothing is sent.

## What's new (Approvals)

- An approval nobody answered does not wait for ever. After 7 days, or once the chat it was asked in or its task closed, it expires as "Not sent, it waited 7 days": the call is never sent, its task closes and the agent is told the plain reason. At start the same check clears what earlier releases left behind.
- Needs you groups approvals that have waited days under Older, after what just arrived, in place of mixing them.
- Agents are told never to say "Gate", "hold" or other internal words to people, and what a model reads from a failed tool says approval in their place.
- An approval nobody answered for 7 days now reads "Not sent, it waited 7 days" in Needs you, under Withdrawn, with only Dismiss left.
- The Personal claim live test now expects the route it opened on (/chat), not /home.
- Live browser tests follow today's product: the invite error sits behind "Use another account" for a device already in the Space, Back on the join sheet is "back", Apps forms are opened from the Forms group first, the record Ask pane is the record chat, a short piece of work opens from the summary beside the name, the onboarding screen closes from its x on a phone, and sign-out waits for the server to revoke the key.
- A direct message always carries the person's name in the sidebar, as it does on its tab.
- A withdrawn request names its own key in the footer ("A dismiss"), not "A approve".
- Add sending domain in Apps opens the Console's Sending domains with Add domain ready, and is not shown to anyone who cannot open the Console.
- The accounts live test names each account once per turn, with the original messages back so the chat title call still runs.
- The activity-line live test waits for the line to read Thinking instead of reading a node that may be redrawn.
- A tab strip that cannot close its tabs draws no close button over their labels, and a hidden close button takes no clicks.
- Live tests: the Apps drawing gate opens the rail isle first, automations.home dismisses the first-run guide, and the activity journey thinks 4 s so its excerpt stays up.
- The activity line shows the first of the agent's thinking at once instead of after a 1.5 s wait, and the live tests keep one stand-in vault key so a world's vault stays readable when a browser seat opens the app.
