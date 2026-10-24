# webhooks.get

Read one webhook

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
| HTTP | POST /v1/webhooks/get |
| MCP tool | webhooks_get (engineer) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  webhookId: string;
};
```

## Output

```ts
type Out = {
  webhook: {
    id: string;
    name: string;
    url: string;
    eventTypes: Array<string>;
    filter?: unknown;
    active: boolean;
    secretHint: string;
    createdBy: string;
    createdAt: number;
    lastDeliveryAt?: number;
    failureStreak: number;
  };
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
    "webhookId": "whk_a1b2c3"
  },
  "output": {
    "webhook": {
      "active": true,
      "createdAt": 1760000000000,
      "createdBy": "example",
      "eventTypes": [
        "record.updated"
      ],
      "failureStreak": 1,
      "filter": {},
      "id": "whk_a1b2c3",
      "lastDeliveryAt": 1760000000000,
      "name": "example",
      "secretHint": "example",
      "url": "https://example.com"
    }
  }
}
```
