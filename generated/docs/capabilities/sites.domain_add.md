# sites.domain_add

Add a custom domain to a site: returns the exact DNS records to set and adds the Caddy route with automatic TLS

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
| Idempotency | key |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/sites/domain_add |
| MCP tool | sites_domain_add (sites) |
| CLI | none |
| Emits | site.domain_changed |

## Input

```ts
type In = {
  siteId: string;
  domain: string;
  idempotencyKey: string;
};
```

## Output

```ts
type Out = {
  domain: string;
  records: Array<{
      type: "CNAME" | "A";
      name: string;
      value: string;
    }>;
  state: "waiting_dns" | "issuing" | "live";
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
    "domain": "example",
    "idempotencyKey": "idem_1",
    "siteId": "sit_a1b2c3"
  },
  "output": {
    "domain": "example",
    "records": [
      {
        "name": "example",
        "type": "CNAME",
        "value": "example"
      }
    ],
    "state": "waiting_dns"
  }
}
```
