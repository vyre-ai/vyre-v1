# webhooks.update

Change the name, URL, event types, filter or active state of a webhook

| | |
|---|---|
| Module | events |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | connectors.manage |
| Grant level | edit |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/webhooks/update |
| MCP tool | webhooks_update (engineer) |
| CLI | none |
| Emits | webhook.updated |

## Input

```ts
type In = {
  webhookId: string;
  name?: string;
  url?: string;
  eventTypes?: Array<string>;
  filter?: unknown | null;
  active?: boolean;
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
    "active": true,
    "eventTypes": [
      "example"
    ],
    "filter": {},
    "name": "example",
    "url": "https://example.com",
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
