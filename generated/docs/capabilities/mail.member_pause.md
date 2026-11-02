# mail.member_pause

The connector stops a member's delegated mailbox, or starts it again; what is already in Vyre stays theirs

| | |
|---|---|
| Module | mail |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | connectors.manage |
| Grant level | edit |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/mail/member_pause |
| MCP tool | none |
| CLI | none |
| Emits | mailbox.paused, mailbox.resumed |

## Input

```ts
type In = {
  provider: "google" | "microsoft";
  address: string;
  paused: boolean;
};
```

## Output

```ts
type Out = {
  changed: number;
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
    "address": "maya@example.com",
    "paused": true,
    "provider": "google"
  },
  "output": {
    "changed": 1
  }
}
```
