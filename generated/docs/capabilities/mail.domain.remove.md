# mail.domain.remove

Remove a sending domain

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
| Idempotency | natural |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/mail/domain/remove |
| MCP tool | mail_domain_remove (inbox) |
| CLI | none |
| Emits | sending_domain.removed |

## Input

```ts
type In = {
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
    "domainId": "dom_a1b2c3"
  },
  "output": {
    "removed": true
  }
}
```
