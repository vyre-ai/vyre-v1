# resend.domains.verify

Ask Resend to verify the published DNS records

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
| HTTP | POST /v1/resend/domains/verify |
| MCP tool | none |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  providerDomainId: string;
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
    "providerDomainId": "example"
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
    }
  }
}
```
