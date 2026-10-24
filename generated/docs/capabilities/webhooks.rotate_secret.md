# webhooks.rotate_secret

Rotate the signing secret; returns the new secret once

| | |
|---|---|
| Module | events |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | connectors.manage |
| Grant level | edit |
| Risk | high |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/webhooks/rotate_secret |
| MCP tool | webhooks_rotate_secret (engineer) |
| CLI | none |
| Emits | webhook.secret_rotated |

## Input

```ts
type In = {
  webhookId: string;
};
```

## Output

```ts
type Out = {
  secret: string;
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
