# mailgun.domains.create

Create a domain in Mailgun and return the DNS records for SPF, DKIM and DMARC

| | |
|---|---|
| Module | mailgun |
| Version | 1 (since 1.0.0) |
| Effects | outward |
| Permission | comms.domains |
| Grant level | use |
| Risk | high |
| Resource | space |
| Gate | none |
| Idempotency | key |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/mailgun/domains/create |
| MCP tool | none |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  name: string;
  region?: "us" | "eu";
  idempotencyKey: string;
};
```

## Output

```ts
type Out = {
  domain: {
    name: string;
    state: "unverified" | "active" | "disabled";
    spf: "pass" | "fail" | "pending";
    dkim: "pass" | "fail" | "pending";
    dmarc: "pass" | "fail" | "pending";
    region: "us" | "eu";
  };
  records: Array<{
      purpose: "spf" | "dkim" | "dmarc" | "mx" | "verify";
      type: "TXT" | "CNAME" | "MX";
      name: string;
      value: string;
      state: "pass" | "fail" | "pending";
    }>;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- permission.role_lacks_permission
- provider.network
- provider.unavailable
- validation.bad_input

## Example

```json
{
  "name": "example",
  "input": {
    "idempotencyKey": "idem_1",
    "name": "example",
    "region": "us"
  },
  "output": {
    "domain": {
      "dkim": "pass",
      "dmarc": "pass",
      "name": "example",
      "region": "us",
      "spf": "pass",
      "state": "unverified"
    },
    "records": [
      {
        "name": "example",
        "purpose": "spf",
        "state": "pass",
        "type": "TXT",
        "value": "example"
      }
    ]
  }
}
```
