# Resend

Key resend, module resend. Mode api, owned by a space. Auth api_key.

## Egress domains

- api.resend.com

## Secrets (names only)

- Resend_Key: Resend API key for the Space
- Resend_Webhook_Secret: Signing secret for /hooks/resend and /hooks/mail/resend

## Webhook sources

- /hooks/resend (hmac) emits resend.event_received
- /hooks/mail/resend (hmac) emits resend.inbound_received

## Actions

- resend.send_email
- resend.get_email
- resend.domains.list
- resend.domains.get
- resend.domains.create
- resend.domains.verify
- resend.domains.delete
- resend.inbound.get_email
- resend.health
- resend.receive_webhook
- resend.receive_inbound

## Synced types

