# updates.apply

Update the server: backup first, apply, health check, roll back on failure

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
| HTTP | POST /v1/updates/apply |
| MCP tool | updates_apply (engineer) |
| CLI | none |
| Emits | update.started, update.completed, update.failed |

## Input

```ts
type In = {
  to?: string;
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
