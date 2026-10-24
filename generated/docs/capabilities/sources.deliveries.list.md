# sources.deliveries.list

Delivery log of a source: status, provider id, error, records touched (payloads are not stored in the log)

| | |
|---|---|
| Module | sources |
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
| HTTP | POST /v1/sources/deliveries/list |
| MCP tool | sources_deliveries_list (records) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  sourceId: string;
  status?: "accepted" | "duplicate" | "rejected" | "failed" | "linked_pending";
  cursor?: string;
  limit?: number;
};
```

## Output

```ts
type Out = {
  deliveries: Array<{
      deliveryId: string;
      sourceId: string;
      receivedAt: number;
      providerId?: string;
      status: "accepted" | "duplicate" | "rejected" | "failed" | "linked_pending";
      error?: string;
      recordIds: Array<string>;
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
    "sourceId": "src_a1b2c3",
    "status": "accepted"
  },
  "output": {
    "deliveries": [
      {
        "deliveryId": "dlv_a1b2c3",
        "error": "example",
        "providerId": "example",
        "receivedAt": 1760000000000,
        "recordIds": [
          "rec_a1b2c3"
        ],
        "sourceId": "src_a1b2c3",
        "status": "accepted"
      }
    ],
    "next": "example",
    "total": 1
  }
}
```
