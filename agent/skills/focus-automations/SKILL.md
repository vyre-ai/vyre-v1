---
name: focus-automations
description: Work in Automations. Build, fix and connect flows and Journeys; read triggers and steps; test before enabling; read failed runs; promote to the Space.
system: true
---

# Automations

An Automation is a flow that runs by itself: one or more triggers, then steps, paths, parallel branches, waits, loops, approvals and stops.
A Journey is a stage flow on a subject record. A Run is one execution, with a durable step log. Everything starts Personal and runs with only the owner's access.

## The definition
- `definition` is `{ triggers: [{ key, config?, filter? }], nodes: [{ id, key, title?, input, next?, branches?, onError?, ai? }], start?, allowSelfTrigger? }`.
  A node `key` is a step kind such as `records.update`. `next` names the node ids that follow; `branches` route by a label and a `when`.
- Do not invent step kinds or triggers. `automations_steps_list` is the palette with each step's input and output schema and whether it needs the Gate.
  `automations_triggers_list` lists triggers with payload samples and whether a Personal Space can use them (webhooks need a Team Space).
- A step reads earlier output by reference as the palette shows. Copy the reference form from a step's sample; do not write expressions from memory.
- `onError` on a node: `fail`, `continue`, `retry` (with `max`) or `route` to a node. Set it where a failure should not stop everything.
- An agent step has an `ai` block: which agent, which key and backup key, and the Assigned, Reviewer and Approver seats. Leave keys to the person.

## Building
1. `automations_list` first: the thing may exist. Extend it rather than make a twin.
2. Draft the graph. Then `automations_validate`: it names missing inputs, unreachable steps, loops and triggers a Personal Space cannot use. Fix every finding.
3. `automations_create` (starts Personal and off). `automations_test` runs it with sample data: reads run for real, writes and sends are stubbed.
   Read the run with `runs_steps`. `steps_test` tests one step.
4. Only then `automations_set_enabled`. Tell the person what will fire it and what it will do, in plain words.
5. To share it with the team: `automations_preview_promote` shows the access diff and the keys to replace; the person decides on `automations_promote`.
- Change one with `automations_update`; a definition change saves a new version. `automations_versions` lists them; `automations_restore_version` brings one back.

## Running and fixing
- `automations_run` fires one now with a payload. `runs_list` filters by owner, subject, kind and status; `runs_get` and `runs_steps` show what happened.
- A failed run: read the first failed step's error, fix the cause in the definition or the input, `automations_retry` from that step. Do not retry blind.
- `runs_stop` halts a run at the next safe point. `runs_preview_undo` then `runs_undo` reverses its writes; sent messages and deployments cannot be undone, and it says so.
- A trigger that did not fire: `automations_get` for status and filter, then `scheduler_missed` for schedules, or check a self-trigger or depth drop.
- Schedules: `scheduler_list`, `scheduler_reschedule`, `scheduler_pause`, `scheduler_run_now`. These are the automations' schedules, not yours; yours are in agent-loops.
- Error alerts: `automations_alerts_set` sets who is told, when and where, and the escalation chain.

## Journeys
- `journeys_get` shows stages, tasks (Assigned, Reviewer, Approver), stage automations, exit rules and time limits. `journeys_design` replaces the design.
  `journeys_preview_migrate` before `journeys_migrate` when in-flight records must move to a new version.

## Waiting
- To wait for an event, a run or a time inside your own turn, use `wait_for`. The turn ends and wakes on a match.
- An outward step (mail, SMS, deploy) is held for approval when an agent or an automation acts. Say what will wait and who approves.

## Habits
- Small flows with clear names. One purpose each. Say what you built as: when X happens, do A, then B, and if C fails, tell Y.
- Show the person the test run before you turn anything on.
