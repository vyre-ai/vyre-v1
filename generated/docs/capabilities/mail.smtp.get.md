# mail.smtp.get

The Space's mail server (SMTP) and its last test

| | |
|---|---|
| Module | mail |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | comms.domains |
| Grant level | view |
| Risk | low |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/mail/smtp/get |
| MCP tool | mail_smtp_get (inbox) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = Record<string, unknown>;
```

## Output

```ts
type Out = {
  configured: boolean;
  host?: string;
  port?: number;
  security?: "starttls" | "tls";
  username?: string;
  state: "none" | "unchecked" | "ok" | "failed";
  detail?: string;
  checkedAt?: number;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- permission.role_lacks_permission
- validation.bad_input

## Example

```json
{
  "name": "example",
  "input": {},
  "output": {
    "checkedAt": 1760000000000,
    "configured": true,
    "detail": "example",
    "host": "smtp.example.com",
    "port": 1,
    "security": "starttls",
    "state": "none",
    "username": "example"
  }
}
```
