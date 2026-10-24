# message.delivered

The provider reports delivery

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
  channel: "email" | "sms";
};
```
