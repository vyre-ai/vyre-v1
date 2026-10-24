# sites.domains_get

Site domains with the DNS check and the Caddy certificate state

| | |
|---|---|
| Module | sites |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | grant only |
| Grant level | view |
| Risk | low |
| Resource | site (/siteId) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/sites/domains_get |
| MCP tool | sites_domains_get (sites) |
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
  domains: Array<{
      domain: string;
      dnsOk: boolean;
      certificate: "pending" | "issued" | "failed";
    }>;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
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
    "domains": [
      {
        "certificate": "pending",
        "dnsOk": true,
        "domain": "example"
      }
    ]
  }
}
```
