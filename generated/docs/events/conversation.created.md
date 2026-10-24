# conversation.created

A conversation row was opened for a new address or contact

| | |
|---|---|
| Module | inbox |
| Schema version | 1 |
| Subject | entity at /conversationId |
| Visibility | space |
| Label | subject |
| Replay | pure |
| Automation trigger | no |
| Notification | none |
| Retention | default |

## Payload

```ts
type Payload = {
  conversationId: string;
  contactId?: string;
  channel: "email" | "sms" | "call";
};
```
