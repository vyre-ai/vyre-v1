# message.sent

A message left the Space (email or text)

| | |
|---|---|
| Module | mail |
| Schema version | 1 |
| Subject | entity at /messageId |
| Visibility | space |
| Label | subject |
| Replay | stub |
| Automation trigger | no |
| Notification | none |
| Retention | default |

## Payload

```ts
type Payload = {
  messageId: string;
  channel: "email" | "sms";
  mailboxId?: string;
  contactId?: string;
  campaignId?: string;
};
```
