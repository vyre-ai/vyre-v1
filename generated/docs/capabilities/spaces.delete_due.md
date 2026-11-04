# spaces.delete_due

Host only: when the scheduled date has passed, remove the Space's data and stop serving it

| | |
|---|---|
| Module | spaces |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | view |
| Risk | high |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/spaces/delete_due |
| MCP tool | spaces_delete_due (meta) |
| CLI | none |
| Emits | space.deleted |

## Input

```ts
type In = Record<string, unknown>;
```

## Output

```ts
type Out = {
  deleted: boolean;
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
  "input": {},
  "output": {
    "deleted": true
  }
}
```
