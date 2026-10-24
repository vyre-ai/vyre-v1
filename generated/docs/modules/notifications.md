# Notifications (notifications)

Lane L6. Kind module. Version 0.1.0.

Requires: chat, runs, tasks, vault.

## Capabilities (19)

- [notifications.away.clear](../capabilities/notifications.away.clear.md): I'm Back: end away and return what waited
- [notifications.away.get](../capabilities/notifications.away.get.md): Am I away, until when, and who holds my approvals
- [notifications.away.set](../capabilities/notifications.away.set.md): Set myself away until a time; approvals go to a person, a role or no one; only calls interrupt
- [notifications.counts](../capabilities/notifications.counts.md): Counts for the rail (Needs you and direct conversations only) and a quiet dot per other place
- [notifications.delegate.get](../capabilities/notifications.delegate.get.md): My standing approvals delegate chain (delegate, next delegate, role)
- [notifications.delegate.resolve](../capabilities/notifications.delegate.resolve.md): Walk a person's delegate chain for an item and return the first holder who can act on it (access evaluated for each)
- [notifications.delegate.set](../capabilities/notifications.delegate.set.md): Set my standing approvals delegate chain; a delegate never gains access
- [notifications.digest.collect](../capabilities/notifications.digest.collect.md): Gather digest-level items for a person and period (input to the While you were away digest)
- [notifications.kinds.list](../capabilities/notifications.kinds.list.md): The notification kinds with level and place, for the settings page
- [notifications.list](../capabilities/notifications.list.md): My notifications by place and level, newest first
- [notifications.mark_seen](../capabilities/notifications.mark_seen.md): Mark notifications seen by ids or for a whole place
- [notifications.mute.clear](../capabilities/notifications.mute.clear.md): End a mute
- [notifications.mute.list](../capabilities/notifications.mute.list.md): My active mutes
- [notifications.mute.set](../capabilities/notifications.mute.set.md): Mute a sender, channel, record or thread (default one hour)
- [notifications.push.register](../capabilities/notifications.push.register.md): Register this device push token for the person
- [notifications.push.unregister](../capabilities/notifications.push.unregister.md): Remove this device push token
- [notifications.rules.get](../capabilities/notifications.rules.get.md): My notification settings: working hours, email backstop, muted agents, channels and records
- [notifications.rules.set](../capabilities/notifications.rules.set.md): Adjust my notification settings (settings only adjusts; nothing is required)
- [notifications.send](../capabilities/notifications.send.md): Notify a person of a kind; collapses repeats, respects hours, mutes and away, enforces the agent interrupt cap and the one-device rule

## Events (10)

- [away.cleared](../events/away.cleared.md): A person is back; what waited is summarised
- [away.set](../events/away.set.md): A person set themselves away until a time with an approvals delegate
- [notification.capped](../events/notification.capped.md): An agent hit the interrupt cap; the notification went to the digest and the agent was told
- [notification.delegate_changed](../events/notification.delegate_changed.md): A standing approvals delegate chain changed
- [notification.delivered](../events/notification.delivered.md): A notification was delivered to a person at its level
- [notification.muted](../events/notification.muted.md): A sender, channel or record was muted for a time
- [notification.push_registered](../events/notification.push_registered.md): A device registered a push token (token value not in the event)
- [notification.rules_changed](../events/notification.rules_changed.md): Notification settings changed (hours, backstop, mutes)
- [notification.seen](../events/notification.seen.md): Notifications were marked seen
- [notification.unmuted](../events/notification.unmuted.md): A mute ended or was cleared
