# sites.backups

Postgres backups of a site. action: list, create, delete, pin, download, restore (safety backup first)

| | |
|---|---|
| Module | sites |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | sites.deploy |
| Grant level | edit |
| Risk | medium |
| Resource | site (/siteId) |
| Gate | delete when input.action == 'restore' && actor.kind != 'person' |
| Idempotency | natural |
| Offline | online |
| Audit | sensitive |
| Team Space only | no |
| HTTP | POST /v1/sites/backups |
| MCP tool | sites_backups (sites) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  siteId: string;
  action: "list" | "create" | "delete" | "pin" | "download" | "restore";
  backupId?: string;
  pinned?: boolean;
};
```

## Output

```ts
type Out = {
  backups?: Array<{
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
  hasDatabase?: boolean;
  database?: {
    bytes?: number;
    replacedBytes?: number;
  };
  backup?: {
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
  removed?: boolean;
  ok?: boolean;
  detail?: string;
  files?: Array<{
      name: string;
      url: string;
      bytes?: number;
    }>;
  note?: string;
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
    "action": "list",
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
    },
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
    "detail": "example",
    "files": [
      {
        "bytes": 1,
        "name": "example",
        "url": "example"
      }
    ],
    "hasDatabase": true,
    "note": "example",
    "ok": true,
    "removed": true
  }
}
```
