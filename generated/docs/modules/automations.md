# Automations (automations)

Lane L6. Kind module. Version 0.1.0.

Requires: campaigns, chat, files, forms, github, journeys, mail, meetings, records, runs, telephony.

## Capabilities (36)

- [automations.account_picks](../capabilities/automations.account_picks.md): The last account this person picked for each app
- [automations.alerts.get](../capabilities/automations.alerts.get.md): Read error alerts: who, when and where, and the escalation chain
- [automations.alerts.set](../capabilities/automations.alerts.set.md): Set error alerts: who, when (every failure or after N in a row), where (Needs you, DM, channel), and the escalation chain
- [automations.create](../capabilities/automations.create.md): Create an Automation; it starts Personal
- [automations.delete](../capabilities/automations.delete.md): Move an Automation to Trash
- [automations.fire](../capabilities/automations.fire.md): Start a run from a matched trigger event, checking self-trigger origin and the chain depth limit of 8 (called by the trigger consumer)
- [automations.followers.add](../capabilities/automations.followers.add.md): Follow an Automation to get its updates
- [automations.followers.remove](../capabilities/automations.followers.remove.md): Stop following an Automation
- [automations.get](../capabilities/automations.get.md): Read an Automation with its definition, alerts and followers
- [automations.groups.create](../capabilities/automations.groups.create.md): Create a Group
- [automations.groups.delete](../capabilities/automations.groups.delete.md): Delete a Group; its Automations become ungrouped
- [automations.groups.list](../capabilities/automations.groups.list.md): List Groups with Automation counts
- [automations.groups.rename](../capabilities/automations.groups.rename.md): Rename a Group
- [automations.list](../capabilities/automations.list.md): List Automations by section (Personal, Shared with me, Space), folder and Group
- [automations.make_personal_copy](../capabilities/automations.make_personal_copy.md): Make a Personal copy of a Space Automation; it runs with only your access
- [automations.migrate_runs](../capabilities/automations.migrate_runs.md): Move selected active runs onto a definition version without replaying finished steps
- [automations.migration_preview](../capabilities/automations.migration_preview.md): Group active runs by the step they are on before moving them to a definition version
- [automations.move](../capabilities/automations.move.md): Move an Automation into a Group, or out with null
- [automations.preview_promote](../capabilities/automations.preview_promote.md): Show what Promote to Space grants as an access diff, and which subscription keys must be replaced by shared API keys
- [automations.promote](../capabilities/automations.promote.md): Promote a Personal Automation to the Space: keeps history and versions, runs on access granted to the automation itself
- [automations.replay](../capabilities/automations.replay.md): Run a past run again on the same definition version or the current one
- [automations.restore_version](../capabilities/automations.restore_version.md): Restore an Automation to an earlier version (saved as a new version)
- [automations.retry](../capabilities/automations.retry.md): Retry a failed run of this Automation from the start or from a step
- [automations.run](../capabilities/automations.run.md): Run an Automation now with a payload (the manual trigger or a button)
- [automations.schedule_choose](../capabilities/automations.schedule_choose.md): Apply one recovery choice to a schedule whose backlog is over its cap
- [automations.set_enabled](../capabilities/automations.set_enabled.md): Turn an Automation on or off
- [automations.steps.list](../capabilities/automations.steps.list.md): The step palette: every step kind with category, input and output schema, effects and Gate act
- [automations.stop](../capabilities/automations.stop.md): Stop one run of an Automation, or all its running runs and pause it
- [automations.test](../capabilities/automations.test.md): Test an Automation with sample data: reads run for real, writes and sends are stubbed (a Run)
- [automations.triggers.list](../capabilities/automations.triggers.list.md): The trigger palette: every trigger with its payload schema, sample and whether a Personal Space can use it
- [automations.undelete](../capabilities/automations.undelete.md): Restore an Automation from Trash
- [automations.update](../capabilities/automations.update.md): Change the name, description or definition; a definition change saves a new version
- [automations.validate](../capabilities/automations.validate.md): Check a definition against the step and trigger catalogue: missing inputs, unreachable steps, loops, personal triggers that need a Team Space
- [automations.versions](../capabilities/automations.versions.md): List versions of an Automation (One History)
- [automations.webhook_url.get](../capabilities/automations.webhook_url.get.md): The inbound webhook URL of an Automation that has a webhook trigger
- [automations.webhook_url.rotate](../capabilities/automations.webhook_url.rotate.md): Rotate the secret in the webhook URL; the old URL stops working

## Events (19)

- [automation.alerts_changed](../events/automation.alerts_changed.md): Error alerts and the escalation chain changed
- [automation.copied](../events/automation.copied.md): A Space Automation was copied to a Personal Automation
- [automation.created](../events/automation.created.md): An Automation was created (Personal)
- [automation.deleted](../events/automation.deleted.md): An Automation moved to Trash
- [automation.disabled](../events/automation.disabled.md): An Automation was turned off or paused
- [automation.enabled](../events/automation.enabled.md): An Automation was turned on
- [automation.follower_added](../events/automation.follower_added.md): A follower was added
- [automation.follower_removed](../events/automation.follower_removed.md): A follower was removed
- [automation.group_created](../events/automation.group_created.md): A Group was created
- [automation.group_deleted](../events/automation.group_deleted.md): A Group was deleted; its Automations became ungrouped
- [automation.group_renamed](../events/automation.group_renamed.md): A Group was renamed
- [automation.moved](../events/automation.moved.md): An Automation moved to a Group
- [automation.promoted](../events/automation.promoted.md): A Personal Automation became a Space Automation with access granted to the automation itself
- [automation.restored](../events/automation.restored.md): An Automation came back from Trash
- [automation.run_started](../events/automation.run_started.md): An Automation run started from a trigger, by hand or in test mode
- [automation.runs_migrated](../events/automation.runs_migrated.md): Active runs moved to a later definition version without replaying finished steps
- [automation.trigger_dropped](../events/automation.trigger_dropped.md): A trigger event was ignored: self-trigger, chain depth 8 or paused
- [automation.updated](../events/automation.updated.md): An Automation definition or settings changed; a definition change saves a version
- [automation.version_restored](../events/automation.version_restored.md): An earlier version was restored as the newest version
