# sites.backup_restore

Put a finished backup back, never losing data: the live database is backed up first (kept 7 days, else the restore is refused), the dump loads into a new database, and it is swapped in only if that worked

| | |
|---|---|
| Module | sites |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | sites.deploy |
| Grant level | manage |
| Risk | high |
| Resource | site (/siteId) |
| Gate | delete when actor.kind != 'person' |
| Idempotency | natural |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/sites/backup_restore |
| MCP tool | sites_backup_restore (sites) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  siteId: string;
  backupId: string;
};
```

## Output

```ts
type Out = {
  ok: boolean;
  detail: string;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- permission.role_lacks_permission
- validation.bad_input
- validation.not_found
- validation.precondition_failed

## Example

```json
{
  "name": "example",
  "input": {
    "backupId": "bkp_a1b2c3",
    "siteId": "sit_a1b2c3"
  },
  "output": {
    "detail": "example",
    "ok": true
  }
}
```
