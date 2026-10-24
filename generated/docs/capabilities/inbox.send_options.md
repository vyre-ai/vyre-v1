# inbox.send_options

Channels and sending inboxes for a contact; the default is the inbox the thread came in on

| | |
|---|---|
| Module | inbox |
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
| HTTP | POST /v1/inbox/send_options |
| MCP tool | inbox_send_options (inbox) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  conversationId?: string;
  contactId?: string;
};
```

## Output

```ts
type Out = {
  channels: Array<"email" | "sms">;
  inboxes: Array<{
      kind: "mailbox" | "number";
      id: string;
      address: string;
      canSend: boolean;
      isDefault: boolean;
    }>;
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
    "contactId": "rec_a1b2c3",
    "conversationId": "cnv_a1b2c3"
  },
  "output": {
    "channels": [
      "email"
    ],
    "inboxes": [
      {
        "address": "example",
        "canSend": true,
        "id": "example",
        "isDefault": true,
        "kind": "mailbox"
      }
    ]
  }
}
```
