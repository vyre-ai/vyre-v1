# backup.run

Run a backup now

| | |
|---|---|
| Module | backup |
| Version | 1 (since 1.0.0) |
| Effects | outward |
| Permission | server.backups |
| Grant level | manage |
| Risk | high |
| Resource | space |
| Gate | none |
| Idempotency | key |
| Offline | online |
| Audit | always |
| Team Space only | yes |
| HTTP | POST /v1/backup/run |
| MCP tool | backup_run (engineer) |
| CLI | none |
| Emits | backup.completed, backup.failed |

## Input

```ts
type In = {
  idempotencyKey: string;
};
```

## Output

```ts
type Out = {
  backupId: string;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.needs_team
- permission.no_grant
- permission.role_lacks_permission
- provider.network
- provider.unavailable
- validation.bad_input

## Example

```json
{
  "name": "example",
  "input": {
    "idempotencyKey": "idem_1"
  },
  "output": {
    "backupId": "bkp_a1b2c3"
  }
}
```
