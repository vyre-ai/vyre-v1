# webhooks.test

Send a sample signed event to the webhook URL and report the answer

| | |
|---|---|
| Module | events |
| Version | 1 (since 1.0.0) |
| Effects | outward |
| Permission | connectors.manage |
| Grant level | use |
| Risk | high |
| Resource | space |
| Gate | none |
| Idempotency | key |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/webhooks/test |
| MCP tool | webhooks_test (engineer) |
| CLI | none |
| Emits | webhook.delivered, webhook.delivery_failed |

## Input

```ts
type In = {
  webhookId: string;
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
- permission.role_lacks_permission
- provider.network
- provider.unavailable
- validation.bad_input

## Example

```json
{
  "name": "example",
  "input": {
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
