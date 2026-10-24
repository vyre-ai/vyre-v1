# webhooks.send_delivery

Deliver one event to one webhook with HMAC signature and trace header, retrying with backoff (called by the events.webhooks_out consumer)

| | |
|---|---|
| Module | events |
| Version | 1 (since 1.0.0) |
| Effects | outward |
| Permission | grant only |
| Grant level | use |
| Risk | high |
| Resource | space |
| Gate | none |
| Idempotency | key |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/webhooks/send_delivery |
| MCP tool | none |
| CLI | none |
| Emits | webhook.delivered, webhook.delivery_failed, webhook.disabled |

## Input

```ts
type In = {
  webhookId: string;
  eventId: string;
  attempt: number;
  idempotencyKey: string;
};
```

## Output

```ts
type Out = {
  delivery: {
    id: string;
    webhookId: string;
    eventId: string;
    eventType: string;
    state: "pending" | "retrying" | "delivered" | "failed" | "gave_up";
    attempts: number;
    httpStatus?: number;
    lastError?: string;
    at: number;
    nextAttemptAt?: number;
    durationMs?: number;
  };
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- provider.network
- provider.unavailable
- validation.bad_input

## Example

```json
{
  "name": "example",
  "input": {
    "attempt": 1,
    "eventId": "evt_a1b2c3",
    "idempotencyKey": "idem_1",
    "webhookId": "whk_a1b2c3"
  },
  "output": {
    "delivery": {
      "at": 1760000000000,
      "attempts": 1,
      "durationMs": 1,
      "eventId": "evt_a1b2c3",
      "eventType": "example",
      "httpStatus": 1,
      "id": "dlv_a1b2c3",
      "lastError": "example",
      "nextAttemptAt": 1760000000000,
      "state": "pending",
      "webhookId": "whk_a1b2c3"
    }
  }
}
```
