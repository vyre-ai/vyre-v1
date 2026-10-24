# audit.archive

System: move audit rows older than the retention window into the encrypted archive file (called by the governance job)

| | |
|---|---|
| Module | audit |
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
| HTTP | POST /v1/audit/archive |
| MCP tool | none |
| CLI | none |
| Emits | audit.archived |

## Input

```ts
type In = {
  before: number;
};
```

## Output

```ts
type Out = {
  archived: number;
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
    "before": 1760000000000
  },
  "output": {
    "archived": 1
  }
}
```
