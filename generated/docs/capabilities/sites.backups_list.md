# sites.backups_list

The site's database backups and the database size

| | |
|---|---|
| Module | sites |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | sites.deploy |
| Grant level | view |
| Risk | low |
| Resource | site (/siteId) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/sites/backups_list |
| MCP tool | sites_backups_list (sites) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  siteId: string;
};
```

## Output

```ts
type Out = {
  backups: Array<{
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
    }>;
  hasDatabase: boolean;
  database?: {
    bytes?: number;
    replacedBytes?: number;
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
    "siteId": "sit_a1b2c3"
  },
  "output": {
    "backups": [
      {
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
    ],
    "database": {
      "bytes": 1,
      "replacedBytes": 1
    },
    "hasDatabase": true
  }
}
```
