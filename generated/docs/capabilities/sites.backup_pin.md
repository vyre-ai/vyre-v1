# sites.backup_pin

Keep a backup for good (the clean-up never deletes a pinned one), or let it go again

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
| HTTP | POST /v1/sites/backup_pin |
| MCP tool | sites_backup_pin (sites) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  siteId: string;
  backupId: string;
  pinned?: boolean;
};
```

## Output

```ts
type Out = {
  backup: {
    backupId: string;
    siteId: string;
    state: "queued" | "running" | "ready" | "failed";
    by: "schedule" | "person";
    at: number;
    endedAt?: number;
    bytes?: number;
    note?: string;
    pinned?: boolean;
    keepUntil?: number;
  };
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- permission.role_lacks_permission
- validation.bad_input
- validation.not_found

## Example

```json
{
  "name": "example",
  "input": {
    "backupId": "bkp_a1b2c3",
    "pinned": true,
    "siteId": "sit_a1b2c3"
  },
  "output": {
    "backup": {
      "at": 1760000000000,
      "backupId": "bkp_a1b2c3",
      "by": "schedule",
      "bytes": 1,
      "endedAt": 1760000000000,
      "keepUntil": 1760000000000,
      "note": "example",
      "pinned": true,
      "siteId": "sit_a1b2c3",
      "state": "queued"
    }
  }
}
```
