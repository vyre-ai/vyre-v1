# schema.trash.list

Dropped fields and types still held in Trash (30 days)

| | |
|---|---|
| Module | schema |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | schema.manage |
| Grant level | view |
| Risk | low |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/schema/trash/list |
| MCP tool | schema_trash_list (engineer) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = Record<string, unknown>;
```

## Output

```ts
type Out = {
  items: Array<{
      type: string;
      field?: string;
      droppedAt: number;
      expiresAt: number;
      rows: number;
    }>;
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
  "input": {},
  "output": {
    "items": [
      {
        "droppedAt": 1760000000000,
        "expiresAt": 1760000000000,
        "field": "phone",
        "rows": 1,
        "type": "contact"
      }
    ]
  }
}
```
