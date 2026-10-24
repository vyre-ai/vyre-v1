# backup.restore

Restore from a backup (takes a fresh backup first, replays tombstones before opening for traffic)

| | |
|---|---|
| Module | backup |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | server.backups |
| Grant level | manage |
| Risk | high |
| Resource | space |
| Gate | delete when true |
| Idempotency | natural |
| Offline | online |
| Audit | always |
| Team Space only | yes |
| HTTP | POST /v1/backup/restore |
| MCP tool | none |
| CLI | none |
| Emits | backup.restored |

## Input

```ts
type In = {
  backupId: string;
  confirm: true;
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
    "backupId": "bkp_a1b2c3",
    "confirm": true
  },
  "output": {
    "runId": "run_a1b2c3"
  }
}
```
