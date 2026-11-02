# sites.domain_check

The state of a custom domain: waiting for DNS, issuing the certificate, or live

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
| HTTP | POST /v1/sites/domain_check |
| MCP tool | sites_domain_check (sites) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  siteId: string;
  domain: string;
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
- validation.bad_input
- validation.not_found

## Example

```json
{
  "name": "example",
  "input": {
    "domain": "example",
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
