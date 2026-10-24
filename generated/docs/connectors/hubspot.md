# HubSpot

Key hubspot, module hubspot. Mode api, owned by a space. Auth oauth2.

## Egress domains

- api.hubapi.com
- app.hubspot.com

## Secrets (names only)

- HubSpot_Token: Private app token or OAuth refresh token

## Webhook sources

- /hooks/hubspot (signature) emits hubspot.webhook_received

## Actions

- hubspot.test_connection
- hubspot.list_objects
- hubspot.push_object

## Synced types

- contact from contacts
- company from companies
