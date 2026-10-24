# contacts.suppression.add

Add addresses to the suppression list (bounces, complaints, opt-outs and manual adds)

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
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/contacts/suppression/add |
| MCP tool | contacts_suppression_add (inbox) |
| CLI | none |
| Emits | suppression.added |

## Input

```ts
type In = {
  channel: "email" | "sms" | "call";
  addresses: Array<string>;
  reason: "bounce_hard" | "complaint" | "unsubscribe" | "stop" | "manual" | "do_not_contact" | "import";
  source?: string;
  note?: string;
};
```

## Output

```ts
type Out = {
  added: number;
  rows: Array<{
      id: string;
      channel: "email" | "sms" | "call";
      address: string;
      reason: "bounce_hard" | "complaint" | "unsubscribe" | "stop" | "manual" | "do_not_contact" | "import";
      source: string;
      contactId?: string;
      addedAt: number;
      addedBy: string;
      note?: string;
    }>;
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
    "addresses": [
      "example"
    ],
    "channel": "email",
    "note": "example",
    "reason": "bounce_hard",
    "source": "example"
  },
  "output": {
    "added": 1,
    "rows": [
      {
        "addedAt": 1760000000000,
        "addedBy": "example",
        "address": "maya@example.com",
        "channel": "email",
        "contactId": "rec_a1b2c3",
        "id": "sup_a1b2c3",
        "note": "example",
        "reason": "bounce_hard",
        "source": "mail.bounce"
      }
    ]
  }
}
```
