# governance.tombstones.reapply

System: replay every tombstone after a restore, before the Space opens for traffic; `tombstones` are the ones the Space held before the restore, which the restored database does not have

| | |
|---|---|
| Module | governance |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | view |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/governance/tombstones/reapply |
| MCP tool | none |
| CLI | none |
| Emits | tombstones.reapplied |

## Input

```ts
type In = {
  tombstones?: Array<{
      id: string;
      kind: string;
      subjectType: string;
      subjectId: string;
      at: number;
      by: string;
      findingId?: string;
    }>;
};
```

## Output

```ts
type Out = {
  count: number;
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
    "tombstones": [
      {
        "at": 1760000000000,
        "by": "example",
        "findingId": "example",
        "id": "example",
        "kind": "example",
        "subjectId": "example",
        "subjectType": "example"
      }
    ]
  },
  "output": {
    "count": 1
  }
}
```
