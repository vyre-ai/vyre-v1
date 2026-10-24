# webhook.disabled

A webhook was disabled after repeated failures

| | |
|---|---|
| Module | events |
| Schema version | 1 |
| Subject | entity at /webhookId |
| Visibility | space |
| Label | none |
| Replay | pure |
| Automation trigger | no |
| Notification | none |
| Retention | events |

## Payload

```ts
type Payload = {
  webhookId: string;
  reason: string;
};
```
