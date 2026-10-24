# mail.domain.get

Read one sending domain with the DNS records to publish

| | |
|---|---|
| Module | mail |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | grant only |
| Grant level | view |
| Risk | low |
| Resource | domain (/domainId) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/mail/domain/get |
| MCP tool | mail_domain_get (inbox) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  domainId: string;
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
- validation.bad_input
- validation.not_found

## Example

```json
{
  "name": "example",
  "input": {
    "domainId": "dom_a1b2c3"
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
