# webhooks.deliveries

The delivery log of a webhook: state, attempts, status code, last error

| | |
|---|---|
| Module | events |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | connectors.manage |
| Grant level | view |
| Risk | low |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/webhooks/deliveries |
| MCP tool | webhooks_deliveries (engineer) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  webhookId: string;
  states?: Array<"pending" | "retrying" | "delivered" | "failed" | "gave_up">;
  cursor?: string;
  limit?: number;
};
```

## Output

```ts
type Out = {
  deliveries: Array<{
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
    }>;
  next?: string;
  total?: number;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- permission.role_lacks_permission
- validation.bad_input

## Example

```json
{
  "name": "example",
  "input": {
    "cursor": "example",
    "limit": 1,
    "states": [
      "pending"
    ],
    "webhookId": "whk_a1b2c3"
  },
  "output": {
    "deliveries": [
      {
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
    ],
    "next": "example",
    "total": 1
  }
}
```
