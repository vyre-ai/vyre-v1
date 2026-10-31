# records.activity

What happened to a record, newest first: created, field edits with who, when and the old and new value, stage moves, links, removals and sync pushes

| | |
|---|---|
| Module | records |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | grant only |
| Grant level | view |
| Risk | low |
| Resource | record (/recordId) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/records/activity |
| MCP tool | records_activity (records) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  type: string;
  recordId: string;
  limit?: number;
  before?: number;
};
```

## Output

```ts
type Out = {
  entries: Array<{
      id: string;
      kind: "created" | "edited" | "stage" | "linked" | "unlinked" | "removed" | "restored" | "synced";
      at: number;
      actor: string;
      field?: string;
      from?: unknown;
      to?: unknown;
    }>;
  next?: number;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- validation.bad_input
- validation.not_found

## Example

```json
{
  "name": "example",
  "input": {
    "before": 1760000000000,
    "limit": 1,
    "recordId": "rec_a1b2c3",
    "type": "contact"
  },
  "output": {
    "entries": [
      {
        "actor": "example",
        "at": 1760000000000,
        "field": "example",
        "from": {},
        "id": "example",
        "kind": "created",
        "to": {}
      }
    ],
    "next": 1760000000000
  }
}
```
