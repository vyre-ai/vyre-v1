# Machines (machines)

Lane L2. Kind module. Version 0.1.0.

Requires: nothing.

## Capabilities (5)

- [machines.alerts](../capabilities/machines.alerts.md): What needs a look: disk under 10% free, memory pressure, a machine offline with pinned work, an update waiting, a failed backup. Each says what to do
- [machines.get](../capabilities/machines.get.md): One machine with its series for 1 hour (60 one-minute points), 24 hours (144 ten-minute), 7 days (168 hourly) and 30 days (180 four-hourly), its alerts and, for the Space server, the doctor's findings. A gap is a bucket with only its time
- [machines.list](../capabilities/machines.list.md): Every machine you may see with its load, what Vyre runs on it, what it can run and its room left; agent computers nested under their host. An admin sees all, a member their own; on a member's computer an admin sees only name, online, capacity and Vyre's own work
- [machines.rooms](../capabilities/machines.rooms.md): Room left on the machines you name (ids as machines.list gives them): the number placement skips a busy machine by, and the plain words for why ("4 of 4 turns"). Only machines you may see; used by engine.placement.decide
- [machines.set](../capabilities/machines.set.md): Name a machine, set the most turns or agent computers it takes at once, drain it (no new work, what runs finishes) or pin an agent to it. A server is an admin's (and its owner's); a person's own computer is theirs, and an admin may only drain it

## Events (1)

- [machine.changed](../events/machine.changed.md): A machine was renamed, limited, drained or had an agent pinned or unpinned
