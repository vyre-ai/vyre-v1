# sites.backup_download

Where to fetch a finished backup from: one address per part (a dump over 32 MB is kept in parts: join them in order). Readable by whoever can see the site

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
| HTTP | POST /v1/sites/backup_download |
| MCP tool | none |
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
  files: Array<{
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
    "backupId": "bkp_a1b2c3",
    "siteId": "sit_a1b2c3"
  },
  "output": {
    "files": [
      {
        "bytes": 1,
        "name": "example",
        "url": "example"
      }
    ],
    "note": "example"
  }
}
```
