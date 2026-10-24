# conversation.reply_received

A followed contact replied (Alert me on replies raises it to Interrupt in working hours)

| | |
|---|---|
| Module | inbox |
| Schema version | 1 |
| Subject | record at /contactId |
| Visibility | participants |
| Label | none |
| Replay | pure |
| Automation trigger | no |
| Notification | reply.followed |
| Retention | default |

## Payload

```ts
type Payload = {
  conversationId: string;
  contactId: string;
  channel: "email" | "sms" | "call";
};
```
