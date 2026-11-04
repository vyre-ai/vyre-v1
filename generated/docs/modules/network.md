# Network (network)

Lane L7b. Kind module. Version 0.1.0.

Requires: nothing.

## Capabilities (42)

- [network.certificate_renew](../capabilities/network.certificate_renew.md): Renew a certificate now
- [network.domain_set](../capabilities/network.domain_set.md): Set the Space address to an own domain (DNS check, then ACME)
- [network.endpoints](../capabilities/network.endpoints.md): Endpoint list for the connection manager: direct, relay and tunnel with health and round trip time
- [network.enroll](../capabilities/network.enroll.md): A computer asks to join the Space with a join code and its own public key; it waits for approval (called by the computer, no sign-in)
- [network.enroll_status](../capabilities/network.enroll_status.md): A waiting computer asks whether it was approved by signing a fresh timestamp with its key; approved, it receives its credential once (called by the computer, no sign-in)
- [network.health](../capabilities/network.health.md): Network health probe: certificate expiry and relay reachability
- [network.ingress_check](../capabilities/network.ingress_check.md): Check whether forms and webhooks can reach this Space from outside
- [network.machine](../capabilities/network.machine.md): One machine with its history for a range (1 hour, 24 hours, 7 days or 30 days), what runs on it by agent and chat, and its Doctor findings
- [network.machine_alerts](../capabilities/network.machine_alerts.md): The machine alerts the asker may see: disk under 10 percent free, memory pressure, a machine offline with pinned work, a failed backup, an update waiting (the Console dot and the Inbox line)
- [network.machine_alerts_notify](../capabilities/network.machine_alerts_notify.md): Host only: send each new machine alert to the Inbox once while it lasts
- [network.machine_fix](../capabilities/network.machine_fix.md): Press a Doctor Fix on a machine: clear old caches, stop idle engine sessions, or restart a service. The host runs it; an admin for the Space server and servers it holds, the owner for their own computer. Audited
- [network.machine_move_record](../capabilities/network.machine_move_record.md): Engine only: keep the line of a turn that Automatic moved off a busy machine
- [network.machine_moves](../capabilities/network.machine_moves.md): Recent moves, Space-wide: each turn Automatic sent to another machine because the first in the order had no room, newest first. A member sees their own
- [network.machine_pin](../capabilities/network.machine_pin.md): Pin an agent to a machine so its turns always run there (waiting when it is away), or let it go
- [network.machine_place](../capabilities/network.machine_place.md): Which machine a turn goes to, given the places to try in order: the first with room, skipping a busy one, and why it moved (the Ran on line)
- [network.machine_set](../capabilities/network.machine_set.md): Set a machine's nickname, the most turns or agent computers it takes at once (empty for no limit) and Drain: no new work lands on a drained machine and what runs finishes
- [network.machines](../capabilities/network.machines.md): Every machine that runs Vyre work: the Space server, added servers and linked computers, with load, room left and alerts. A member's own computer shows an admin only name, online, capacity and Vyre's work
- [network.my_computer_approve](../capabilities/network.my_computer_approve.md): Admit your own waiting computer
- [network.my_computer_code](../capabilities/network.my_computer_code.md): Make a join code for your own computer or server (a Mac, PC or Linux box): it will run only your own agents. A nickname names it once it arrives; it also works in a Personal Space
- [network.my_computer_decline](../capabilities/network.my_computer_decline.md): Turn your own waiting computer away
- [network.my_computer_remove](../capabilities/network.my_computer_remove.md): Remove one of your own computers or servers: its access ends at once
- [network.my_computers](../capabilities/network.my_computers.md): The computers and servers you added: nickname, online state, what they run on, waiting ones with the fingerprint to compare
- [network.peer_allow](../capabilities/network.peer_allow.md): Let a new computer use this Personal Space: it gets a full copy of your chats, files, records and Vault (still locked by your password) and stays in sync
- [network.peer_conflicts](../capabilities/network.peer_conflicts.md): What syncing between your computers had to settle: the same name made on two computers while apart (one copy is renamed, both are kept), or an item kept aside whole
- [network.peer_decline](../capabilities/network.peer_decline.md): Turn away a computer that asked to use this Personal Space
- [network.peer_remove](../capabilities/network.peer_remove.md): Take a computer out of this Personal Space: it stops syncing with your other computers
- [network.peer_requests](../capabilities/network.peer_requests.md): New computers asking to use this Personal Space, each with the six-digit code its own screen shows
- [network.peer_runner](../capabilities/network.peer_runner.md): Which of your computers runs scheduled automations, routines and nightly jobs now (one at a time)
- [network.peer_server_code](../capabilities/network.peer_server_code.md): Add a server to your Personal Space: a one-time code for the install line. The server joins through Vyre's relay (no address needed), keeps a full copy in sync, keeps the Space going and runs scheduled work while your computers sleep
- [network.peers](../capabilities/network.peers.md): The computers that hold this Personal Space: each keeps a full copy and syncs with the others through the relay. This computer, whether each is awake, and when it was last seen
- [network.phone](../capabilities/network.phone.md): Your phone address on vyre.run: the name this computer holds, whether it is online, and the link that opens it on a phone
- [network.phone_claim](../capabilities/network.phone_claim.md): Claim a name like alex.vyre.run once, so a phone reaches this computer there while it is on and online. The relay only passes sealed bytes
- [network.phone_release](../capabilities/network.phone_release.md): Give up the phone address. The name stays reserved to this computer
- [network.public_hostnames](../capabilities/network.public_hostnames.md): Public hostnames and /hooks endpoints served by this Space
- [network.relay_set](../capabilities/network.relay_set.md): Switch the Space to the relay or back, with no re-invite (devices pin the Space key, not the address)
- [network.server_approve](../capabilities/network.server_approve.md): Admit a waiting computer to the Space: a person looks at its name, what it runs on and its fingerprint and approves once
- [network.server_decline](../capabilities/network.server_decline.md): Turn a waiting computer away
- [network.server_join_code](../capabilities/network.server_join_code.md): Make a join code to add a cloud box or office Mac for compute. A nickname names it once it arrives
- [network.server_reconnect](../capabilities/network.server_reconnect.md): Reconnect an offline server
- [network.server_remove](../capabilities/network.server_remove.md): Remove a server from the Space
- [network.servers](../capabilities/network.servers.md): Computers in the Space (the Space server and the computers that joined for compute, waiting ones included): grey rows when offline, with Reconnect and Remove
- [network.status](../capabilities/network.status.md): Address, certificate state, relay state and public ingress

## Events (8)

- [network.certificate_failed](../events/network.certificate_failed.md): Certificate issue or renewal failed
- [network.certificate_renewed](../events/network.certificate_renewed.md): A certificate was issued or renewed
- [network.domain_changed](../events/network.domain_changed.md): The Space address changed (own domain or relay)
- [network.machine_alert](../events/network.machine_alert.md): A machine needs a look: disk nearly full, memory pressure, offline with pinned work or a failed backup
- [network.machine_changed](../events/network.machine_changed.md): A machine was drained or undrained, its limits changed, or it ran out of room or has room again: placement caches are dropped on this
- [network.server_added](../events/network.server_added.md): A server joined the Space for compute
- [network.server_removed](../events/network.server_removed.md): A server was removed
- [network.server_requested](../events/network.server_requested.md): A computer asked to join the Space and waits for a person to approve it
