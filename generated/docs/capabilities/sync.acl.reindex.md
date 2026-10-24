# sync.acl.reindex

Emit synthetic upsert or hide changes for rows whose visibility changed after a grant, revoke or label change

| | |
|---|---|
| Module | sync |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | edit |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/sync/acl/reindex |
| MCP tool | none |
| CLI | none |
| Emits | sync.scope_changed |

## Input

```ts
type In = {
  resourceType: string;
  resourceId: string;
  entity?: string;
};
```

## Output

```ts
type Out = {
  changed: number;
  scopeChanged: boolean;
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
    "entity": "example",
    "resourceId": "example",
    "resourceType": "example"
  },
  "output": {
    "changed": 1,
    "scopeChanged": true
  }
}
```
