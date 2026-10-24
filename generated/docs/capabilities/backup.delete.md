# backup.delete

Delete a backup file from the target

| | |
|---|---|
| Module | backup |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | server.backups |
| Grant level | manage |
| Risk | high |
| Resource | space |
| Gate | delete |
| Idempotency | natural |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/backup/delete |
| MCP tool | backup_delete (engineer) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  backupId: string;
};
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
    "deleted": true
  }
}
```
