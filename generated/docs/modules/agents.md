# Agents (agents)

Lane L2. Kind module. Version 0.1.0.

Requires: chat, engine, mcp, memory, runs, terminal.

## Capabilities (60)

- [agents.builtin_skills.list](../capabilities/agents.builtin_skills.list.md): Skills every agent carries, led by "Working in Vyre": save facts to the asker layer, propose promotions, cite sources, use secrets only by name, never copy data across Spaces
- [agents.config.get](../capabilities/agents.config.get.md): Parsed agent.toml and AGENT.md metadata as the next run will see them, with the last good version and any error
- [agents.config.validate](../capabilities/agents.config.validate.md): Validate agent.toml text (app limits first, then precedence) without saving
- [agents.create](../capabilities/agents.create.md): Create an agent (the create-agent skill ends in one Approve card): record, Agents/<name> folder with the decided file tree, template files
- [agents.delete](../capabilities/agents.delete.md): Move an agent to Trash (its folder and memory follow the folder rules)
- [agents.get](../capabilities/agents.get.md): Read one agent: record, status, limits and the effective configuration
- [agents.guide.get](../capabilities/agents.guide.get.md): The Vyre agent guide (.vyre/guide.md): version and text, rewritten by app updates, loaded into every chat before VYRE.md
- [agents.limits.get](../capabilities/agents.limits.get.md): Effective limits of an agent: agent.toml capped by Space caps
- [agents.list](../capabilities/agents.list.md): List agents you are in or that are shared with you (admins may toggle All in the Space)
- [agents.pause](../capabilities/agents.pause.md): Pause an agent with a reason; the status shows who paused it
- [agents.restore](../capabilities/agents.restore.md): Restore an agent from Trash
- [agents.restore_version](../capabilities/agents.restore_version.md): Restore AGENT.md or agent.toml to an earlier version
- [agents.resume](../capabilities/agents.resume.md): Resume a paused agent
- [agents.role_line.set](../capabilities/agents.role_line.set.md): Edit the role line in place: saves the description of agent.toml with an inline Undo; read-only without Edit
- [agents.routine.delegate](../capabilities/agents.routine.delegate.md): Hand a routine to another person or agent (a person becomes its owner, an agent runs it); undo (no `to`) hands it back to the previous owner and agent
- [agents.routine.delete](../capabilities/agents.routine.delete.md): Delete a routine
- [agents.routine.run_now](../capabilities/agents.routine.run_now.md): Run a routine now. The run starts as the routine owner, never as the caller, so its reach and its "Sent by <agent> on a routine <person> set" line are the owner's
- [agents.routine.save](../capabilities/agents.routine.save.md): Create or change a routine, a schedule (cron) or a watcher (kind watch: runs on each new message in a channel); messages it causes carry "Sent by <agent> on a routine <person> set"
- [agents.routines.list](../capabilities/agents.routines.list.md): Routines of an agent (schedules set by the owner)
- [agents.set_owner](../capabilities/agents.set_owner.md): Hand an agent to another active person: its home folder and the agent change owner with it and the previous owner keeps nothing on them
- [agents.snapshot.take](../capabilities/agents.snapshot.take.md): Take the file snapshot a run uses; changes to the files apply between runs
- [agents.status](../capabilities/agents.status.md): Live status of an agent: Awake (idle 2 minutes), Working, Asleep or Paused with reason and who
- [agents.suggestion.accept](../capabilities/agents.suggestion.accept.md): Accept a suggestion (shown to the owner and editors only); applies it through files.save as a version
- [agents.suggestion.dismiss](../capabilities/agents.suggestion.dismiss.md): Dismiss a suggestion
- [agents.suggestion.propose](../capabilities/agents.suggestion.propose.md): Propose a change to AGENT.md as a diff; people without Edit see Suggest to <owner>; personal preferences go to private memory instead
- [agents.suggestions.list](../capabilities/agents.suggestions.list.md): Open suggestions for an agent: AGENT.md diffs from the agent and template suggestions
- [agents.summary](../capabilities/agents.summary.md): The agent page strip: chats this week, open tasks, runs today, spend against limit, memory facts, proposed facts, Working on, Linked
- [agents.template.apply](../capabilities/agents.template.apply.md): Apply the template: adds, never removes or overwrites; changed files become suggestions; widening ones need admin approval; try one agent first
- [agents.template.get](../capabilities/agents.template.get.md): The Agent template: version, files, and the propagation mode
- [agents.template.preview](../capabilities/agents.template.preview.md): Preview propagation before applying ("12 agents, 3 folders added, 2 suggestions")
- [agents.update](../capabilities/agents.update.md): Change an agent: name, model, fallback, account, tools, vault key names, limits, memory capture, handoffs; a broken agent.toml keeps the last good version running
- [agents.versions](../capabilities/agents.versions.md): List versions of an agent definition (AGENT.md, agent.toml) for rollback
- [agents.visibility.set](../capabilities/agents.visibility.set.md): Admin toggle "All in the Space" for agent lists (logged)
- [plugins.agent_template.use](../capabilities/plugins.agent_template.use.md): Make an agent from a sub-agent a plugin brought (its description becomes the role line and its prompt the start of AGENT.md)
- [plugins.agent_templates.list](../capabilities/plugins.agent_templates.list.md): Sub-agents that installed plugins bring, as templates a new agent can start from
- [plugins.allow.list](../capabilities/plugins.allow.list.md): The marketplaces and plugins the admin allows
- [plugins.allow.set](../capabilities/plugins.allow.set.md): Allow or stop allowing a whole marketplace, or one plugin of it
- [plugins.browse](../capabilities/plugins.browse.md): Plugins the marketplaces offer, with whether each is on the allowlist and where it is installed
- [plugins.command.render](../capabilities/plugins.command.render.md): The prompt a plugin command stands for, with its arguments filled in; the chat sends it as the person's message
- [plugins.commands.list](../capabilities/plugins.commands.list.md): The / commands that plugins add for a chat with this agent (or the Space when no agent)
- [plugins.config.set](../capabilities/plugins.config.set.md): Set the options a plugin asks for; a secret option takes a Vault handle, never a value
- [plugins.connection.add](../capabilities/plugins.connection.add.md): Connect an MCP server by URL (remote) or by command (runs in the sandbox), for the Space or one agent; works for every model
- [plugins.connection.remove](../capabilities/plugins.connection.remove.md): Disconnect an MCP server made by hand
- [plugins.connections.list](../capabilities/plugins.connections.list.md): MCP connections made by hand (a URL or a command)
- [plugins.get](../capabilities/plugins.get.md): One installed plugin with the skills, commands, sub-agents, hooks and MCP servers it brought
- [plugins.hooks.list](../capabilities/plugins.hooks.list.md): The hooks of the plugins that apply to this agent. They run only in the sandbox.
- [plugins.install](../capabilities/plugins.install.md): Install a plugin from a marketplace into the whole Space (admin) or into one agent: its skills, commands, sub-agents, hooks and MCP servers become available
- [plugins.list](../capabilities/plugins.list.md): Installed plugins: in the whole Space, and in one agent when agentId is given
- [plugins.marketplace.add](../capabilities/plugins.marketplace.add.md): Add a marketplace by git URL (https) or a folder on this server; reads its marketplace.json and puts it on the allowlist
- [plugins.marketplace.refresh](../capabilities/plugins.marketplace.refresh.md): Fetch a marketplace again and update its list
- [plugins.marketplace.remove](../capabilities/plugins.marketplace.remove.md): Remove a marketplace; the plugins installed from it stay until they are removed
- [plugins.marketplaces.list](../capabilities/plugins.marketplaces.list.md): Marketplaces added to this Space
- [plugins.mcp.servers](../capabilities/plugins.mcp.servers.md): The MCP servers a chat with this agent connects to: from plugins in the Space, plugins in the agent and connections made by hand. Secrets are Vault handles.
- [plugins.set_enabled](../capabilities/plugins.set_enabled.md): Turn an installed plugin off or on without removing it
- [plugins.uninstall](../capabilities/plugins.uninstall.md): Remove an installed plugin and what it brought
- [skills.add](../capabilities/skills.add.md): Add or replace a skill in the Space library, or in one agent (SKILL.md text with name and description in its front matter, plus optional supporting files)
- [skills.list](../capabilities/skills.list.md): Skills a chat with this agent can load: Vyre built-in, the Space library and the agent own skills/ folder, one line each. With no agentId, the Space library and built-in ones
- [skills.load](../capabilities/skills.load.md): Load the full text of one skill by name (SKILL.md body and its supporting files); agent skills win over Space ones, Space ones over built-in
- [skills.remove](../capabilities/skills.remove.md): Remove a skill from the Space library, or from one agent
- [skills.set_enabled](../capabilities/skills.set_enabled.md): Turn a Space or agent skill off or on without removing it

