## What's new
- An agent works in your own Chrome only when you ask for it in that message: "in my Chrome", "on my computer", or the Use my Chrome choice. Without the ask, agent browsing stays in the Space browser and your computer is left alone. An ask does not carry over to your next message.
- When you do ask, the agent finds the tab you already have open for the site and works in it, in its own tab group, or opens a new tab if there is none. A tab that was yours is never closed by the agent. Sends, posts and payments are still held for you.
- If Vyre for Chrome is not open on your computer, or agents are not turned on for this Space, the agent says so plainly and offers the Space browser.

## Behind the scenes
- The browser tools take `inMyChrome`. The server refuses it unless the newest line from the person the agent works for, in that chat, asks for their Chrome (checked from the chat, not from what the agent says). Held-item release, Stop, Resume and the status check do not need a new ask. An agent with no computer is no longer sent to the person's Chrome by default.
- `chrome_tabs` has a `find` action with `site`. In the extension a found tab can be used by that agent, is grouped and brought forward, and goes back out of the group when the agent lets go. The agent computer answers `find` for its own tabs.
- The three live Chrome chat tests now script the person's ask in the chat.
