# Network (network)

Lane L7b. Kind module. Version 0.1.0.

Requires: nothing.

## Capabilities (19)

- [network.certificate_renew](../capabilities/network.certificate_renew.md): Renew a certificate now
- [network.domain_set](../capabilities/network.domain_set.md): Set the Space address to an own domain (DNS check, then ACME)
- [network.endpoints](../capabilities/network.endpoints.md): Endpoint list for the connection manager: direct, relay and tunnel with health and round trip time
- [network.enroll](../capabilities/network.enroll.md): A computer asks to join the Space with a join code and its own public key; it waits for approval (called by the computer, no sign-in)
- [network.enroll_status](../capabilities/network.enroll_status.md): A waiting computer asks whether it was approved by signing a fresh timestamp with its key; approved, it receives its credential once (called by the computer, no sign-in)
- [network.health](../capabilities/network.health.md): Network health probe: certificate expiry and relay reachability
- [network.ingress_check](../capabilities/network.ingress_check.md): Check whether forms and webhooks can reach this Space from outside
- [network.my_computer_approve](../capabilities/network.my_computer_approve.md): Admit your own waiting computer
- [network.my_computer_code](../capabilities/network.my_computer_code.md): Make a join code for your own computer (a Mac, PC or Linux box): it will run only your own agents
- [network.my_computer_decline](../capabilities/network.my_computer_decline.md): Turn your own waiting computer away
- [network.public_hostnames](../capabilities/network.public_hostnames.md): Public hostnames and /hooks endpoints served by this Space
- [network.relay_set](../capabilities/network.relay_set.md): Switch the Space to the relay or back, with no re-invite (devices pin the Space key, not the address)
- [network.server_approve](../capabilities/network.server_approve.md): Admit a waiting computer to the Space: a person looks at its name, what it runs on and its fingerprint and approves once
- [network.server_decline](../capabilities/network.server_decline.md): Turn a waiting computer away
- [network.server_join_code](../capabilities/network.server_join_code.md): Make a join code to add a cloud box or office Mac for compute
- [network.server_reconnect](../capabilities/network.server_reconnect.md): Reconnect an offline server
- [network.server_remove](../capabilities/network.server_remove.md): Remove a server from the Space
- [network.servers](../capabilities/network.servers.md): Computers in the Space (the Space server and the computers that joined for compute, waiting ones included): grey rows when offline, with Reconnect and Remove
- [network.status](../capabilities/network.status.md): Address, certificate state, relay state and public ingress

## Events (6)

- [network.certificate_failed](../events/network.certificate_failed.md): Certificate issue or renewal failed
- [network.certificate_renewed](../events/network.certificate_renewed.md): A certificate was issued or renewed
- [network.domain_changed](../events/network.domain_changed.md): The Space address changed (own domain or relay)
- [network.server_added](../events/network.server_added.md): A server joined the Space for compute
- [network.server_removed](../events/network.server_removed.md): A server was removed
- [network.server_requested](../events/network.server_requested.md): A computer asked to join the Space and waits for a person to approve it
