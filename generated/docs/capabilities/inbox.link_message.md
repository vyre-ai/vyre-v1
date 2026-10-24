# inbox.link_message

Shared linking step for a stored message, text or call: sure matches link, unsure go to Needs you, unowned replies route to the campaign owner then the shared inbox

| | |
|---|---|
| Module | inbox |
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
| HTTP | POST /v1/inbox/link_message |
| MCP tool | none |
| CLI | none |
| Emits | conversation.created, conversation.matched, conversation.needs_match, conversation.reply_received, conversation.campaign_reply |

## Input

```ts
type In = {
  channel: "email" | "sms" | "call";
  ref: {
    kind: "mail_message" | "sms" | "call";
    id: string;
  };
  address: string;
  direction: "in" | "out";
  at: number;
  mailboxId?: string;
  numberId?: string;
  campaignId?: string;
  preview?: string;
};
```

## Output

```ts
type Out = {
  conversationId: string;
  contactId?: string;
  linked: "sure" | "unsure" | "none";
  taskId?: string;
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
    "campaignId": "cmp_a1b2c3",
    "channel": "email",
    "direction": "in",
    "mailboxId": "mbx_a1b2c3",
    "numberId": "num_a1b2c3",
    "preview": "example",
    "ref": {
      "id": "example",
      "kind": "mail_message"
    }
  },
  "output": {
    "contactId": "rec_a1b2c3",
    "conversationId": "cnv_a1b2c3",
    "linked": "sure",
    "taskId": "tsk_a1b2c3"
  }
}
```
