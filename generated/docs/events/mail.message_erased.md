# mail.message_erased

A mail message was erased for good: body, attachments and search entries (ids only)

| | |
|---|---|
| Module | mail |
| Schema version | 1 |
| Subject | entity at /messageId |
| Visibility | space |
| Label | none |
| Replay | pure |
| Automation trigger | no |
| Notification | none |
| Retention | audit |

## Payload

```ts
type Payload = {
  messageId: string;
};
```
