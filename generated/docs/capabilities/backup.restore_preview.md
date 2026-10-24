# backup.restore_preview

Show what a restore would change: sequence range, tombstones to replay, members affected

| | |
|---|---|
| Module | backup |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | server.backups |
| Grant level | view |
| Risk | low |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/backup/restore_preview |
| MCP tool | backup_restore_preview (engineer) |
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
  fromSeq: number;
  toSeq: number;
  tombstones: number;
  downtimeSeconds: number;
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
    "downtimeSeconds": 1,
    "fromSeq": 1,
    "toSeq": 1,
    "tombstones": 1
  }
}
```
