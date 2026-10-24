# mail.domain.list

List sending domains with SPF, DKIM and DMARC state

| | |
|---|---|
| Module | mail |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | grant only |
| Grant level | view |
| Risk | low |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/mail/domain/list |
| MCP tool | mail_domain_list (inbox) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  cursor?: string;
  limit?: number;
};
```

## Output

```ts
type Out = {
  domains: Array<{
      id: string;
      name: string;
      provider: "resend" | "mailgun";
      spf: "pass" | "fail" | "pending";
      dkim: "pass" | "fail" | "pending";
      dmarc: "pass" | "fail" | "pending";
      verified: boolean;
      isDefault: boolean;
      checkedAt?: number;
    }>;
  next?: string;
  total?: number;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- validation.bad_input

## Example

```json
{
  "name": "example",
  "input": {
    "cursor": "example",
    "limit": 1
  },
  "output": {
    "domains": [
      {
        "checkedAt": 1760000000000,
        "dkim": "pass",
        "dmarc": "pass",
        "id": "dom_a1b2c3",
        "isDefault": true,
        "name": "mail.example.com",
        "provider": "resend",
        "spf": "pass",
        "verified": true
      }
    ],
    "next": "example",
    "total": 1
  }
}
```
