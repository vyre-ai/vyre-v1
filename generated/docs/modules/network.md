# Network (network)

Lane L7b. Kind module. Version 0.1.0.

Requires: nothing.

## Capabilities (12)

- [network.certificate_renew](../capabilities/network.certificate_renew.md): Renew a certificate now
- [network.domain_set](../capabilities/network.domain_set.md): Set the Space address to an own domain (DNS check, then ACME)
- [network.endpoints](../capabilities/network.endpoints.md): Endpoint list for the connection manager: direct, relay and tunnel with health and round trip time
- [network.health](../capabilities/network.health.md): Network health probe: certificate expiry and relay reachability
- [network.ingress_check](../capabilities/network.ingress_check.md): Check whether forms and webhooks can reach this Space from outside
- [network.public_hostnames](../capabilities/network.public_hostnames.md): Public hostnames and /hooks endpoints served by this Space
- [network.relay_set](../capabilities/network.relay_set.md): Switch the Space to the relay or back, with no re-invite (devices pin the Space key, not the address)
- [network.server_join_code](../capabilities/network.server_join_code.md): Make a join code to add a cloud box or office Mac for compute
- [network.server_reconnect](../capabilities/network.server_reconnect.md): Reconnect an offline server
- [network.server_remove](../capabilities/network.server_remove.md): Remove a server from the Space
- [network.servers](../capabilities/network.servers.md): Servers in the Space: grey rows when offline, with Reconnect and Remove
- [network.status](../capabilities/network.status.md): Address, certificate state, relay state and public ingress

## Events (5)

- [network.certificate_failed](../events/network.certificate_failed.md): Certificate issue or renewal failed
- [network.certificate_renewed](../events/network.certificate_renewed.md): A certificate was issued or renewed
- [network.domain_changed](../events/network.domain_changed.md): The Space address changed (own domain or relay)
- [network.server_added](../events/network.server_added.md): A server joined the Space for compute
- [network.server_removed](../events/network.server_removed.md): A server was removed
