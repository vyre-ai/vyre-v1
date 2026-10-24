# mail.received

An email arrived in a mailbox (deduped across inboxes)

| | |
|---|---|
| Module | mail |
| Schema version | 1 |
| Subject | mailbox at /mailboxId |
| Visibility | space |
| Label | subject |
| Replay | pure |
| Automation trigger | An email arrives |
| Notification | none |
| Retention | default |

## Payload

```ts
type Payload = {
  messageId: string;
  mailboxId: string;
  from: string;
  subject: string;
  contactId?: string;
  campaignId?: string;
};
```
