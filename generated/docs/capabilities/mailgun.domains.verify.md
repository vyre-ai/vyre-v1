# mailgun.domains.verify

Ask Mailgun to verify the published DNS records

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
| HTTP | POST /v1/mailgun/domains/verify |
| MCP tool | none |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  name: string;
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
    "name": "example"
  },
  "output": {
    "domain": {
      "dkim": "pass",
      "dmarc": "pass",
      "name": "example",
      "region": "us",
      "spf": "pass",
      "state": "unverified"
    }
  }
}
```
