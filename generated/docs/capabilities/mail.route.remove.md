# mail.route.remove

Remove an inbound route

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
| HTTP | POST /v1/mail/route/remove |
| MCP tool | mail_route_remove (inbox) |
| CLI | none |
| Emits | inbound_route.removed |

## Input

```ts
type In = {
  routeId: string;
  domainId: string;
};
```

## Output

```ts
type Out = {
  removed: boolean;
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
    "routeId": "rte_a1b2c3"
  },
  "output": {
    "removed": true
  }
}
```
