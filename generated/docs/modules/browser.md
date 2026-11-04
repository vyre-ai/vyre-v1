# Browser connections (browser)

Lane L10. Kind module. Version 0.1.0.

Requires: nothing.

## Capabilities (5)

- [browser.cards.post](../capabilities/browser.cards.post.md): Leave a card in a chat for work in the person's own Chrome: a held send with the page's To, From, Subject and Message, or the "Using your Chrome" step with a masked picture. Never routes to an agent
- [browser.chrome.act](../capabilities/browser.chrome.act.md): Press a button on a Chrome card: send what is held, do not send it, watch the agent's tab, or take it over
- [browser.sites.list](../capabilities/browser.sites.list.md): The Browser connections: sites agents may use, where each runs, and each agent's right (Read only or Act). A person sees their own; an agent sees the sites that name it
- [browser.sites.remove](../capabilities/browser.sites.remove.md): Remove a Browser connection
- [browser.sites.set](../capabilities/browser.sites.set.md): Add a Browser connection, or change one: where it runs and which agents may Read only or Act. Sends, posts, payments and deletes are always held for you

## Events (1)

- [browser.site_changed](../events/browser.site_changed.md): A Browser connection was added, changed or removed
