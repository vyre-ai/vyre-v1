# Mailgun (mailgun)

Lane L5. Kind connector. Status stub. Version 0.1.0.

Requires: nothing.

## Capabilities (13)

- [mailgun.domains.create](../capabilities/mailgun.domains.create.md): Create a domain in Mailgun and return the DNS records for SPF, DKIM and DMARC
- [mailgun.domains.delete](../capabilities/mailgun.domains.delete.md): Delete a domain from Mailgun
- [mailgun.domains.get](../capabilities/mailgun.domains.get.md): Read one domain with the DNS records to publish
- [mailgun.domains.list](../capabilities/mailgun.domains.list.md): List domains in the Mailgun account
- [mailgun.domains.verify](../capabilities/mailgun.domains.verify.md): Ask Mailgun to verify the published DNS records
- [mailgun.events.list](../capabilities/mailgun.events.list.md): List delivery events for a domain, optionally for one message
- [mailgun.health](../capabilities/mailgun.health.md): Health probe: domain verification state
- [mailgun.receive_inbound](../capabilities/mailgun.receive_inbound.md): Record a verified inbound route delivery after dedupe and land it with mail.ingest
- [mailgun.receive_webhook](../capabilities/mailgun.receive_webhook.md): Record a verified Mailgun delivery event after dedupe and apply it with mail.status_update
- [mailgun.routes.create](../capabilities/mailgun.routes.create.md): Create a route that forwards inbound mail for an address to /hooks/mail/mailgun
- [mailgun.routes.delete](../capabilities/mailgun.routes.delete.md): Delete a Mailgun route
- [mailgun.routes.list](../capabilities/mailgun.routes.list.md): List Mailgun routes
- [mailgun.send_email](../capabilities/mailgun.send_email.md): Send one email through Mailgun (the send.email backend behind mail.send)

## Events (2)

- [mailgun.event_received](../events/mailgun.event_received.md): A verified Mailgun delivery event arrived
- [mailgun.inbound_received](../events/mailgun.inbound_received.md): A verified Mailgun inbound email arrived
