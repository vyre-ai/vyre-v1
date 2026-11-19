# mail.address.add

Make an address on a Space domain. With an inbox it is an alias that delivers there; without one a shared inbox is made for it. Who may send as it is a share on the inbox (access.share)

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
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/mail/address/add |
| MCP tool | none |
| CLI | none |
| Emits | inbound_route.saved, mailbox.created |

## Input

```ts
type In = {
  domainId: string;
  localPart: string;
  mailboxId?: string;
  title?: string;
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
    "idempotencyKey": "idem_1",
    "localPart": "billing",
    "mailboxId": "mbx_a1b2c3",
    "title": "example"
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
    }
  }
}
```
