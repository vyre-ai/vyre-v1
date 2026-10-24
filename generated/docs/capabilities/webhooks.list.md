# webhooks.list

List outgoing webhooks

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
| HTTP | POST /v1/webhooks/list |
| MCP tool | webhooks_list (engineer) |
| CLI | vyre webhooks list |
| Emits | none |

## Input

```ts
type In = {
  cursor?: string;
  limit?: number;
};
```

## Output

```ts
type Out = {
  webhooks: Array<{
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
    "limit": 1
  },
  "output": {
    "next": "example",
    "total": 1,
    "webhooks": [
      {
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
    ]
  }
}
```
