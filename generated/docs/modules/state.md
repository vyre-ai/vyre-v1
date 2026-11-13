# State (state)

Lane L7a. Kind module. Version 0.1.0.

Requires: nothing.

## Capabilities (13)

- [state.arrive](../capabilities/state.arrive.md): Host only: a new entry reached a thing; raise its head and every audience member's unread, in one transaction. Idempotent on position
- [state.counts](../capabilities/state.counts.md): My badges: for each scope how many things have something unread (not done, not muted) and how many entries that is
- [state.forget](../capabilities/state.forget.md): Host only: a thing was deleted; every row and count of it goes
- [state.gain](../capabilities/state.gain.md): Host only: a person gets access to a scope; they start with nothing unread and keep the flags they had
- [state.get](../capabilities/state.get.md): My state on up to 500 things: how far I read, unread, done, starred, followed, muted
- [state.list](../capabilities/state.list.md): My things by what I did with them: starred, following, done, unread or muted
- [state.lose](../capabilities/state.lose.md): Host only: a person loses access to a scope; its rows leave their lists and badge, done and star are kept
- [state.merge](../capabilities/state.merge.md): Host only: one thing became part of another; merge each person's flags and recount
- [state.read](../capabilities/state.read.md): Mark a thing read up to a position, mark it unread, or mark it unread from a position. Give exactly one of upto, unread, fromPos
- [state.read_scope](../capabilities/state.read_scope.md): Mark everything in one badge read, or only what arrived before a time
- [state.retract](../capabilities/state.retract.md): Host only: an entry was removed from a thing; recount every row of it from its entries
- [state.set](../capabilities/state.set.md): Mark a thing done or open again, star it, follow or leave it, set Alert me on replies, or mute it. Give at least one
- [state.verify](../capabilities/state.verify.md): Host only: compare every head, unread and badge with the entries and the rows; with repair, fix what differs. Runs at module start and in the doctor

## Events (1)

- [state.changed](../events/state.changed.md): One person's state on one thing changed: read, done, star, follow or mute
