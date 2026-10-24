# webhooks.create

Create an outgoing webhook for event types with an optional filter; returns the signing secret once

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
| Idempotency | key |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/webhooks/create |
| MCP tool | webhooks_create (engineer) |
| CLI | vyre webhooks create |
| Emits | webhook.created |

## Input

```ts
type In = {
  name: string;
  url: string;
  eventTypes: Array<string>;
  filter?: unknown;
  idempotencyKey: string;
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
  secret: string;
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
    "eventTypes": [
      "example"
    ],
    "filter": {},
    "idempotencyKey": "idem_1",
    "name": "example",
    "url": "https://example.com"
  },
  "output": {
    "secret": "example",
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
