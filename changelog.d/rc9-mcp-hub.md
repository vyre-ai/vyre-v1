Connect an app hub. One card in Settings, Connections (and in Console, Plugins for admins) connects Composio or Pipedream with one key. The key goes to your Vault and the Space keeps only its name. The hub's apps then show up as tools for every agent. The hub row says "Runs through Composio" once; each app opens to its tools, and a tool that changes things is marked "Asks first" and waits for approval when an agent uses it. Each app has a Connect button to the hub's own page, and the list refreshes when you come back. Mail, files, CRM and the Vault never go through a hub. Remote tool servers that sign in with their provider instead of a key now work too: pick Sign in when you add one, finish in the browser, and Vyre keeps the token sealed and renews it on its own.

When a hub key is revoked or a sign-in ends, the Space's admins get one item in Needs you ("Replace the Composio key") instead of a failure on every call. It closes itself when the connection answers again. The same small helper is available to any connection, for example a CRM key.

When an agent wants to change something through an app hub, the approval card in the chat now reads "Ops wants to send message in Slack" with the fields it will send and "Runs through Composio", instead of the tool's internal name.

Needs you reads right for requests Vyre makes itself. A hub key that stopped working shows "From Composio" (or "From Vyre"), is assigned to "Admins", and its main button is "Replace key", which opens a small sheet in place and puts the new key in the same Vault item. There is no Take button and no "Open its computer" for requests that did not come from an agent's run. Approval cards say "send a message" and "create a task", never a tool's or capability's own name.

In Needs you, the participants button hides when no person is on a request, the footer lists only the keys that work for the open request (Enter to open when there is nothing to approve), and a request Vyre made shows the app's mark or the Vyre mark instead of a person's face.

On a phone, a dialog with several actions now wraps them inside the card instead of running past its left edge.

Composio and Pipedream have a mark in the app icon set, so a hub row and a request from a hub show a mark instead of a letter.
