# contacts.suppression.import

Add many addresses from a file to the suppression list

| | |
|---|---|
| Module | contacts-link |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | records.create |
| Grant level | edit |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | key |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/contacts/suppression/import |
| MCP tool | contacts_suppression_import (inbox) |
| CLI | none |
| Emits | suppression.added |

## Input

```ts
type In = {
  channel: "email" | "sms" | "call";
  fileId: string;
  reason?: "bounce_hard" | "complaint" | "unsubscribe" | "stop" | "manual" | "do_not_contact" | "import";
  idempotencyKey: string;
};
```

## Output

```ts
type Out = {
  added: number;
  skipped: number;
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
    "channel": "email",
    "fileId": "fil_a1b2c3",
    "idempotencyKey": "idem_1",
    "reason": "bounce_hard"
  },
  "output": {
    "added": 1,
    "skipped": 1
  }
}
```
