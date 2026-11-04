## What's new

- Give an assistant or agent a GitHub link and it can set it up in Vyre. It reads the repo at an exact commit and tells you what it found: a skill, a plugin, a local MCP server, a remote MCP server or a site. It says what it does in plain words, what it needs (web addresses, Vault keys, files), and who gets it: just you, one agent, or everyone in the Space (admins only). Nothing is installed until you approve the card.
- A skill is added to your skills or an agent's. A plugin is registered with the plugin runtime. A local MCP server runs in the sandbox, or you can pick Run it on the Space to deploy it on Sites with its key from the Vault and connect it to your agents.
- Nothing updates by itself. A newer commit shows you what changed, line by line, before anything is applied.
- Skills now have an owner, a person or an agent, and can be shared with agents as Can use, Can edit or Can manage. Agents write and refine their own skills; every save is a version and Undo brings the last one back.
- An agent uses the skills of the person it is answering, and only on that person's turn.
