# Journeys (journeys)

Lane L6. Kind module. Status stub. Version 0.1.0.

Requires: nothing.

## Capabilities (15)

- [journeys.advance](../capabilities/journeys.advance.md): Check the exit rule of the current stage and advance when its required tasks are done (called on task.completed)
- [journeys.check_limits](../capabilities/journeys.check_limits.md): Find stages over their time limit, raise Needs you for the owner then the escalation role (called by the scheduler)
- [journeys.create](../capabilities/journeys.create.md): Create a Journey and its record type (cloned from the Projects template) on a subject record type
- [journeys.delete](../capabilities/journeys.delete.md): Delete a Journey with no records in flight
- [journeys.design](../capabilities/journeys.design.md): Replace the design: stages, tasks with Assigned, Reviewer and Approver, stage automations, exit rules, time limits and the start rule
- [journeys.get](../capabilities/journeys.get.md): Read a Journey design: stages, tasks, rules, time limits and the start rule
- [journeys.list](../capabilities/journeys.list.md): List Journeys with their stages count and in-flight records
- [journeys.migrate](../capabilities/journeys.migrate.md): Migrate in-flight records to a new Journey version through a stage mapping (a Run; stoppable)
- [journeys.move_stage](../capabilities/journeys.move_stage.md): Move a Journey record to another stage by hand; the reason is required and handoffs post in the record channel
- [journeys.preview_migrate](../capabilities/journeys.preview_migrate.md): Preview a migration: records per old stage, where each goes, unmapped stages and blockers
- [journeys.rename](../capabilities/journeys.rename.md): Rename a Journey
- [journeys.rules.set](../capabilities/journeys.rules.set.md): Set the exit rule and time limit of one stage
- [journeys.stage_counts](../capabilities/journeys.stage_counts.md): Records in flight per stage, with how many are over their time limit
- [journeys.start](../capabilities/journeys.start.md): Start a Journey on a subject record: creates the Journey record with its channel and folder and enters the first stage
- [journeys.versions](../capabilities/journeys.versions.md): List versions of a Journey definition

## Events (10)

- [journey.completed](../events/journey.completed.md): A Journey record reached a final stage
- [journey.created](../events/journey.created.md): A Journey and its record type were created
- [journey.deleted](../events/journey.deleted.md): A Journey was deleted
- [journey.designed](../events/journey.designed.md): The Journey design changed (stages, tasks, rules or start rule); a new version
- [journey.migrated](../events/journey.migrated.md): In-flight records moved to a new Journey version through a stage mapping
- [journey.moved](../events/journey.moved.md): A designer moved a record by hand, with a reason
- [journey.stage_entered](../events/journey.stage_entered.md): A Journey record entered a stage
- [journey.stage_exited](../events/journey.stage_exited.md): A Journey record left a stage
- [journey.started](../events/journey.started.md): A subject record started a Journey and its Journey record was created
- [journey.time_limit_breached](../events/journey.time_limit_breached.md): A stage time limit passed; it reaches the owner Needs you, then the escalation role
