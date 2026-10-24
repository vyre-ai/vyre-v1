# sites.domain_set

Add or remove a site domain

| | |
|---|---|
| Module | sites |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | sites.domains |
| Grant level | edit |
| Risk | medium |
| Resource | site (/siteId) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | yes |
| HTTP | POST /v1/sites/domain_set |
| MCP tool | sites_domain_set (sites) |
| CLI | none |
| Emits | site.domain_changed |

## Input

```ts
type In = {
  siteId: string;
  domain: string;
  remove?: boolean;
};
```

## Output

```ts
type Out = {
  dnsOk: boolean;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.needs_team
- permission.no_grant
- permission.role_lacks_permission
- validation.bad_input
- validation.not_found

## Example

```json
{
  "name": "example",
  "input": {
    "domain": "example",
    "remove": true,
    "siteId": "sit_a1b2c3"
  },
  "output": {
    "dnsOk": true
  }
}
```
