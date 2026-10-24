# backup.export_start

Start the owner full export as a zip (never secret values, never other people private chats or personal memory)

| | |
|---|---|
| Module | backup |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | server.backups |
| Grant level | manage |
| Risk | high |
| Resource | space |
| Gate | none |
| Idempotency | key |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/backup/export_start |
| MCP tool | none |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  idempotencyKey: string;
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
- permission.no_grant
- permission.role_lacks_permission
- validation.bad_input

## Example

```json
{
  "name": "example",
  "input": {
    "idempotencyKey": "idem_1"
  },
  "output": {
    "runId": "run_a1b2c3"
  }
}
```
