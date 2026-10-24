# Engine (engine)

Lane L2. Kind module. Status stub. Version 0.1.0.

Requires: nothing.

## Capabilities (52)

- [engine.account.resolve](../capabilities/engine.account.resolve.md): Resolve the account that pays for a turn: starter, steerer, step key, backup key, else an Unblock
- [engine.accounts.list](../capabilities/engine.accounts.list.md): Accounts the caller can run on: API keys by handle and subscription sign-ins (Mine), with status
- [engine.defaults.get](../capabilities/engine.defaults.get.md): The caller default model, provider, effort and fallback order in this Space
- [engine.defaults.set](../capabilities/engine.defaults.set.md): Set the caller default model, provider, effort and fallback order (the chat default)
- [engine.health](../capabilities/engine.health.md): Engine health: queue age, lease holders, provider reachability
- [engine.incident.assign](../capabilities/engine.incident.assign.md): Assign an incident to an owner
- [engine.incident.get](../capabilities/engine.incident.get.md): Read one AI incident with its notes
- [engine.incident.note](../capabilities/engine.incident.note.md): Add a note to an incident
- [engine.incident.open](../capabilities/engine.incident.open.md): Open an AI incident (people report one; the system opens them for label denials, scrub misses and runaway spend)
- [engine.incident.resolve](../capabilities/engine.incident.resolve.md): Resolve an incident with a note
- [engine.incidents.list](../capabilities/engine.incidents.list.md): AI incidents for review
- [engine.interrupt](../capabilities/engine.interrupt.md): Interrupt now: cancel the current turn and queue the message at top priority ("stop and send")
- [engine.lease.acquire](../capabilities/engine.lease.acquire.md): Take the lease on a thread (compare and set; heartbeat every 5 s, expires after 20 s)
- [engine.lease.heartbeat](../capabilities/engine.lease.heartbeat.md): Extend the lease on a thread
- [engine.lease.release](../capabilities/engine.lease.release.md): Release the lease on a thread
- [engine.models.list](../capabilities/engine.models.list.md): Models the account can reach; models that the open labels or policy forbid are listed greyed with the reason
- [engine.placement.decide](../capabilities/engine.placement.decide.md): Decide where a turn runs: host or the asker device (private chat rules, computers, routines, phone and web askers)
- [engine.policy.get](../capabilities/engine.policy.get.md): AI policies: allowed accounts, allowed models and providers, and which providers each label may reach
- [engine.policy.set](../capabilities/engine.policy.set.md): Change AI policies (models and providers, per label provider rules, allowed accounts)
- [engine.pool.status](../capabilities/engine.pool.status.md): Warm engine pool: sessions per driver, warm hits, evictions
- [engine.probe_account](../capabilities/engine.probe_account.md): Test an account: reachable, signed in, models it can use
- [engine.providers.list](../capabilities/engine.providers.list.md): AI providers and engines (API and CLI) with whether each is connected and allowed for the open labels
- [engine.queue.list](../capabilities/engine.queue.list.md): Messages waiting in a thread queue (steering, wakes, handoffs)
- [engine.queue.peek](../capabilities/engine.queue.peek.md): Steering check between tool calls: the next queued messages for a running turn
- [engine.review.list](../capabilities/engine.review.list.md): Sampled turns waiting for human review
- [engine.review.mark](../capabilities/engine.review.mark.md): Mark a sampled turn reviewed: fine, or flagged (which opens an incident)
- [engine.route.preview](../capabilities/engine.route.preview.md): Who will answer a draft message ("Intake will reply" or "No agent will reply, type @ to ask one"); same route() the client runs locally
- [engine.runtime.opt_in](../capabilities/engine.runtime.opt_in.md): Let the Space continue my chats when my computer is off, by wrapping my runtime key for the Space; revocable
- [engine.set_mode](../capabilities/engine.set_mode.md): Set an agent to Leading or Listening in a thread; exactly one lead per thread
- [engine.set_model](../capabilities/engine.set_model.md): Set the model, provider, effort and paying account of an agent in a thread
- [engine.spend.caps.set](../capabilities/engine.spend.caps.set.md): Set spend and usage caps for the Space, a person or an agent; agent.toml can never exceed them
- [engine.spend.get](../capabilities/engine.spend.get.md): Spend against caps for the Space, a person or an agent (today, this month, pause state)
- [engine.spend.pause_all](../capabilities/engine.spend.pause_all.md): Pause all AI spend in the Space
- [engine.spend.raise](../capabilities/engine.spend.raise.md): Raise a limit once or for good (the Needs you card "Raise once or Stop"); an agent asking passes the Gate
- [engine.spend.resume_all](../capabilities/engine.spend.resume_all.md): Resume AI spend after a pause
- [engine.stop](../capabilities/engine.stop.md): Stop one agent working in a thread (per-agent Stop)
- [engine.stop_all](../capabilities/engine.stop_all.md): Stop every agent working in a thread (Stop all in the conversation header)
- [engine.subscription_share.set](../capabilities/engine.subscription_share.set.md): Let the Space run work on my subscription (server runs for my chats, routines and personal automations); off kills my sandbox
- [engine.switch](../capabilities/engine.switch.md): Switch engine mid-chat: the new engine starts from the rolling summary, the last turns and a pointer to the transcript
- [engine.turn.append](../capabilities/engine.turn.append.md): Persist a coalesced chunk of a running turn (text, tool call, tool result, block)
- [engine.turn.enqueue](../capabilities/engine.turn.enqueue.md): Queue a turn for a responder (message, interrupt, wake or handoff)
- [engine.turn.fallback](../capabilities/engine.turn.fallback.md): Record a fallback during a turn error: another model or the backup key
- [engine.turn.finish](../capabilities/engine.turn.finish.md): End a turn as completed, failed or cancelled; always releases the lease
- [engine.turn.get](../capabilities/engine.turn.get.md): What happened: steps, durations, machine, model, key used and denials of one turn
- [engine.turn.record_usage](../capabilities/engine.turn.record_usage.md): Meter usage during a turn; over an agent.toml or Space limit it stops the turn and raises agent.limit_hit
- [engine.turn.retry](../capabilities/engine.turn.retry.md): Retry a failed turn, optionally on another model or backup key (the next step on a turn error)
- [engine.turn.start](../capabilities/engine.turn.start.md): Start a queued turn on the placement chosen (host or device); records account, engine and model
- [engine.turn.wait](../capabilities/engine.turn.wait.md): Park a turn until a task, an answered block, a run or a time
- [engine.turns.list](../capabilities/engine.turns.list.md): Turns of a thread, newest first
- [engine.usage.query](../capabilities/engine.usage.query.md): Usage by day, person, agent or model; people see their own, managers their agents, admins all
- [engine.use_policy.export](../capabilities/engine.use_policy.export.md): Export the AI use policy (models, providers, label rules, limits, accounts) as a file
- [engine.warm](../capabilities/engine.warm.md): Hint that a thread was opened or the composer got focus: warm the engine session (drivers pool, prefix cache)

