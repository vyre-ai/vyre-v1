# spaces.delete_cancel

Owner or an admin: cancel the scheduled deletion with one click; the Space carries on and every admin is told

| | |
|---|---|
| Module | spaces |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | manage |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/spaces/delete_cancel |
| MCP tool | spaces_delete_cancel (meta) |
| CLI | none |
| Emits | space.deletion_cancelled |

## Input

```ts
type In = Record<string, unknown>;
```

## Output

```ts
type Out = {
  ok: boolean;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- validation.bad_input
- validation.precondition_failed

## Example

```json
{
  "name": "example",
  "input": {},
  "output": {
    "ok": true
  }
}
```
