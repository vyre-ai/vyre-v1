## What's new

- An artifact an agent publishes shows in the chat as a real card: a small picture, its name, one quiet line ("Page · Private to you · updated 3:53"), and Open, Copy link and a "..." menu with Share, Open in browser and Delete. The whole card opens it.
- An artifact opens in its own tab inside Chats, named for the artifact, with one header row (back, name, Share, "...") and the page filling the rest. It shows a loading state and, when the page cannot load, a real error with Open in browser and Try again.
- Artifacts open from the sidebar's Artifacts row, inside Chats. It is a grid of the same cards with a quiet search and a Mine, Shared with me, All menu, newest update first, and an empty state with an example ask. Old links to the Apps artifact page land there.
- An artifact now keeps a small picture taken at publish (the agent can pass `thumb`), the chat that made it, and who it is shared with. sites.get and sites.list return them, and the card and the grid show them. The grid's "From <chat>" links back to the chat.
