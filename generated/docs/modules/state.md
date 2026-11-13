# State (state)

Lane L7a. Kind module. Version 0.1.0.

Requires: nothing.

## Capabilities (15)

- [state.arrive](../capabilities/state.arrive.md): Host only: a new entry reached a thing; raise its head and every audience member's unread, in one transaction. Idempotent on position
- [state.counts](../capabilities/state.counts.md): My badges: for each scope how many things have something unread (not done, not muted) and how many entries that is
- [state.forget](../capabilities/state.forget.md): Host only: a thing was deleted; every row and count of it goes
- [state.gain](../capabilities/state.gain.md): Host only: a person gets access to a scope; they start with nothing unread and keep the flags they had
- [state.get](../capabilities/state.get.md): My state on up to 500 things: how far I read, unread, done, starred, followed, muted
- [state.layout.get](../capabilities/state.layout.get.md): How I arranged my screens: my layout values (all, or the named keys). A small value for each registered key, mine alone
- [state.layout.set](../capabilities/state.layout.set.md): Set one layout value, or clear it with null. Only registered keys, each with a small size limit; it is never a place for content
- [state.list](../capabilities/state.list.md): My things by what I did with them: starred, following, done, unread, muted, pinned (in my own order) or any (everything I have set on anything: one read paints a whole screen). Each row carries the thing's whole state
- [state.lose](../capabilities/state.lose.md): Host only: a person loses access to a scope; its rows leave their lists and badge, done and star are kept
- [state.merge](../capabilities/state.merge.md): Host only: one thing became part of another; merge each person's flags and recount
- [state.read](../capabilities/state.read.md): Mark a thing read up to a position, mark it unread, or mark it unread from a position. Give exactly one of upto, unread, fromPos
- [state.read_scope](../capabilities/state.read_scope.md): Mark everything in one badge read, or only what arrived before a time
- [state.retract](../capabilities/state.retract.md): Host only: an entry was removed from a thing; recount every row of it from its entries
- [state.set](../capabilities/state.set.md): Mark a thing done or open again, star it, follow or leave it, set Alert me on replies, mute it, or pin it (`pin: {}` puts it last among my pins of this kind, `{ after: null }` first, `{ after: thing }` right below that pin; `pin: null` takes it off). Give at least one
- [state.verify](../capabilities/state.verify.md): Host only: compare every head, unread and badge with the entries and the rows; with repair, fix what differs. Runs at module start and in the doctor

## Events (3)

- [state.changed](../events/state.changed.md): One person's state on one thing changed (read, done, star, follow, mute or pin): the event carries the new state of that thing and the badge it counts in, so a screen patches its row without asking again
- [state.layout_changed](../events/state.layout_changed.md): A person's layout value changed (how they arranged a screen): their other devices take the new value
- [state.scope_read](../events/state.scope_read.md): A person marked everything in one badge read: one event for the whole badge, with its new count
