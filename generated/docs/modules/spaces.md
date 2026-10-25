# Spaces (spaces)

Lane L7a. Kind module. Version 0.1.0.

Requires: access, members.

## Capabilities (16)

- [follows.list](../capabilities/follows.list.md): What I follow
- [follows.toggle](../capabilities/follows.toggle.md): Follow or unfollow something so its updates reach my Inbox
- [spaces.delete](../capabilities/spaces.delete.md): Owner only: delete the Space after typing its legal name
- [spaces.export](../capabilities/spaces.export.md): Owner one-click export: a zip of records, files, chats and settings; never secret values, never others' private chats or personal memory
- [spaces.get](../capabilities/spaces.get.md): The Space profile: name, legal name, logo, address, hosting, defaults, kind
- [spaces.leave](../capabilities/spaces.leave.md): Leave this Space; the local folder is wiped and the server stops serving this person (the owner must transfer first)
- [spaces.matrix](../capabilities/spaces.matrix.md): Which features work in this Space and which need a Team Space (the Personal matrix)
- [spaces.onboarding.complete](../capabilities/spaces.onboarding.complete.md): Mark a checklist step done (steps also complete themselves when the event happens)
- [spaces.onboarding.dismiss](../capabilities/spaces.onboarding.dismiss.md): Hide the checklist
- [spaces.onboarding.get](../capabilities/spaces.onboarding.get.md): The first-run checklist for me: steps done, steps left
- [spaces.switch_address](../capabilities/spaces.switch_address.md): Move the Space between the relay and an own domain; devices pin the Space key, so nobody is re-invited
- [spaces.switcher](../capabilities/spaces.switcher.md): This Space tile for the switcher: name, logo, kind, role, and whether it needs the person (red dot)
- [spaces.transfer_ownership](../capabilities/spaces.transfer_ownership.md): Owner only: hand the Space to another person
- [spaces.update](../capabilities/spaces.update.md): Change the Space name, legal name, logo or defaults
- [stars.list](../capabilities/stars.list.md): My starred things, newest first
- [stars.toggle](../capabilities/stars.toggle.md): Star or unstar anything; starring a person or company offers Also follow

## Events (10)

- [follow.added](../events/follow.added.md): Something was followed
- [follow.removed](../events/follow.removed.md): A follow was removed
- [onboarding.dismissed](../events/onboarding.dismissed.md): The first-run checklist was dismissed
- [onboarding.step_completed](../events/onboarding.step_completed.md): A first-run checklist step was done
- [space.address_changed](../events/space.address_changed.md): The Space address moved between relay and an own domain; devices keep the pinned Space key
- [space.deleted](../events/space.deleted.md): The Space was deleted by its owner
- [space.ownership_transferred](../events/space.ownership_transferred.md): Ownership moved to another person
- [space.updated](../events/space.updated.md): The Space profile changed (name, legal name, logo, defaults)
- [star.added](../events/star.added.md): Something was starred
- [star.removed](../events/star.removed.md): A star was removed
