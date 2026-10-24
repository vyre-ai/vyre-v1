# updates.rollback

Roll back to the previous server version

| | |
|---|---|
| Module | updates |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | server.update |
| Grant level | manage |
| Risk | high |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | always |
| Team Space only | yes |
| HTTP | POST /v1/updates/rollback |
| MCP tool | updates_rollback (engineer) |
| CLI | none |
| Emits | update.rolled_back |

## Input

```ts
type In = {
  to: string;
};
```

## Output

```ts
type Out = {
  runId: string;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.needs_team
- permission.no_grant
- permission.role_lacks_permission
- validation.bad_input

## Example

```json
{
  "name": "example",
  "input": {
    "to": "1.0.0"
  },
  "output": {
    "runId": "run_a1b2c3"
  }
}
```
