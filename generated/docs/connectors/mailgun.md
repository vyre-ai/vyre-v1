# Mailgun

Key mailgun, module mailgun. Mode api, owned by a space. Auth api_key.

## Egress domains

- api.mailgun.net
- api.eu.mailgun.net

## Secrets (names only)

- Mailgun_Key: Mailgun private API key for the Space
- Mailgun_Signing_Key: HTTP webhook signing key for /hooks/mailgun and /hooks/mail/mailgun

## Webhook sources

- /hooks/mailgun (hmac) emits mailgun.event_received
- /hooks/mail/mailgun (hmac) emits mailgun.inbound_received

## Actions

- mailgun.send_email
- mailgun.events.list
- mailgun.domains.list
- mailgun.domains.get
- mailgun.domains.create
- mailgun.domains.verify
- mailgun.domains.delete
- mailgun.routes.list
- mailgun.routes.create
- mailgun.routes.delete
- mailgun.health
- mailgun.receive_webhook
- mailgun.receive_inbound

## Synced types

