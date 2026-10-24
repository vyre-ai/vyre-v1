# message.bounced

A message bounced or could not be delivered

| | |
|---|---|
| Module | mail |
| Schema version | 1 |
| Subject | entity at /messageId |
| Visibility | space |
| Label | none |
| Replay | stub |
| Automation trigger | A message bounces |
| Notification | none |
| Retention | default |

## Payload

```ts
type Payload = {
  messageId: string;
  channel: "email" | "sms";
  address: string;
  kind: "hard" | "soft";
  reason?: string;
};
```
