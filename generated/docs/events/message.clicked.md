# message.clicked

A recipient clicked a link in an email

| | |
|---|---|
| Module | mail |
| Schema version | 1 |
| Subject | entity at /messageId |
| Visibility | space |
| Label | none |
| Replay | stub |
| Automation trigger | no |
| Notification | none |
| Retention | default |

## Payload

```ts
type Payload = {
  messageId: string;
  url?: string;
};
```