## Events (26)

- [agent.config_changed](../events/agent.config_changed.md): AGENT.md, agent.toml or the agent record changed (a new version was saved)
- [agent.config_error](../events/agent.config_error.md): An agent.toml failed validation; the last good version keeps running
- [agent.created](../events/agent.created.md): An agent was created
- [agent.deleted](../events/agent.deleted.md): An agent moved to Trash
- [agent.owner_changed](../events/agent.owner_changed.md): An agent was handed to another person
- [agent.paused](../events/agent.paused.md): An agent was paused
- [agent.restored](../events/agent.restored.md): An agent came back from Trash
- [agent.resumed](../events/agent.resumed.md): An agent was resumed
- [agent.routine_changed](../events/agent.routine_changed.md): A routine was created, changed or deleted
- [agent.routine_delegated](../events/agent.routine_delegated.md): A routine was handed to another owner, or handed back
- [agent.routine_run_started](../events/agent.routine_run_started.md): A routine run started now, as the routine owner
- [agent.suggestion_proposed](../events/agent.suggestion_proposed.md): A change to an agent was suggested
- [agent.suggestion_resolved](../events/agent.suggestion_resolved.md): A suggestion was accepted or dismissed
- [agent.template_applied](../events/agent.template_applied.md): The Agent template was applied
- [plugin.allowlist_changed](../events/plugin.allowlist_changed.md): The plugin allowlist changed
- [plugin.changed](../events/plugin.changed.md): A plugin was turned on or off, configured, or used to make an agent
- [plugin.connection_added](../events/plugin.connection_added.md): An MCP server was connected
- [plugin.connection_removed](../events/plugin.connection_removed.md): An MCP connection was removed
- [plugin.installed](../events/plugin.installed.md): A plugin was installed
- [plugin.marketplace_added](../events/plugin.marketplace_added.md): A marketplace was added
- [plugin.marketplace_refreshed](../events/plugin.marketplace_refreshed.md): A marketplace was fetched again
- [plugin.marketplace_removed](../events/plugin.marketplace_removed.md): A marketplace was removed
- [plugin.uninstalled](../events/plugin.uninstalled.md): A plugin was removed
- [skill.added](../events/skill.added.md): A skill was added to the Space library or to one agent
- [skill.changed](../events/skill.changed.md): A skill was turned off or on
- [skill.removed](../events/skill.removed.md): A skill was removed from the Space library or from one agent
