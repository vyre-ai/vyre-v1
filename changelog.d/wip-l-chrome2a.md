## What's new
- Vyre for Chrome: an agent working in your Chrome now gets its own tab group, "Vyre · <agent>", with its own colour. The bar sits at the bottom of the page with Take over and Stop, and says "Waiting for you in Vyre" while a send waits for you.
- Vyre for Chrome: the Vyre badge sits in sign-in and card fields. Click it to pick an account (or a card) from your Vault. Cards fill number, name, expiry and code.
- Vault, Connections: a Browser kind. For each site you choose where it runs (My Chrome, agent computers, or both) and what each agent may do there: Read only, or Act. Sends, posts, payments and deletes are always held for you. A site with no connection can be read by an agent in your Chrome and never acted on.
- Vyre for Chrome: "Save to Vault?" keeps a new login in Mine by default. Choose Shared to pick a folder and the agents that may use it.

- Chrome: the extension asks for the tabGroups permission, and the held-send event now carries the To, From, Subject and Message read from the page (never a secret field), for the approval card in chat.
- Chrome: Take over gives the tab back and the agent waits until chrome_resume, like Stop.
- Chrome: Save to my agent no longer saves into Mine and then fails to share. A shared save goes to a folder the Space lists for the person, each save and grant carries a key made from the card so a retry does not duplicate, and a folder or agent the page names that the Space did not list is refused.
- Chrome tests: a real headless Chromium run of an agent in a tab group with a held send, Take over, Stop and Esc (apps/chrome/tests/ext-agent.tabs.e2e.test.ts).
- Browser connections capabilities: browser.sites.list, browser.sites.set and browser.sites.remove, a new module "browser" (lane L10; the frozen module count is now 75). The Chrome extension asks browser.sites.list and refuses an agent's click, typing or fill with a read_only error when the right is Read only, in My Chrome; an older app that cannot answer changes nothing.
- Chrome tests: the badge and picker, and Save then Shared with its keys, in a real headless Chromium (apps/chrome/tests/ext-core.signin.e2e.test.ts); Read only refusing an act and a Vault fill whose value never reaches the agent (ext-agent.tabs.e2e.test.ts).
