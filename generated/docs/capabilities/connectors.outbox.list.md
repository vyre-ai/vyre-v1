# connectors.outbox.list

Pending, failed and recent pushes with their idempotency keys

| | |
|---|---|
| Module | connectors |
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
| HTTP | POST /v1/connectors/outbox/list |
| MCP tool | connectors_outbox_list (records) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  type?: string;
  state?: "pending" | "sent" | "failed" | "canceled" | "undone";
  cursor?: string;
  limit?: number;
};
```

## Output

```ts
type Out = {
  items: Array<{
      outboxId: string;
      syncTypeId: string;
      recordId: string;
      op: "create" | "update" | "delete";
      fields: Array<string>;
      state: "pending" | "sent" | "failed" | "canceled" | "undone";
      attempts: number;
      idempotencyKey: string;
      error?: string;
      at: number;
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
    "state": "pending",
    "type": "contact"
  },
  "output": {
    "items": [
      {
        "at": 1760000000000,
        "attempts": 1,
        "error": "example",
        "fields": [
          "email"
        ],
        "idempotencyKey": "example",
        "op": "create",
        "outboxId": "obx_a1b2c3",
        "recordId": "rec_a1b2c3",
        "state": "pending",
        "syncTypeId": "syt_a1b2c3"
      }
    ],
    "next": "example",
    "total": 1
  }
}
```
