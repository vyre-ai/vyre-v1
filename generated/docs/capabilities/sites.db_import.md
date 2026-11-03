# sites.db_import

Copy an existing Postgres into the site's own: a pg_dump file in Files, or a Vault key holding the old connection string (for example from Railway)

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
| Audit | sensitive |
| Team Space only | no |
| HTTP | POST /v1/sites/db_import |
| MCP tool | sites_db_import (sites) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  siteId: string;
  fileId?: string;
  fromHandle?: string;
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
    "fileId": "fil_a1b2c3",
    "fromHandle": "#Dana_Lawmatics",
    "siteId": "sit_a1b2c3"
  },
  "output": {
    "detail": "example",
    "ok": true
  }
}
```
