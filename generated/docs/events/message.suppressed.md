# message.suppressed

A send was refused for a suppressed address or missing consent

| | |
|---|---|
| Module | mail |
| Schema version | 1 |
| Subject | entity at /address |
| Visibility | space |
| Label | none |
| Replay | pure |
| Automation trigger | no |
| Notification | none |
| Retention | default |

## Payload

```ts
type Payload = {
  channel: "email" | "sms";
  address: string;
  reason: string;
  campaignId?: string;
};
```
