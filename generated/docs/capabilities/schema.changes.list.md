# schema.changes.list

History of schema changes with who and why

| | |
|---|---|
| Module | schema |
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
| HTTP | POST /v1/schema/changes/list |
| MCP tool | schema_changes_list (records) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  type?: string;
  since?: number;
  cursor?: string;
  limit?: number;
};
```

## Output

```ts
type Out = {
  changes: Array<{
      changeId: string;
      at: number;
      by: string;
      summary: string;
      destructive: boolean;
      types: Array<string>;
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
    "since": 1760000000000,
    "type": "contact"
  },
  "output": {
    "changes": [
      {
        "at": 1760000000000,
        "by": "example",
        "changeId": "sch_a1b2c3",
        "destructive": true,
        "summary": "example",
        "types": [
          "contact"
        ]
      }
    ],
    "next": "example",
    "total": 1
  }
}
```
