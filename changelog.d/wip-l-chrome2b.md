## What's new
- Show Vyre how: record a task once in Chrome from the right-click menu or the side panel. A step bar shows Pause and Stop. Passwords, codes and card numbers are never recorded: a login becomes the step "Sign in with Vault".
- A review page shows the steps in plain words with a picture each. Each input is "Ask each time" or a fixed value, and any step can be marked "Ask me before this step". Save it as a skill your agents can repeat, then Add to my agents, Try it, View steps or Share it with the Space.
- Watch a page: pick a part of a page, or any change, choose how often and which agent checks it. It runs on the agent's computer when the agent has one (or offers "Give the agent one"), otherwise in your Chrome. A change is told in a chat with what it was and what it is now.
- Watching lists every page you watch in the side panel and in Automations, with Check now, Pause and Remove.
- The link /automations#screen=watching opens the Watching view on the web, the desktop app and the phone.
- A goal can use a watched page as its progress: the number on the page, or how many times it has changed.

## Behind the scenes
- Watching lives in the Automations module: `automations.watches.list`, `.save`, `.remove`, `.report` and `.check`, with the table `automations_watches`. A watch on an agent's computer wakes the agent every minute it is due.
- Goals read a `watch` source through `automations.watches.list`. Only a call made by another capability may name the person, so the gateway cannot read someone else's watch.
- A recording becomes SKILL.md plus `replay.json`, a list of the agent browsing tools to call (chrome_open, chrome_click, chrome_type and so on). It is data, not a script file, so adding it needs no admin approval.
- Recorded addresses drop the fragment, any login in the address and query values that look like secrets. Recordings are kept in session storage and go when Chrome closes.
- The extension asks Chrome for the `alarms` permission (a once-a-minute look at the watches that run in your Chrome). `agents.list` now says which agents have a computer.
- The extension asks the app, as the signed-in person, for the people and channels they may pick (`people.list`) and their open goals with a number (`goals.pick`); nothing beyond their own view.
