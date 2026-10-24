# contacts.suppression.list

List the suppression list

| | |
|---|---|
| Module | contacts-link |
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
| HTTP | POST /v1/contacts/suppression/list |
| MCP tool | contacts_suppression_list (inbox) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  channel?: "email" | "sms" | "call";
  reason?: "bounce_hard" | "complaint" | "unsubscribe" | "stop" | "manual" | "do_not_contact" | "import";
  query?: string;
  cursor?: string;
  limit?: number;
};
```

## Output

```ts
type Out = {
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
    "channel": "email",
    "cursor": "example",
    "limit": 1,
    "query": "example",
    "reason": "bounce_hard"
  },
  "output": {
    "next": "example",
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
    ],
    "total": 1
  }
}
```
