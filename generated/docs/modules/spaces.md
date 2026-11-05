# Spaces (spaces)

Lane L7a. Kind module. Version 0.1.0.

Requires: access, members.

## Capabilities (24)

- [follows.list](../capabilities/follows.list.md): What I follow
- [follows.toggle](../capabilities/follows.toggle.md): Follow or unfollow something so its updates reach my Inbox
- [spaces.delete](../capabilities/spaces.delete.md): Owner only: schedule the Space for deletion 14 days out after typing its legal name. Needs an export from the last 24 hours, or withoutExport. Everything keeps working until the date
- [spaces.delete_cancel](../capabilities/spaces.delete_cancel.md): Owner or an admin: cancel the scheduled deletion with one click; the Space carries on and every admin is told
- [spaces.delete_due](../capabilities/spaces.delete_due.md): Host only: when the scheduled date has passed, remove the Space's data and stop serving it
- [spaces.export](../capabilities/spaces.export.md): Owner one-click export: a zip of records, files, chats and settings; never secret values, never others' private chats or personal memory
- [spaces.export_latest](../capabilities/spaces.export_latest.md): When the newest finished export of this Space was taken, or nothing when none was; Delete this Space asks for one from the last 24 hours
- [spaces.get](../capabilities/spaces.get.md): The Space profile: name, legal name, logo, address, hosting, defaults, kind
- [spaces.image](../capabilities/spaces.image.md): The Space image for its faces (the rail tile, the switcher, the join and sign-in pages, invites): a data: address of the picture, sent only when it differs from the logoFileId the caller already shows
- [spaces.leave](../capabilities/spaces.leave.md): Leave this Space; the local folder is wiped and the server stops serving this person (the owner must transfer first)
- [spaces.matrix](../capabilities/spaces.matrix.md): Which features work in this Space and which need a Team Space (the Personal matrix)
- [spaces.onboarding.complete](../capabilities/spaces.onboarding.complete.md): Mark a checklist step done (steps also complete themselves when the event happens)
- [spaces.onboarding.dismiss](../capabilities/spaces.onboarding.dismiss.md): Hide the checklist
- [spaces.onboarding.flow](../capabilities/spaces.onboarding.flow.md): My onboarding screen for one flow (personal, team or member): each step done or put off, and whether the screen has opened for me
- [spaces.onboarding.get](../capabilities/spaces.onboarding.get.md): The first-run checklist for me: steps done, steps left
- [spaces.onboarding.mark](../capabilities/spaces.onboarding.mark.md): Mark an onboarding step done, put it off, or open it again
- [spaces.onboarding.seen](../capabilities/spaces.onboarding.seen.md): Note that the onboarding screen has opened for me once, so it does not open by itself again
- [spaces.switch_address](../capabilities/spaces.switch_address.md): Move the Space between the relay and an own domain; devices pin the Space key, so nobody is re-invited
- [spaces.switcher](../capabilities/spaces.switcher.md): This Space tile for the switcher: name, logo, kind, role, and whether it needs the person (red dot)
- [spaces.timezone.set](../capabilities/spaces.timezone.set.md): Set the Space time zone (an IANA name). Shared places read times in it; each person sees their own beside it. Deadlines keep their moment. An agent needs an admin to approve
- [spaces.transfer_ownership](../capabilities/spaces.transfer_ownership.md): Owner only: hand the Space to another person
- [spaces.update](../capabilities/spaces.update.md): Change the Space name, legal name, logo or defaults
- [stars.list](../capabilities/stars.list.md): My starred things, newest first
- [stars.toggle](../capabilities/stars.toggle.md): Star or unstar anything; starring a person or company offers Also follow

## Events (12)

- [follow.added](../events/follow.added.md): Something was followed
- [follow.removed](../events/follow.removed.md): A follow was removed
- [onboarding.dismissed](../events/onboarding.dismissed.md): The first-run checklist was dismissed
- [onboarding.step_completed](../events/onboarding.step_completed.md): A first-run checklist step was done
- [space.address_changed](../events/space.address_changed.md): The Space address moved between relay and an own domain; devices keep the pinned Space key
- [space.deleted](../events/space.deleted.md): The Space was deleted: its owner scheduled it and the date passed
- [space.deletion_cancelled](../events/space.deletion_cancelled.md): An admin cancelled the scheduled deletion; the Space carries on (every admin gets an Inbox line and an email)
- [space.deletion_scheduled](../events/space.deletion_scheduled.md): The owner scheduled the Space for deletion; everything is removed on the date unless an admin cancels (every admin gets an Inbox line and an email)
- [space.ownership_transferred](../events/space.ownership_transferred.md): Ownership moved to another person
- [space.updated](../events/space.updated.md): The Space profile changed (name, legal name, logo, defaults)
- [star.added](../events/star.added.md): Something was starred
- [star.removed](../events/star.removed.md): A star was removed
