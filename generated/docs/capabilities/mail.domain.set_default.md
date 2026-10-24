# mail.domain.set_default

Make a verified domain the default sender for Space sending

| | |
|---|---|
| Module | mail |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | comms.domains |
| Grant level | edit |
| Risk | medium |
| Resource | domain (/domainId) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/mail/domain/set_default |
| MCP tool | mail_domain_set_default (inbox) |
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
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- permission.role_lacks_permission
- validation.bad_input
- validation.not_found
- validation.precondition_failed

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
    }
  }
}
```
