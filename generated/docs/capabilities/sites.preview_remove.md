# sites.preview_remove

Remove a preview

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
| HTTP | POST /v1/sites/preview_remove |
| MCP tool | sites_preview_remove (sites) |
| CLI | none |
| Emits | site.preview_removed |

## Input

```ts
type In = {
  siteId: string;
  branch: string;
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

## Example

```json
{
  "name": "example",
  "input": {
    "branch": "example",
    "siteId": "sit_a1b2c3"
  },
  "output": {
    "removed": true
  }
}
```
