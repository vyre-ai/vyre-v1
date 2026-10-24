# Agents (agents)

Lane L2. Kind module. Status stub. Version 0.1.0.

Requires: chat, engine, mcp, memory, runs, terminal.

## Capabilities (30)

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
- [agents.routine.delete](../capabilities/agents.routine.delete.md): Delete a routine
- [agents.routine.save](../capabilities/agents.routine.save.md): Create or change a routine; messages it causes carry "Sent by <agent> on a routine <person> set"
- [agents.routines.list](../capabilities/agents.routines.list.md): Routines of an agent (schedules set by the owner)
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

## Events (11)

- [agent.config_changed](../events/agent.config_changed.md): AGENT.md, agent.toml or the agent record changed (a new version was saved)
- [agent.config_error](../events/agent.config_error.md): An agent.toml failed validation; the last good version keeps running
- [agent.created](../events/agent.created.md): An agent was created
- [agent.deleted](../events/agent.deleted.md): An agent moved to Trash
- [agent.paused](../events/agent.paused.md): An agent was paused
- [agent.restored](../events/agent.restored.md): An agent came back from Trash
- [agent.resumed](../events/agent.resumed.md): An agent was resumed
- [agent.routine_changed](../events/agent.routine_changed.md): A routine was created, changed or deleted
- [agent.suggestion_proposed](../events/agent.suggestion_proposed.md): A change to an agent was suggested
- [agent.suggestion_resolved](../events/agent.suggestion_resolved.md): A suggestion was accepted or dismissed
- [agent.template_applied](../events/agent.template_applied.md): The Agent template was applied
