# Resend (resend)

Lane L5. Kind connector. Status stub. Version 0.1.0.

Requires: nothing.

## Capabilities (11)

- [resend.domains.create](../capabilities/resend.domains.create.md): Create a domain in Resend and return the DNS records for SPF, DKIM and DMARC
- [resend.domains.delete](../capabilities/resend.domains.delete.md): Delete a domain from Resend
- [resend.domains.get](../capabilities/resend.domains.get.md): Read one domain with the DNS records to publish
- [resend.domains.list](../capabilities/resend.domains.list.md): List domains in the Resend account
- [resend.domains.verify](../capabilities/resend.domains.verify.md): Ask Resend to verify the published DNS records
- [resend.get_email](../capabilities/resend.get_email.md): Look up the delivery status of a sent email
- [resend.health](../capabilities/resend.health.md): Health probe: GET /domains
- [resend.inbound.get_email](../capabilities/resend.inbound.get_email.md): Fetch an inbound email (body and attachments) by Resend id
- [resend.receive_inbound](../capabilities/resend.receive_inbound.md): Record a verified inbound route delivery after dedupe and land it with mail.ingest
- [resend.receive_webhook](../capabilities/resend.receive_webhook.md): Record a verified Resend delivery event after dedupe and apply it with mail.status_update
- [resend.send_email](../capabilities/resend.send_email.md): Send one email through Resend (the send.email backend behind mail.send)

## Events (2)

- [resend.event_received](../events/resend.event_received.md): A verified Resend delivery event arrived
- [resend.inbound_received](../events/resend.inbound_received.md): A verified Resend inbound email arrived
