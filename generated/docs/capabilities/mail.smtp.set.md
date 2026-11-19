# mail.smtp.set

Save the Space's SMTP server; password stays in the Vault

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
| Idempotency | natural |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/mail/smtp/set |
| MCP tool | none |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  host: string;
  port: number;
  security?: "starttls" | "tls";
  username: string;
  passwordHandle: string;
};
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
  "input": {
    "host": "smtp.example.com",
    "passwordHandle": "#Dana_Lawmatics",
    "port": 1,
    "security": "starttls",
    "username": "example"
  },
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
