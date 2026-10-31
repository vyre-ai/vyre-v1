# sync_types.field_history

The earlier values of one field that a newest-wins settlement replaced: yours when the app was newer, the app's when you were

| | |
|---|---|
| Module | connectors |
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
| HTTP | POST /v1/sync_types/field_history |
| MCP tool | sync_types_field_history (records) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  type: string;
  recordId: string;
  field: string;
};
```

## Output

```ts
type Out = {
  entries: Array<{
      historyId: string;
      value: unknown;
      at?: number;
      replacedBy: "app" | "you";
      actor: string;
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
    "field": "email",
    "recordId": "rec_a1b2c3",
    "type": "contact"
  },
  "output": {
    "entries": [
      {
        "actor": "example",
        "at": 1760000000000,
        "historyId": "example",
        "replacedBy": "app",
        "value": {}
      }
    ]
  }
}
```
