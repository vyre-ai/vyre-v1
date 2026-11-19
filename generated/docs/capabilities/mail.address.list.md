# mail.address.list

Every address on the Space's domains: inbox addresses and aliases, with the inbox each lands in

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
| HTTP | POST /v1/mail/address/list |
| MCP tool | mail_address_list (inbox) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  cursor?: string;
  limit?: number;
  domainId?: string;
};
```

## Output

```ts
type Out = {
  addresses: Array<{
      address: string;
      domainId: string;
      kind: "mailbox" | "alias";
      mailboxId: string;
      mailboxTitle: string;
      routeId?: string;
      receives: boolean;
    }>;
  next?: string;
  total?: number;
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
    "cursor": "example",
    "domainId": "dom_a1b2c3",
    "limit": 1
  },
  "output": {
    "addresses": [
      {
        "address": "maya@example.com",
        "domainId": "dom_a1b2c3",
        "kind": "mailbox",
        "mailboxId": "mbx_a1b2c3",
        "mailboxTitle": "example",
        "receives": true,
        "routeId": "rte_a1b2c3"
      }
    ],
    "next": "example",
    "total": 1
  }
}
```
