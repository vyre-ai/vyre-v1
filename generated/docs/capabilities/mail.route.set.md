# mail.route.set

Route an address on a Space domain (MX on the Space domain) to a mailbox through /hooks/mail

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
| Idempotency | key |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/mail/route/set |
| MCP tool | mail_route_set (inbox) |
| CLI | none |
| Emits | inbound_route.saved |

## Input

```ts
type In = {
  domainId: string;
  localPart: string;
  mailboxId: string;
  idempotencyKey: string;
};
```

## Output

```ts
type Out = {
  route: {
    id: string;
    domainId: string;
    localPart: string;
    mailboxId: string;
    provider: "resend" | "mailgun";
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

## Example

```json
{
  "name": "example",
  "input": {
    "domainId": "dom_a1b2c3",
    "idempotencyKey": "idem_1",
    "localPart": "example",
    "mailboxId": "mbx_a1b2c3"
  },
  "output": {
    "route": {
      "domainId": "dom_a1b2c3",
      "id": "rte_a1b2c3",
      "localPart": "hello",
      "mailboxId": "mbx_a1b2c3",
      "provider": "resend"
    }
  }
}
```
