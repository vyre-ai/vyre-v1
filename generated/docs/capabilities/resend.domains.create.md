# resend.domains.create

Create a domain in Resend and return the DNS records for SPF, DKIM and DMARC

| | |
|---|---|
| Module | resend |
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
| HTTP | POST /v1/resend/domains/create |
| MCP tool | none |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  name: string;
  region?: string;
  idempotencyKey: string;
};
```

## Output

```ts
type Out = {
  domain: {
    providerDomainId: string;
    name: string;
    status: "not_started" | "pending" | "verified" | "failed";
    spf: "pass" | "fail" | "pending";
    dkim: "pass" | "fail" | "pending";
    dmarc: "pass" | "fail" | "pending";
    region?: string;
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
    "region": "example"
  },
  "output": {
    "domain": {
      "dkim": "pass",
      "dmarc": "pass",
      "name": "example",
      "providerDomainId": "example",
      "region": "example",
      "spf": "pass",
      "status": "not_started"
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
