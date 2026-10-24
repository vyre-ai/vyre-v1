# portal.message_posted

An outside account posted into a record conversation through the API

| | |
|---|---|
| Module | portal |
| Schema version | 1 |
| Subject | record at /recordId |
| Visibility | space |
| Label | none |
| Replay | pure |
| Automation trigger | no |
| Notification | none |
| Retention | default |

## Payload

```ts
type Payload = {
  accountId: string;
  recordId: string;
  messageId: string;
};
```
