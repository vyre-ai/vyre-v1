# sites.backup_delete

Delete a backup and its file

| | |
|---|---|
| Module | sites |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | sites.deploy |
| Grant level | edit |
| Risk | medium |
| Resource | site (/siteId) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/sites/backup_delete |
| MCP tool | sites_backup_delete (sites) |
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
  removed: boolean;
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
    "removed": true
  }
}
```
