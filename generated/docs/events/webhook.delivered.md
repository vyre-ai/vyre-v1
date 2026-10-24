# webhook.delivered

A webhook delivery succeeded

| | |
|---|---|
| Module | events |
| Schema version | 1 |
| Subject | entity at /webhookId |
| Visibility | space |
| Label | none |
| Replay | stub |
| Automation trigger | no |
| Notification | none |
| Retention | logs |

## Payload

```ts
type Payload = {
  deliveryId: string;
  webhookId: string;
  eventId: string;
  httpStatus: number;
  attempts: number;
};
```
