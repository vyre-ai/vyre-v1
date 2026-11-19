# mail.smtp.verify

Test an SMTP server (sign in only, nothing sent); no input tests the saved one

| | |
|---|---|
| Module | mail |
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
| HTTP | POST /v1/mail/smtp/verify |
| MCP tool | mail_smtp_verify (inbox) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  host?: string;
  port?: number;
  security?: "starttls" | "tls";
  username?: string;
  passwordHandle?: string;
  idempotencyKey: string;
};
```

## Output

```ts
type Out = {
  ok: boolean;
  reason?: "blocked" | "refused" | "unknown_host" | "address" | "auth" | "tls" | "failed";
  message: string;
  ms: number;
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
    "host": "smtp.example.com",
    "idempotencyKey": "idem_1",
    "passwordHandle": "#Dana_Lawmatics",
    "port": 1,
    "security": "starttls",
    "username": "example"
  },
  "output": {
    "message": "example",
    "ms": 1,
    "ok": true,
    "reason": "blocked"
  }
}
```
