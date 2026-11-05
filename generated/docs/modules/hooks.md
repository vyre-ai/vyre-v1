# Hooks (hooks)

Lane L2. Kind module. Version 0.1.0.

Requires: nothing.

## Capabilities (14)

- [hooks.allow_always](../capabilities/hooks.allow_always.md): Always allow: from now on this hook lets the same kind of act (the one its newest stop in this chat was about) go by, in its own scope, and keeps guarding the rest. A person presses it, where they may change the hook
- [hooks.allow_once](../capabilities/hooks.allow_once.md): Let a hook that stopped something go by, once, in this chat: the next time it would stop the same kind of call it lets it through. A person presses it, never an agent; a Space hook only an admin may let through. The pass ends after one use or ten minutes
- [hooks.allow_remove](../capabilities/hooks.allow_remove.md): Take an always-allow rule away: the hook guards that kind of act again
- [hooks.ask_admin](../capabilities/hooks.ask_admin.md): Ask the Space admins about a hook that stopped something: one Inbox line for each admin, and a quiet line in the chat saying you asked
- [hooks.deny](../capabilities/hooks.deny.md): Deny: the stop stands. The stop line is marked for everyone in the chat and the agent is told on its next turn. A person presses it, where they may change the hook
- [hooks.fire](../capabilities/hooks.fire.md): System: ask what the hooks say about one event. The engine, the tool session and the CLI shim call it; it returns a block with its reason, notes for the model, and how many ran. Hooks that fail or run out of time never block
- [hooks.list](../capabilities/hooks.list.md): List hooks: the Space's, yours, and an agent's or one chat's. Each has a plain line, when it runs, what it does and who made it. Use this before you add one
- [hooks.pause](../capabilities/hooks.pause.md): Pause a hook, or turn it back on
- [hooks.policy.get](../capabilities/hooks.policy.get.md): Whether agents may make hooks in this Space
- [hooks.policy.set](../capabilities/hooks.policy.set.md): Space admins: allow or turn off hooks made by agents for the whole Space. Hooks agents already made stay but do not run while it is off
- [hooks.remove](../capabilities/hooks.remove.md): Remove a hook you made
- [hooks.runs.latest](../capabilities/hooks.runs.latest.md): The newest run of each hook in one chat, one row per hook: what "Last ran" on a hook card reads. Only for a chat you can use
- [hooks.runs.list](../capabilities/hooks.runs.list.md): What hooks did lately: which ran, what they answered, and the ones that failed or ran out of time, newest first. since and outcomes narrow it before the limit; scope space is a Space admin's read of every Space hook's runs (anyone else gets only what they could see anyway)
- [hooks.set](../capabilities/hooks.set.md): Add or change a hook that runs at an event (before a tool, before anything leaves Vyre, a message, a turn end, a helper) as a command, a check or one action. For yourself: scope agent, chat or run. It can stop something, add a note or run its own action; never skip a rule

## Events (3)

- [hook.admin_asked](../events/hook.admin_asked.md): Someone asked the Space admins about a hook that stopped something
- [hook.blocked](../events/hook.blocked.md): A hook stopped a message, a tool call, an outward act or a helper
- [hook.changed](../events/hook.changed.md): A hook was added, changed, removed, paused or turned back on, or an admin switched agent-made hooks
