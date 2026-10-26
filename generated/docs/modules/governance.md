# Governance (governance)

Lane L7a. Kind module. Version 0.1.0.

Requires: access.

## Capabilities (15)

- [governance.erase.apply](../capabilities/governance.erase.apply.md): Erase what a finding lists: tombstones are written, an audit entry records who and when, the next backup rotation purges the rest
- [governance.erase.find](../capabilities/governance.erase.find.md): Find everything about one contact across records, files, chats, inbox, mail, calls, memory and runs, and show it
- [governance.erase.list](../capabilities/governance.erase.list.md): Past erasures: who, when and which kinds (never what)
- [governance.holds.list](../capabilities/governance.holds.list.md): Everything under a hold
- [governance.holds.place](../capabilities/governance.holds.place.md): Place a hold on a file, channel, thread, folder or person; it shows On hold and blocks expiry and erasing
- [governance.holds.release](../capabilities/governance.holds.release.md): Release a hold
- [governance.jobs.list](../capabilities/governance.jobs.list.md): The retention jobs: last run, next run, what was removed, what a hold skipped
- [governance.jobs.run_now](../capabilities/governance.jobs.run_now.md): Run one retention job now
- [governance.jobs.tick](../capabilities/governance.jobs.tick.md): System: the daily job for one kind; deletes or compacts what is past retention and skips what a hold covers
- [governance.jobs_health](../capabilities/governance.jobs_health.md): Health probe: retention jobs ran on schedule
- [governance.retention.get](../capabilities/governance.retention.get.md): Retention for every kind of data: default, value in force, overrides, whether holds and tombstones apply
- [governance.retention.reset](../capabilities/governance.retention.reset.md): Put one kind back to its default
- [governance.retention.set](../capabilities/governance.retention.set.md): Set retention for one kind (for example 90d, 2y, forever), or for one record type when the kind is records
- [governance.tombstones.list](../capabilities/governance.tombstones.list.md): Tombstones that a restore will replay (kinds and times only)
- [governance.tombstones.reapply](../capabilities/governance.tombstones.reapply.md): System: replay every tombstone after a restore, before the Space opens for traffic; `tombstones` are the ones the Space held before the restore, which the restored database does not have

## Events (6)

- [erase.completed](../events/erase.completed.md): Erasing finished; tombstones are written and the next backup rotation purges the rest
- [erase.started](../events/erase.started.md): Erasing a person's data started (who and when; never what)
- [hold.placed](../events/hold.placed.md): A hold now blocks expiry and erasing
- [hold.released](../events/hold.released.md): A hold was released
- [retention.purged](../events/retention.purged.md): A retention job removed or compacted data of one kind (counts only)
- [tombstones.reapplied](../events/tombstones.reapplied.md): Tombstones were replayed after a restore, before the Space opened for traffic
