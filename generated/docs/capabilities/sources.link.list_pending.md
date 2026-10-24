# sources.link.list_pending

Unsure matches waiting for a person (they also arrive in Needs you)

| | |
|---|---|
| Module | sources |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | grant only |
| Grant level | view |
| Risk | low |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/sources/link/list_pending |
| MCP tool | sources_link_list_pending (records) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  type?: string;
  cursor?: string;
  limit?: number;
};
```

## Output

```ts
type Out = {
  pending: Array<{
      matchId: string;
      deliveryId: string;
      sourceId: string;
      type: string;
      row: Record<string, unknown>;
      candidates: Array<{
          recordId: string;
          type: string;
          score: number;
          reasons: Array<string>;
        }>;
    }>;
  next?: string;
  total?: number;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- validation.bad_input

## Example

```json
{
  "name": "example",
  "input": {
    "cursor": "example",
    "limit": 1,
    "type": "contact"
  },
  "output": {
    "next": "example",
    "pending": [
      {
        "candidates": [
          {
            "reasons": [
              "example"
            ],
            "recordId": "rec_a1b2c3",
            "score": 1,
            "type": "contact"
          }
        ],
        "deliveryId": "dlv_a1b2c3",
        "matchId": "mat_a1b2c3",
        "row": {},
        "sourceId": "src_a1b2c3",
        "type": "contact"
      }
    ],
    "total": 1
  }
}
```
