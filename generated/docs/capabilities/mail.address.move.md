# mail.address.move

Point an address that exists at another inbox. Names the inbox it goes to now and the one it will go to; the person must be able to use the new inbox

| | |
|---|---|
| Module | mail |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | comms.domains |
| Grant level | edit |
| Risk | medium |
| Resource | domain (/domainId) |
| Gate | delete when actor.kind != 'person' |
| Idempotency | key |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/mail/address/move |
| MCP tool | mail_address_move (inbox) |
| CLI | none |
| Emits | inbound_route.saved |

## Input

```ts
type In = {
  domainId: string;
  localPart: string;
  fromMailboxId: string;
  mailboxId: string;
  idempotencyKey: string;
};
```

## Output

```ts
type Out = {
  address: {
    address: string;
    domainId: string;
    kind: "mailbox" | "alias";
    mailboxId: string;
    mailboxTitle: string;
    routeId?: string;
    receives: boolean;
  };
  from: string;
  to: string;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- permission.role_lacks_permission
- validation.bad_input
- validation.duplicate
- validation.not_found

## Example

```json
{
  "name": "example",
  "input": {
    "domainId": "dom_a1b2c3",
    "fromMailboxId": "mbx_a1b2c3",
    "idempotencyKey": "idem_1",
    "localPart": "billing",
    "mailboxId": "mbx_a1b2c3"
  },
  "output": {
    "address": {
      "address": "maya@example.com",
      "domainId": "dom_a1b2c3",
      "kind": "mailbox",
      "mailboxId": "mbx_a1b2c3",
      "mailboxTitle": "example",
      "receives": true,
      "routeId": "rte_a1b2c3"
    },
    "from": "example",
    "to": "example"
  }
}
```
