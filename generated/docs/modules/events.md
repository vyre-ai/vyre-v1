# Events and webhooks (events)

Lane L6. Kind module. Status stub. Version 0.1.0.

Requires: nothing.

## Capabilities (16)

- [events.get](../capabilities/events.get.md): Read one event by id
- [events.list](../capabilities/events.list.md): Search the event log by type, subject, actor, Run, trace and time
- [events.replay](../capabilities/events.replay.md): Replay a failed Run, a trace, a sync conflict or an event range against a copy of the Space; outward effects are recorded, not executed
- [events.since](../capabilities/events.since.md): Events after a cursor, in order, filtered for the reader; the catch-up call behind subscribe
- [events.types](../capabilities/events.types.md): The event catalogue: names, versions, schemas, and which can start an Automation or raise a notification
- [webhooks.create](../capabilities/webhooks.create.md): Create an outgoing webhook for event types with an optional filter; returns the signing secret once
- [webhooks.delete](../capabilities/webhooks.delete.md): Delete a webhook; pending deliveries are dropped
- [webhooks.deliveries](../capabilities/webhooks.deliveries.md): The delivery log of a webhook: state, attempts, status code, last error
- [webhooks.get](../capabilities/webhooks.get.md): Read one webhook
- [webhooks.health](../capabilities/webhooks.health.md): Cheap health probe of outgoing delivery: consumer lag and the failure rate
- [webhooks.list](../capabilities/webhooks.list.md): List outgoing webhooks
- [webhooks.replay_delivery](../capabilities/webhooks.replay_delivery.md): Send a past delivery again with the same body and a fresh signature
- [webhooks.rotate_secret](../capabilities/webhooks.rotate_secret.md): Rotate the signing secret; returns the new secret once
- [webhooks.send_delivery](../capabilities/webhooks.send_delivery.md): Deliver one event to one webhook with HMAC signature and trace header, retrying with backoff (called by the events.webhooks_out consumer)
- [webhooks.test](../capabilities/webhooks.test.md): Send a sample signed event to the webhook URL and report the answer
- [webhooks.update](../capabilities/webhooks.update.md): Change the name, URL, event types, filter or active state of a webhook

## Events (7)

- [webhook.created](../events/webhook.created.md): An outgoing webhook was created
- [webhook.deleted](../events/webhook.deleted.md): An outgoing webhook was deleted
- [webhook.delivered](../events/webhook.delivered.md): A webhook delivery succeeded
- [webhook.delivery_failed](../events/webhook.delivery_failed.md): A webhook delivery attempt failed
- [webhook.disabled](../events/webhook.disabled.md): A webhook was disabled after repeated failures
- [webhook.secret_rotated](../events/webhook.secret_rotated.md): The signing secret of a webhook was rotated (value not in the event)
- [webhook.updated](../events/webhook.updated.md): An outgoing webhook changed
