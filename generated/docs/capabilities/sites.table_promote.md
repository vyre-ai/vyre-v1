# sites.table_promote

Promote a site table to a Space record type

| | |
|---|---|
| Module | sites |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | schema.manage |
| Grant level | manage |
| Risk | medium |
| Resource | site (/siteId) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/sites/table_promote |
| MCP tool | sites_table_promote (sites) |
| CLI | none |
| Emits | site.table_promoted |

## Input

```ts
type In = {
  siteId: string;
  type: string;
};
```

## Output

```ts
type Out = {
  type: string;
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
    "siteId": "sit_a1b2c3",
    "type": "example"
  },
  "output": {
    "type": "example"
  }
}
```
