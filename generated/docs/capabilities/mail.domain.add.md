# mail.domain.add

Add a sending domain at Resend or Mailgun and return the DNS records to publish

| | |
|---|---|
| Module | mail |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | comms.domains |
| Grant level | edit |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | key |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/mail/domain/add |
| MCP tool | mail_domain_add (inbox) |
| CLI | none |
| Emits | sending_domain.added |

## Input

```ts
type In = {
  name: string;
  provider: "resend" | "mailgun";
  idempotencyKey: string;
};
```

## Output

```ts
type Out = {
  domain: {
    id: string;
    name: string;
    provider: "resend" | "mailgun";
    spf: "pass" | "fail" | "pending";
    dkim: "pass" | "fail" | "pending";
    dmarc: "pass" | "fail" | "pending";
    verified: boolean;
    isDefault: boolean;
    checkedAt?: number;
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
- provider.auth_failed
- validation.bad_input
- validation.duplicate

## Example

```json
{
  "name": "example",
  "input": {
    "idempotencyKey": "idem_1",
    "name": "mail.example.com",
    "provider": "resend"
  },
  "output": {
    "domain": {
      "checkedAt": 1760000000000,
      "dkim": "pass",
      "dmarc": "pass",
      "id": "dom_a1b2c3",
      "isDefault": true,
      "name": "mail.example.com",
      "provider": "resend",
      "spf": "pass",
      "verified": true
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
