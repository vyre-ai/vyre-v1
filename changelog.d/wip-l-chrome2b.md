## What's new
- Vyre for Chrome can watch a page or one part of it. You pick how often, who to tell and which agent checks it. A change is told in a chat with what it was and what it is now.
- A goal can use a watched page as its progress: the number on the page, or how many times it has changed.
- Automations has a Watching list with every page you watch.

## Behind the scenes
- Watching lives in the Automations module: `browser.watches.list`, `.save`, `.remove`, `.report` and `.check`, with the table `automations_watches`. A watch on an agent's computer wakes the agent every minute it is due.
- Goals read a `watch` source through `browser.watches.list`. Only a call made by another capability may name the person, so the gateway cannot read someone else's watch.
