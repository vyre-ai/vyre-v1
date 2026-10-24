# records.history

Field history of a record: previous values and merge losers

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
| HTTP | POST /v1/records/history |
| MCP tool | records_history (records) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  type: string;
  recordId: string;
  field?: string;
};
```

## Output

```ts
type Out = {
  entries: Array<{
      field: string;
      value: unknown;
      hlc: string;
      actor: string;
      reason?: string;
    }>;
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
    "field": "example",
    "recordId": "rec_a1b2c3",
    "type": "contact"
  },
  "output": {
    "entries": [
      {
        "actor": "example",
        "field": "example",
        "hlc": "example",
        "reason": "example",
        "value": {}
      }
    ]
  }
}
```
