# contacts.apply_optout

Apply an inbound STOP or UNSUBSCRIBE: suppress the address and set the contact preferences

| | |
|---|---|
| Module | contacts-link |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | edit |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/contacts/apply_optout |
| MCP tool | none |
| CLI | none |
| Emits | suppression.added, contact.preferences_changed |

## Input

```ts
type In = {
  channel: "email" | "sms" | "call";
  address: string;
  keyword: string;
  source: "sms_stop" | "email_unsubscribe" | "link" | "reply";
  at?: number;
};
```

## Output

```ts
type Out = {
  suppressionId: string;
  contactId?: string;
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
    "address": "example",
    "at": 1760000000000,
    "channel": "email",
    "keyword": "STOP",
    "source": "sms_stop"
  },
  "output": {
    "contactId": "rec_a1b2c3",
    "suppressionId": "sup_a1b2c3"
  }
}
```