## Events (25)

- [agent.blocked](../events/agent.blocked.md): An agent is blocked (login, key, site down) and asks for what would unblock it
- [agent.limit_hit](../events/agent.limit_hit.md): An agent hit a limit from agent.toml or a Space cap; the turn stopped
- [agent.mode_changed](../events/agent.mode_changed.md): An agent switched between Leading and Listening in a thread
- [agent.model_changed](../events/agent.model_changed.md): The model, provider, effort or account of an agent in a thread changed
- [agent.task_finished](../events/agent.task_finished.md): A long agent task finished
- [engine.policy_changed](../events/engine.policy_changed.md): AI policies changed
- [engine.runtime_opt_in_changed](../events/engine.runtime_opt_in_changed.md): A person changed whether the Space may continue their chats when their computer is off
- [engine.subscription_share_changed](../events/engine.subscription_share_changed.md): A person changed whether the Space may run work on their subscription
- [incident.assigned](../events/incident.assigned.md): An AI incident was assigned
- [incident.opened](../events/incident.opened.md): An AI incident was opened
- [incident.resolved](../events/incident.resolved.md): An AI incident was resolved
- [review.marked](../events/review.marked.md): A sampled turn was reviewed
- [spend.caps_changed](../events/spend.caps_changed.md): Spend caps changed
- [spend.paused](../events/spend.paused.md): All AI spend was paused
- [spend.raised](../events/spend.raised.md): A limit was raised
- [spend.resumed](../events/spend.resumed.md): AI spend resumed
- [turn.block](../events/turn.block.md): A coalesced chunk of a running turn was persisted
- [turn.cancelled](../events/turn.cancelled.md): A turn was cancelled by Stop or Interrupt
- [turn.completed](../events/turn.completed.md): A turn finished
- [turn.engine_switched](../events/turn.engine_switched.md): The engine of a chat changed (the quiet line in the thread)
- [turn.failed](../events/turn.failed.md): A turn failed; the thread accepts the next message as a fresh turn
- [turn.fallback_used](../events/turn.fallback_used.md): A turn error fell back to another model or the backup key
- [turn.queued](../events/turn.queued.md): A turn was queued for an agent in a thread
- [turn.started](../events/turn.started.md): A turn started on a host or device
- [turn.waiting](../events/turn.waiting.md): A turn parked and waits on a task, an answer, a run or a time
