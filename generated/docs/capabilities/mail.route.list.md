# mail.route.list

List inbound routes (address on a Space domain to a mailbox)

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
| HTTP | POST /v1/mail/route/list |
| MCP tool | mail_route_list (inbox) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  domainId?: string;
  cursor?: string;
  limit?: number;
};
```

## Output

```ts
type Out = {
  routes: Array<{
      id: string;
      domainId: string;
      localPart: string;
      mailboxId: string;
      provider: "resend" | "mailgun";
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
    "domainId": "dom_a1b2c3",
    "limit": 1
  },
  "output": {
    "next": "example",
    "routes": [
      {
        "domainId": "dom_a1b2c3",
        "id": "rte_a1b2c3",
        "localPart": "hello",
        "mailboxId": "mbx_a1b2c3",
        "provider": "resend"
      }
    ],
    "total": 1
  }
}
```
