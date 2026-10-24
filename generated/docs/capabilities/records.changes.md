# records.changes

Change feed of a record type since a sequence number (RecordStore.changes)

| | |
|---|---|
| Module | records |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | grant only |
| Grant level | view |
| Risk | low |
| Resource | record_type (/type) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/records/changes |
| MCP tool | none |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  type: string;
  since: number;
  limit?: number;
};
```

## Output

```ts
type Out = {
  changes: Array<{
      seq: number;
      id: string;
      op: "upsert" | "patch" | "delete";
    }>;
  next: number;
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
    "limit": 1,
    "since": 1,
    "type": "contact"
  },
  "output": {
    "changes": [
      {
        "id": "rec_a1b2c3",
        "op": "upsert",
        "seq": 1
      }
    ],
    "next": 1
  }
}
```
