# backup.verify

Restore a backup into a scratch directory and check the hash chain

| | |
|---|---|
| Module | backup |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | server.backups |
| Grant level | edit |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/backup/verify |
| MCP tool | backup_verify (engineer) |
| CLI | none |
| Emits | backup.verified |

## Input

```ts
type In = {
  backupId: string;
};
```

## Output

```ts
type Out = {
  ok: boolean;
  checkedEvents: number;
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
    "backupId": "bkp_a1b2c3"
  },
  "output": {
    "checkedEvents": 1,
    "ok": true
  }
}
```
