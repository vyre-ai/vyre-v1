# mail.configure

Email setup: status|test|smtp_get|smtp_set|smtp_verify|address_list|address_add|address_move

| | |
|---|---|
| Module | mail |
| Version | 1 (since 1.0.0) |
| Effects | outward |
| Permission | grant only |
| Grant level | use |
| Risk | high |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/mail/configure |
| MCP tool | mail_configure (inbox) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  action: "status" | "test" | "smtp_get" | "smtp_set" | "smtp_verify" | "address_list" | "address_add" | "address_move";
  to?: string;
  host?: string;
  port?: number;
  security?: "starttls" | "tls";
  username?: string;
  passwordHandle?: string;
  domainId?: string;
  localPart?: string;
  mailboxId?: string;
  fromMailboxId?: string;
  title?: string;
  nonce?: string;
};
```

## Output

```ts
type Out = {
  result: unknown;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- provider.network
- provider.unavailable
- validation.bad_input
- validation.duplicate
- validation.not_found
- validation.precondition_failed

## Example

```json
{
  "name": "example",
  "input": {
    "action": "status",
    "domainId": "dom_a1b2c3",
    "fromMailboxId": "mbx_a1b2c3",
    "host": "example",
    "localPart": "example",
    "mailboxId": "mbx_a1b2c3",
    "nonce": "example",
    "passwordHandle": "#Dana_Lawmatics",
    "port": 1,
    "security": "starttls",
    "title": "example",
    "to": "maya@example.com",
    "username": "example"
  },
  "output": {
    "result": {}
  }
}
```
